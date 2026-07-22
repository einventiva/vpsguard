import { useState, useEffect, useCallback, useRef } from 'react'
import type {
  ServerInfo,
  ServiceCheck,
  ServiceCheckInput,
  ServiceCheckKind,
  ServiceCheckResult,
  ServiceCheckHistoryRow,
} from '@/types'
import { SERVER_ONLY_KINDS } from '@/types'
import { api } from '@/lib/api'
import { getSharedSocket, releaseSharedSocket } from '@/lib/socket'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Activity,
  Plus,
  Pencil,
  Trash2,
  X,
  Save,
  ChevronLeft,
  AlertCircle,
  CheckCircle2,
  Loader,
  PlayCircle,
  ChevronDown,
  ChevronRight,
  Globe,
  Plug,
  Terminal,
  Box,
} from 'lucide-react'

interface ServicesPanelProps {
  servers: Record<string, ServerInfo>
  serverKeys: string[]
}

const KIND_META: Record<ServiceCheckKind, { label: string; icon: typeof Globe; targetLabel: string; targetHint: string }> = {
  http: { label: 'HTTP', icon: Globe, targetLabel: 'URL', targetHint: 'https://example.com/health' },
  tcp: { label: 'TCP', icon: Plug, targetLabel: 'Host and port', targetHint: 'localhost:5432' },
  command: { label: 'Command', icon: Terminal, targetLabel: 'Command', targetHint: 'systemctl is-active docker' },
  container: { label: 'Container', icon: Box, targetLabel: 'Container or unit name', targetHint: 'my-container' },
}

// Generic starting points, deliberately not tied to any particular
// deployment — a template fills the form, it does not create anything.
const TEMPLATES: { label: string; apply: Partial<ServiceCheckInput> }[] = [
  {
    label: 'HTTP health endpoint (JSON)',
    apply: { kind: 'http', target: 'https://example.com/health', config: { jsonPath: 'status', jsonEquals: 'ok' } },
  },
  {
    label: 'Web page responds',
    apply: { kind: 'http', target: 'https://example.com/', config: { expectStatus: '2xx' } },
  },
  {
    label: 'Authenticated API endpoint',
    apply: {
      kind: 'http',
      target: 'https://example.com/api/health',
      config: { expectStatus: '2xx', headers: { Authorization: 'Bearer ${MY_TOKEN}' } },
    },
  },
  { label: 'Database port reachable', apply: { kind: 'tcp', target: 'localhost:5432' } },
  { label: 'Message broker port reachable', apply: { kind: 'tcp', target: 'localhost:5672' } },
  { label: 'Docker container running', apply: { kind: 'container', target: 'my-container', config: { runtime: 'docker' } } },
  { label: 'systemd unit active', apply: { kind: 'container', target: 'nginx', config: { runtime: 'systemd' } } },
  { label: 'Command exits zero', apply: { kind: 'command', target: 'systemctl is-active docker', config: {} } },
]

const emptyForm: ServiceCheckInput = {
  name: '',
  kind: 'http',
  target: '',
  runFrom: 'dashboard',
  config: {},
  intervalSec: 60,
  timeoutMs: 10000,
  failuresToOpen: 2,
  successesToResolve: 2,
  severity: 'critical',
  enabled: true,
}

const inputClass =
  'w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-50 placeholder:text-zinc-600 focus:outline-none focus:border-blue-600'

function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
}

// Headers are edited as "Key: value" lines — closer to how anyone
// already thinks about a header than a key/value grid would be
function headersToText(headers?: Record<string, string>): string {
  return Object.entries(headers || {}).map(([k, v]) => `${k}: ${v}`).join('\n')
}

function textToHeaders(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim()
    if (key) out[key] = value
  }
  return out
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-zinc-400 font-semibold uppercase tracking-wider block mb-1">{label}</label>
      {children}
      {hint && <p className="text-xs text-zinc-500 mt-1">{hint}</p>}
    </div>
  )
}

