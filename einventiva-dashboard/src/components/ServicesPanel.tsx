import { useState, useEffect, useCallback, useRef } from 'react'
import type {
  ServerInfo,
  ServiceCheck,
  ServiceCheckInput,
  ServiceCheckKind,
  ServiceCheckResult,
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
  HelpCircle,
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
    const onResult = (payload: ServiceCheckResult & { checkId: string }) => {
      setChecks(prev => prev.map(c => c.id === payload.checkId
        ? { ...c, lastResult: { ok: payload.ok, latencyMs: payload.latencyMs, statusCode: payload.statusCode, error: payload.error, timestamp: payload.timestamp } }
        : c))
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
            <div className={`flex items-center gap-2 p-3 rounded text-sm ${testResult.result.ok ? 'bg-green-900/20 text-green-200' : 'bg-red-900/20 text-red-200'}`}>
              {testResult.result.ok ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 flex-shrink-0" />}
              <span>
                {testResult.result.ok ? 'Check passed' : testResult.result.error}
                {testResult.result.latencyMs != null && ` · ${testResult.result.latencyMs}ms`}
              </span>
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
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-300">Service Checks ({checks.length})</h3>
        <Button variant="outline" size="sm" onClick={() => openEditor()} className="border-blue-700 text-blue-400 hover:bg-blue-900/30">
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
        <div className="grid grid-cols-2 gap-4">
          {checks.map(check => {
            const Icon = KIND_META[check.kind].icon
            const vantage = check.run_from === 'dashboard' ? 'Dashboard' : (servers[check.run_from]?.displayName || check.run_from)
            const result = testResult?.id === check.id ? testResult.result : null
            return (
              <Card key={check.id} className="border-zinc-700 bg-zinc-900/50 p-4 flex flex-col">
                <div className="flex items-start gap-3 mb-3">
                  <Icon className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-semibold text-zinc-50 truncate">{check.name}</h4>
                      <StatusPill check={check} />
                    </div>
                    <p className="text-xs text-zinc-500 font-mono truncate mt-0.5" title={check.target}>{check.target}</p>
                  </div>
                </div>

                <div className="text-xs text-zinc-400 space-y-1 mb-3 flex-1">
                  <p>
                    <span className="text-zinc-500">From:</span> {vantage}
                    <span className="text-zinc-600"> · every {check.interval_sec}s</span>
                  </p>
                  <p>
                    <span className="text-zinc-500">24h uptime:</span>{' '}
                    {check.uptime24hPct == null ? (
                      <span className="text-zinc-500 inline-flex items-center gap-1">
                        <HelpCircle className="w-3 h-3" /> no data yet
                      </span>
                    ) : (
                      <span className={check.uptime24hPct >= 99 ? 'text-green-400' : check.uptime24hPct >= 90 ? 'text-amber-400' : 'text-red-400'}>
                        {check.uptime24hPct}%
                      </span>
                    )}
                    {check.avgLatencyMs24h != null && <span className="text-zinc-600"> · avg {check.avgLatencyMs24h}ms</span>}
                  </p>
                  {check.lastResult && !check.lastResult.ok && check.lastResult.error && (
                    <p className="text-red-300 truncate" title={check.lastResult.error}>{check.lastResult.error}</p>
                  )}
                </div>

                {result && (
                  <div className={`flex items-center gap-2 text-xs mb-3 p-2 rounded ${result.ok ? 'bg-green-900/20 text-green-300' : 'bg-red-900/20 text-red-300'}`}>
                    {result.ok ? <CheckCircle2 className="w-3 h-3 flex-shrink-0" /> : <AlertCircle className="w-3 h-3 flex-shrink-0" />}
                    <span className="truncate">
                      {result.ok ? 'Check passed' : result.error}
                      {result.latencyMs != null && ` · ${result.latencyMs}ms`}
                    </span>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                    onClick={() => handleTest(check.id)}
                    disabled={testing === check.id}
                  >
                    {testing === check.id ? <Loader className="w-3 h-3 mr-1 animate-spin" /> : <PlayCircle className="w-3 h-3 mr-1" />}
                    Test
                  </Button>
                  <Button variant="ghost" size="sm" className="text-zinc-500 hover:text-zinc-300" onClick={() => openEditor(check)}>
                    <Pencil className="w-3 h-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={confirmingDelete === check.id ? 'text-red-400' : 'text-zinc-500 hover:text-red-400'}
                    onClick={() => requestDelete(check.id)}
                    title={confirmingDelete === check.id ? 'Click again to confirm' : 'Delete'}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