function StatusPill({ check }: { check: ServiceCheck }) {
  if (!check.enabled) {
    return <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">PAUSED</span>
  }
  // A check that has never run is unknown, not down — the same rule the
  // AI sample had to learn: absence of data is not evidence of failure
  if (!check.lastResult) {
    return <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">UNKNOWN</span>
  }
  return check.lastResult.ok ? (
    <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-green-900/40 text-green-300">UP</span>
  ) : (
    <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-red-900/40 text-red-300">DOWN</span>
  )
}

function timeAgo(iso?: string | null): string {
  if (!iso) return 'never'
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// Status-page style strip: one bar per recorded result, oldest on the
// left, so an outage reads as a red gap in an otherwise green band
function Timeline({ rows }: { rows: ServiceCheckHistoryRow[] }) {
  const bars = rows.slice(0, 48).reverse()
  return (
    <div className="flex items-center gap-0.5">
      {bars.map((r, i) => (
        <div
          key={r.id ?? i}
          title={`${new Date(r.timestamp).toLocaleString()} — ${r.ok ? `ok · ${r.latency_ms ?? '?'}ms` : (r.error || 'failed')}`}
          className={`w-1.5 h-6 rounded-sm ${r.ok ? 'bg-green-500/60 hover:bg-green-400' : 'bg-red-500/80 hover:bg-red-400'}`}
        />
      ))}
    </div>
  )
}

export function ServicesPanel({ servers, serverKeys }: ServicesPanelProps) {
  const [checks, setChecks] = useState<ServiceCheck[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<ServiceCheckInput | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [headerText, setHeaderText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ id: string; result: ServiceCheckResult } | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null)
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [history, setHistory] = useState<Record<string, ServiceCheckHistoryRow[]>>({})

  const isNew = editingId === null

  const refetch = useCallback(async () => {
    try {
      setChecks(await api.getServiceChecks())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load service checks')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refetch() }, [refetch])

  // Results stream in as the backend runs each check, so the list stays
  // live without polling it
  useEffect(() => {
    const socket = getSharedSocket()
    const onResult = (payload: ServiceCheckResult & { checkId: string; uptime24hPct?: number | null; avgLatencyMs24h?: number | null }) => {
      const ts = payload.timestamp ?? new Date().toISOString()
      setChecks(prev => prev.map(c => c.id === payload.checkId
        ? {
            ...c,
            lastResult: { ok: payload.ok, latencyMs: payload.latencyMs, statusCode: payload.statusCode, error: payload.error, timestamp: ts },
            // Carried on the event so a red check can never sit next to an
            // uptime frozen at page load
            uptime24hPct: payload.uptime24hPct !== undefined ? payload.uptime24hPct : c.uptime24hPct,
            avgLatencyMs24h: payload.avgLatencyMs24h !== undefined ? payload.avgLatencyMs24h : c.avgLatencyMs24h,
          }
        : c))
      // Keep an open detail timeline moving without a refetch
      setHistory(prev => prev[payload.checkId]
        ? {
            ...prev,
            [payload.checkId]: [
              { id: Date.now(), check_id: payload.checkId, timestamp: ts, ok: payload.ok ? 1 : 0, latency_ms: payload.latencyMs, status_code: payload.statusCode, error: payload.error },
              ...prev[payload.checkId],
            ].slice(0, 60),
          }
        : prev)
    }
    socket.on('check:result', onResult)
    return () => {
      socket.off('check:result', onResult)
      releaseSharedSocket()
    }
  }, [])

  useEffect(() => () => { if (confirmTimer.current) clearTimeout(confirmTimer.current) }, [])

  const openEditor = (check?: ServiceCheck) => {
    if (check) {
      setEditing({
        name: check.name,
        kind: check.kind,
        target: check.target,
        runFrom: check.run_from,
        config: check.config || {},
        intervalSec: check.interval_sec,
        timeoutMs: check.timeout_ms,
        failuresToOpen: check.failures_to_open,
        successesToResolve: check.successes_to_resolve,
        severity: check.severity,
        enabled: check.enabled,
      })
      setEditingId(check.id)
      setHeaderText(headersToText(check.config?.headers))
    } else {
      setEditing({ ...emptyForm, config: {} })
      setEditingId(null)
      setHeaderText('')
    }
    setError(null)
    setTestResult(null)
  }

  const applyTemplate = (label: string) => {
    const tpl = TEMPLATES.find(t => t.label === label)
    if (!tpl || !editing) return
    const next = { ...editing, ...tpl.apply, config: tpl.apply.config ?? {} }
    // A server-only kind cannot keep the dashboard vantage point
    if (SERVER_ONLY_KINDS.includes(next.kind) && next.runFrom === 'dashboard') {
      next.runFrom = serverKeys[0] ?? 'dashboard'
    }
    setEditing(next)
    setHeaderText(headersToText(next.config?.headers))
  }

  const changeKind = (kind: ServiceCheckKind) => {
    if (!editing) return
    const runFrom = SERVER_ONLY_KINDS.includes(kind) && editing.runFrom === 'dashboard'
      ? (serverKeys[0] ?? 'dashboard')
      : editing.runFrom
    setEditing({ ...editing, kind, runFrom })
  }

  const handleSave = async () => {
    if (!editing) return
    setSaving(true)
    setError(null)
    try {
      const config = { ...editing.config }
      if (editing.kind === 'http') {
        const headers = textToHeaders(headerText)
        if (Object.keys(headers).length > 0) config.headers = headers
        else delete config.headers
      }
      const payload = { ...editing, config }
      if (isNew) {
        await api.createServiceCheck({ ...payload, id: slugify(editing.name) })
      } else {
        await api.updateServiceCheck(editingId!, payload)
      }
      await refetch()
      setEditing(null)
      setEditingId(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save check')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await api.deleteServiceCheck(id)
      await refetch()
      setEditing(null)
      setEditingId(null)
      setConfirmingDelete(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete check')
    }
  }

  // Two-step delete rather than a dialog, matching the scripts panel
  const requestDelete = (id: string) => {
    if (confirmingDelete === id) {
      handleDelete(id)
      return
    }
    setConfirmingDelete(id)
    if (confirmTimer.current) clearTimeout(confirmTimer.current)
    confirmTimer.current = setTimeout(() => setConfirmingDelete(null), 4000)
  }

  const toggleExpand = async (id: string) => {
    if (expanded === id) {
      setExpanded(null)
      return
    }
    setExpanded(id)
    if (!history[id]) {
      try {
        const rows = await api.getServiceCheckHistory(id, 60)
        setHistory(prev => ({ ...prev, [id]: rows }))
      } catch {
        setHistory(prev => ({ ...prev, [id]: [] }))
      }
    }
  }

  const handleTest = async (id: string) => {
    setTesting(id)
    setTestResult(null)
    try {
      setTestResult({ id, result: await api.runServiceCheck(id) })
    } catch (err) {
      setTestResult({
        id,
        result: { ok: false, latencyMs: null, statusCode: null, error: err instanceof Error ? err.message : 'Test failed' },
      })
    } finally {
      setTesting(null)
    }
  }

  // ─── Editor view ──────────────────────────────────────────────────
  if (editing) {
    const meta = KIND_META[editing.kind]
    const serverOnly = SERVER_ONLY_KINDS.includes(editing.kind)
    const derivedId = slugify(editing.name)

    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => { setEditing(null); setEditingId(null) }} className="text-zinc-400 hover:text-zinc-200">
            <ChevronLeft className="w-4 h-4 mr-1" />
            Back
          </Button>
          <h3 className="text-sm font-semibold text-zinc-300">{isNew ? 'New Service Check' : 'Edit Service Check'}</h3>
        </div>

        <Card className="border-zinc-700 bg-zinc-900/50 p-6 space-y-4">
          {isNew && (
            <Field label="Start from a template" hint="Fills the form below. Nothing is created until you save.">
              <select className={inputClass} value="" onChange={(e) => applyTemplate(e.target.value)}>
                <option value="">Choose a template…</option>
                {TEMPLATES.map(t => <option key={t.label} value={t.label}>{t.label}</option>)}
              </select>
            </Field>
          )}

          <Field label="Name" hint={isNew && derivedId ? `Identifier: ${derivedId}` : undefined}>
            <input
              type="text"
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              placeholder="Public API"
              className={inputClass}
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Type">
              <select className={inputClass} value={editing.kind} onChange={(e) => changeKind(e.target.value as ServiceCheckKind)}>
                {(Object.keys(KIND_META) as ServiceCheckKind[]).map(k => (
                  <option key={k} value={k}>{KIND_META[k].label}</option>
                ))}
              </select>
            </Field>

            <Field
              label="Run from"
              hint={serverOnly
                ? 'This type runs on a host, so it needs a server.'
                : 'The dashboard sees what a user sees; a server reaches loopback-only services.'}
            >
              <select
                className={inputClass}
                value={editing.runFrom}
                onChange={(e) => setEditing({ ...editing, runFrom: e.target.value })}
              >
                {!serverOnly && <option value="dashboard">Dashboard (over the network)</option>}
                {serverKeys.map(k => (
                  <option key={k} value={k}>{servers[k]?.displayName || k}</option>
                ))}
              </select>
            </Field>
          </div>

          <Field label={meta.targetLabel}>
            <input
              type="text"
              value={editing.target}
              onChange={(e) => setEditing({ ...editing, target: e.target.value })}
              placeholder={meta.targetHint}
              className={`${inputClass} font-mono`}
            />
          </Field>

          {editing.kind === 'container' && (
            <Field label="Runtime">
              <select
                className={inputClass}
                value={editing.config.runtime || 'docker'}
                onChange={(e) => setEditing({ ...editing, config: { ...editing.config, runtime: e.target.value as 'docker' | 'systemd' } })}
              >
                <option value="docker">Docker container</option>
                <option value="systemd">systemd unit</option>
              </select>
            </Field>
          )}

          {editing.kind === 'http' && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Method">
                  <select
                    className={inputClass}
                    value={editing.config.method || 'GET'}
                    onChange={(e) => setEditing({ ...editing, config: { ...editing.config, method: e.target.value } })}
                  >
                    {['GET', 'HEAD', 'POST'].map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </Field>
                <Field label="Expected status" hint="200, 2xx, or a list like 2xx,3xx">
                  <input
                    type="text"
                    value={editing.config.expectStatus || ''}
                    onChange={(e) => setEditing({ ...editing, config: { ...editing.config, expectStatus: e.target.value } })}
                    placeholder="2xx"
                    className={`${inputClass} font-mono`}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Field label="JSON field" hint="Dotted path, e.g. status or db.pool.free">
                  <input
                    type="text"
                    value={editing.config.jsonPath || ''}
                    onChange={(e) => setEditing({ ...editing, config: { ...editing.config, jsonPath: e.target.value } })}
                    placeholder="status"
                    className={`${inputClass} font-mono`}
                  />
                </Field>
                <Field label="Must equal" hint="Leave empty to only require the field to exist">
                  <input
                    type="text"
                    value={editing.config.jsonEquals || ''}
                    onChange={(e) => setEditing({ ...editing, config: { ...editing.config, jsonEquals: e.target.value } })}
                    placeholder="ok"
                    className={`${inputClass} font-mono`}
                  />
                </Field>
              </div>

              <Field label="Body must contain" hint="Plain substring; leave empty to skip">
                <input
                  type="text"
                  value={editing.config.expectBody || ''}
                  onChange={(e) => setEditing({ ...editing, config: { ...editing.config, expectBody: e.target.value } })}
                  className={inputClass}
                />
              </Field>

              <Field
                label="Headers"
                hint="One per line, as Key: value. Write secrets as ${VAR_NAME} — they are read from the backend environment at request time and never stored here."
              >
                <textarea
                  value={headerText}
                  onChange={(e) => setHeaderText(e.target.value)}
                  rows={3}
                  placeholder={'Authorization: Bearer ${MY_TOKEN}'}
                  className={`${inputClass} font-mono resize-y`}
                />
              </Field>

              <label className="flex items-center gap-2 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  checked={!!editing.config.followRedirects}
                  onChange={(e) => setEditing({ ...editing, config: { ...editing.config, followRedirects: e.target.checked } })}
                  className="accent-blue-600"
                />
                Follow redirects
                <span className="text-xs text-zinc-500">(otherwise a redirect is reported as its own 3xx status)</span>
              </label>
            </>
          )}

          <div className="grid grid-cols-4 gap-4 pt-2 border-t border-zinc-800">
            <Field label="Every (s)">
              <input
                type="number"
                value={editing.intervalSec}
                onChange={(e) => setEditing({ ...editing, intervalSec: parseInt(e.target.value) || 60 })}
                className={`${inputClass} font-mono`}
              />
            </Field>
            <Field label="Timeout (ms)">
              <input
                type="number"
                value={editing.timeoutMs}
                onChange={(e) => setEditing({ ...editing, timeoutMs: parseInt(e.target.value) || 10000 })}
                className={`${inputClass} font-mono`}
              />
            </Field>
            <Field label="Fails to alert">
              <input
                type="number"
                value={editing.failuresToOpen}
                onChange={(e) => setEditing({ ...editing, failuresToOpen: parseInt(e.target.value) || 2 })}
                className={`${inputClass} font-mono`}
              />
            </Field>
            <Field label="Severity">
              <select
                className={inputClass}
                value={editing.severity}
                onChange={(e) => setEditing({ ...editing, severity: e.target.value as 'warning' | 'critical' })}
              >
                <option value="critical">Critical</option>
                <option value="warning">Warning</option>
              </select>
            </Field>
          </div>

          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={editing.enabled}
              onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })}
              className="accent-blue-600"
            />
            Enabled
          </label>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-900/20 border border-red-800 rounded text-red-200 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {!isNew && testResult && testResult.id === editingId && (
            <div className={`p-3 rounded text-sm ${testResult.result.ok ? 'bg-green-900/20 text-green-200' : 'bg-red-900/20 text-red-200'}`}>
              <div className="flex items-center gap-2">
                {testResult.result.ok ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 flex-shrink-0" />}
                <span>
                  {testResult.result.ok ? 'Check passed' : testResult.result.error}
                  {testResult.result.latencyMs != null && ` · ${testResult.result.latencyMs}ms`}
                </span>
              </div>
              <p className="mt-1 pl-6 text-xs opacity-70">
                Manual test — not recorded, and it does not change the status, uptime or alerts.
              </p>
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <Button
              onClick={handleSave}
              disabled={saving || !editing.name.trim() || !editing.target.trim()}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {saving ? <Loader className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              {isNew ? 'Create Check' : 'Save Changes'}
            </Button>
            {!isNew && (
              <Button
                variant="outline"
                onClick={() => handleTest(editingId!)}
                disabled={testing === editingId}
                className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
              >
                {testing === editingId ? <Loader className="w-4 h-4 mr-2 animate-spin" /> : <PlayCircle className="w-4 h-4 mr-2" />}
                Test now
              </Button>
            )}
            <Button variant="outline" onClick={() => { setEditing(null); setEditingId(null) }} className="border-zinc-700 text-zinc-300 hover:bg-zinc-800">
              <X className="w-4 h-4 mr-2" />
              Cancel
            </Button>
            {!isNew && (
              <Button
                variant="outline"
                onClick={() => requestDelete(editingId!)}
                className="border-red-800 text-red-400 hover:bg-red-900/30 ml-auto"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                {confirmingDelete === editingId ? 'Click again to confirm' : 'Delete'}
              </Button>
            )}
          </div>
        </Card>
      </div>
    )
  }

  // ─── List view ────────────────────────────────────────────────────
  const summary = { up: 0, down: 0, unknown: 0, paused: 0 }
  for (const c of checks) {
    if (!c.enabled) summary.paused++
    else if (!c.lastResult) summary.unknown++
    else if (c.lastResult.ok) summary.up++
    else summary.down++
  }

  // Dashboard first, then the servers in their usual order, then any
  // group left behind by a deleted server — its checks must stay visible
  const groupDefs: { key: string; label: string }[] = [
    { key: 'dashboard', label: 'Dashboard — external view' },
    ...serverKeys.map(k => ({ key: k, label: servers[k]?.displayName || k })),
  ]
  for (const c of checks) {
    if (!groupDefs.some(g => g.key === c.run_from)) groupDefs.push({ key: c.run_from, label: c.run_from })
  }
  const groups = groupDefs
    .map(g => ({ ...g, checks: checks.filter(c => c.run_from === g.key) }))
    .filter(g => g.checks.length > 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <h3 className="text-sm font-semibold text-zinc-300 flex-shrink-0">Service Checks ({checks.length})</h3>
          {checks.length > 0 && (
            <div className="flex items-center gap-1.5 text-[10px] font-semibold">
              <span className="px-2 py-0.5 rounded bg-green-900/40 text-green-300">{summary.up} UP</span>
              {summary.down > 0 && <span className="px-2 py-0.5 rounded bg-red-900/40 text-red-300">{summary.down} DOWN</span>}
              {summary.unknown > 0 && <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">{summary.unknown} UNKNOWN</span>}
              {summary.paused > 0 && <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">{summary.paused} PAUSED</span>}
            </div>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => openEditor()} className="border-blue-700 text-blue-400 hover:bg-blue-900/30 flex-shrink-0">
          <Plus className="w-4 h-4 mr-1" />
          New Check
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-900/20 border border-red-800 rounded text-red-200 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {loading ? (
        <Card className="border-zinc-700 bg-zinc-900/50 p-6 text-center text-zinc-400">
          <Loader className="w-4 h-4 animate-spin inline mr-2" />
          Loading checks…
        </Card>
      ) : checks.length === 0 ? (
        <Card className="border-zinc-700 bg-zinc-900/50 p-8 text-center space-y-2">
          <Activity className="w-8 h-8 text-zinc-600 mx-auto" />
          <p className="text-zinc-300 font-semibold">No service checks yet</p>
          <p className="text-sm text-zinc-500 max-w-lg mx-auto">
            Server metrics tell you a host is healthy. A service check tells you the thing running on it
            is actually answering — an endpoint, a port, a container, or any command that exits zero.
          </p>
          <Button variant="outline" size="sm" onClick={() => openEditor()} className="border-blue-700 text-blue-400 hover:bg-blue-900/30 mt-2">
            <Plus className="w-4 h-4 mr-1" />
            Add your first check
          </Button>
        </Card>
      ) : (
        <div className="space-y-4">
          {groups.map(group => {
            const enabledChecks = group.checks.filter(c => c.enabled)
            const up = enabledChecks.filter(c => c.lastResult?.ok).length
            const down = enabledChecks.filter(c => c.lastResult && !c.lastResult.ok).length
            const tone = down > 0 ? 'text-red-400' : up === enabledChecks.length && up > 0 ? 'text-green-500' : 'text-zinc-400'
            const isCollapsed = !!collapsed[group.key]
            return (
              <div key={group.key}>
                <button
                  onClick={() => setCollapsed(prev => ({ ...prev, [group.key]: !prev[group.key] }))}
                  className="w-full flex items-center gap-2 px-1 py-2 text-left"
                >
                  {isCollapsed ? <ChevronRight className="w-4 h-4 text-zinc-500" /> : <ChevronDown className="w-4 h-4 text-zinc-500" />}
                  <span className="text-sm font-semibold text-zinc-200">{group.label}</span>
                  <span className="text-xs text-zinc-500">{group.checks.length} {group.checks.length === 1 ? 'check' : 'checks'}</span>
                  <span className={`ml-auto text-xs font-semibold ${tone}`}>{up}/{enabledChecks.length} up</span>
                </button>

                {!isCollapsed && (
                  <div className="rounded-lg border border-zinc-700 bg-zinc-900/50 divide-y divide-zinc-800 overflow-hidden">
                    {group.checks.map(check => {
                      const Icon = KIND_META[check.kind].icon
                      const isExpanded = expanded === check.id
                      const rows = history[check.id]
                      const testR = testResult?.id === check.id ? testResult.result : null
                      return (
                        <div key={check.id}>
                          <div
                            className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-zinc-800/40"
                            onClick={() => toggleExpand(check.id)}
                          >
                            <Icon className="w-4 h-4 text-zinc-500 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-zinc-100 truncate">{check.name}</span>
                                <StatusPill check={check} />
                              </div>
                              <p className="text-xs text-zinc-500 font-mono truncate" title={check.target}>{check.target}</p>
                            </div>
                            {check.lastResult && !check.lastResult.ok && check.lastResult.error && (
                              <span className="hidden lg:block text-xs text-red-300 truncate max-w-48">{check.lastResult.error}</span>
                            )}
                            <div className="hidden sm:flex flex-col items-end w-20 text-xs flex-shrink-0">
                              <span className={check.uptime24hPct == null ? 'text-zinc-600' : check.uptime24hPct >= 99 ? 'text-green-400' : check.uptime24hPct >= 90 ? 'text-amber-400' : 'text-red-400'}>
                                {check.uptime24hPct == null ? '—' : `${check.uptime24hPct}%`}
                              </span>
                              <span className="text-zinc-600">{check.lastResult?.latencyMs != null ? `${check.lastResult.latencyMs}ms` : ''}</span>
                            </div>
                            {isExpanded
                              ? <ChevronDown className="w-4 h-4 text-zinc-500 flex-shrink-0" />
                              : <ChevronRight className="w-4 h-4 text-zinc-600 flex-shrink-0" />}
                          </div>

                          {isExpanded && (
                            <div className="px-4 pb-4 pt-1 bg-zinc-900/70 space-y-3">
                              <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-zinc-400">
                                <span><span className="text-zinc-500">Every:</span> {check.interval_sec}s</span>
                                <span><span className="text-zinc-500">Timeout:</span> {check.timeout_ms}ms</span>
                                <span><span className="text-zinc-500">Alert after:</span> {check.failures_to_open} {check.failures_to_open === 1 ? 'fail' : 'fails'}</span>
                                <span><span className="text-zinc-500">Severity:</span> {check.severity}</span>
                                <span><span className="text-zinc-500">Last checked:</span> {timeAgo(check.lastResult?.timestamp)}</span>
                                {check.avgLatencyMs24h != null && <span><span className="text-zinc-500">Avg 24h:</span> {check.avgLatencyMs24h}ms</span>}
                              </div>

                              {rows === undefined ? (
                                <div className="text-xs text-zinc-500"><Loader className="w-3 h-3 animate-spin inline mr-1" /> Loading history…</div>
                              ) : rows.length === 0 ? (
                                <p className="text-xs text-zinc-500">No recorded results yet — the loop will produce the first one shortly.</p>
                              ) : (
                                <div className="space-y-1">
                                  <Timeline rows={rows} />
                                  <p className="text-[10px] text-zinc-600">last {Math.min(rows.length, 48)} results · oldest → newest · hover for detail</p>
                                </div>
                              )}

                              {check.lastResult && !check.lastResult.ok && check.lastResult.error && (
                                <div className="flex items-center gap-2 p-2 rounded bg-red-900/20 text-red-300 text-xs">
                                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                                  <span className="truncate">{check.lastResult.error}</span>
                                </div>
                              )}

                              {testR && (
                                <div className={`p-2 rounded text-xs ${testR.ok ? 'bg-green-900/20 text-green-300' : 'bg-red-900/20 text-red-300'}`}>
                                  <div className="flex items-center gap-2">
                                    {testR.ok ? <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />}
                                    <span className="truncate">
                                      {testR.ok ? 'Check passed' : testR.error}
                                      {testR.latencyMs != null && ` · ${testR.latencyMs}ms`}
                                    </span>
                                  </div>
                                  {/* A manual probe deliberately does not count: otherwise a
                                      red dashboard could be cleared by clicking Test */}
                                  <p className="mt-1 pl-5 opacity-70">
                                    Manual test — not recorded, and it does not change the status, uptime or alerts above.
                                  </p>
                                </div>
                              )}

                              <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleTest(check.id)}
                                  disabled={testing === check.id}
                                  className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                                >
                                  {testing === check.id ? <Loader className="w-3 h-3 mr-1 animate-spin" /> : <PlayCircle className="w-3 h-3 mr-1" />}
                                  Test now
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => openEditor(check)} className="border-zinc-700 text-zinc-300 hover:bg-zinc-800">
                                  <Pencil className="w-3 h-3 mr-1" />
                                  Edit
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => requestDelete(check.id)}
                                  className="border-red-800 text-red-400 hover:bg-red-900/30 ml-auto"
                                >
                                  <Trash2 className="w-3 h-3 mr-1" />
                                  {confirmingDelete === check.id ? 'Click again to confirm' : 'Delete'}
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
