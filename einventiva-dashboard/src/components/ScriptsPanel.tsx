import { useState, useEffect, useRef, useCallback } from 'react'
import { Socket } from 'socket.io-client'
import type { ServerAlias, ScriptResult, ScriptExecution, ServerInfo } from '@/types'
import { api, ApiError } from '@/lib/api'
import { getSharedSocket, releaseSharedSocket } from '@/lib/socket'
import { useAutoScroll } from '@/hooks/useAutoScroll'
import { formatRelativeTime, formatDuration } from '@/lib/formatters'
import { parseAnsi, type AnsiState, type AnsiSegment } from '@/lib/ansi'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Code2,
  Play,
  AlertCircle,
  CheckCircle2,
  Loader,
  Terminal,
  Clock,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Shield,
  Eye,
  Lock,
  Plus,
  Pencil,
  Trash2,
  TriangleAlert,
  Layers,
  CalendarClock,
  Sparkles,
  Info,
  X,
  Save,
} from 'lucide-react'
import type { AiInterpretation } from '@/types'

interface ScriptsPanelProps {
  servers: Record<string, ServerInfo>
  serverKeys: string[]
  // Alert → script bridge: preselect a script + server on mount
  initialTarget?: { script: string; server: string; context?: string } | null
  onTargetConsumed?: () => void
}

const INTERPRET_SEV: Record<AiInterpretation['severity'], { color: string; badge: string }> = {
  ok: { color: 'text-green-400', badge: 'bg-green-900/30 text-green-400 border-green-800/50' },
  info: { color: 'text-blue-400', badge: 'bg-blue-900/30 text-blue-300 border-blue-800/60' },
  warning: { color: 'text-amber-400', badge: 'bg-amber-900/30 text-amber-300 border-amber-800/60' },
  critical: { color: 'text-red-400', badge: 'bg-red-900/40 text-red-300 border-red-800' },
}

// "Interpret with AI" affordance + result card, reused by live output
// and stored history. Sends output (by execution id when available) to
// the AI module and renders the verdict inline.
function InterpretBlock({ payload, aiConfigured }: {
  payload: { executionId?: number; script?: string; server?: string; output?: string; context?: string }
  aiConfigured: boolean
}) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<AiInterpretation | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!aiConfigured) return null

  const run = async () => {
    setLoading(true); setError(null)
    try {
      setResult(await api.interpretOutput(payload))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Interpretación falló')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="border-t border-zinc-800 bg-zinc-900/40 p-3">
      {!result && (
        <Button
          variant="outline"
          size="sm"
          onClick={run}
          disabled={loading}
          className="border-purple-800/60 text-purple-300 hover:bg-purple-900/20 text-xs"
        >
          {loading
            ? <><Loader className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Interpretando...</>
            : <><Sparkles className="w-3.5 h-3.5 mr-1.5" /> Interpretar con IA</>}
        </Button>
      )}
      {error && (
        <p className="text-xs text-red-400 mt-1 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> {error}</p>
      )}
      {result && (() => {
        const sev = INTERPRET_SEV[result.severity]
        return (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Sparkles className={`w-4 h-4 ${sev.color}`} />
              <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">Interpretación IA</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${sev.badge}`}>{result.severity}</span>
            </div>
            <p className="text-sm text-zinc-200">{result.summary}</p>
            {result.points.length > 0 && (
              <ul className="space-y-0.5">
                {result.points.map((p, i) => (
                  <li key={i} className="text-xs text-zinc-400 flex gap-1.5">
                    <span className="text-zinc-600 flex-shrink-0">•</span>{p}
                  </li>
                ))}
              </ul>
            )}
            {result.action && (
              <p className="text-xs text-zinc-300 flex items-start gap-1.5">
                <Info className="w-3 h-3 mt-0.5 flex-shrink-0 text-zinc-500" />
                <span><span className="text-zinc-500 uppercase tracking-wider text-[10px] font-semibold mr-1">Acción</span>{result.action}</span>
              </p>
            )}
          </div>
        )
      })()}
    </div>
  )
}

// Alert types a script can be tagged with (suggestion buttons on alert rows)
const TAGGABLE_ALERT_TYPES = ['cpu', 'memory', 'disk', 'disk-eta', 'inodes', 'offline', 'cron', 'ssl', 'flapping', 'systemd', 'pg-connections', 'pg-replication', 'script'] as const

interface ScriptFormData {
  id: string
  name: string
  description: string
  command: string
  destructive: boolean
  schedule: string
  scheduleServers: string[]
  alertTypes: string[]
}

const SCHEDULE_PRESETS = [
  { label: 'Hourly', expr: '0 * * * *' },
  { label: 'Every 6 hours', expr: '0 */6 * * *' },
  { label: 'Daily 03:00', expr: '0 3 * * *' },
  { label: 'Weekly Sun 04:00', expr: '0 4 * * 0' },
]

interface OutputChunk {
  stream: 'stdout' | 'stderr'
  data: string
}

// Per-server live run state; more than one key means "Run on all" mode
interface RunState {
  output: OutputChunk[]
  executing: boolean
  exitCode: number | null
}

export function ScriptsPanel({
  servers,
  serverKeys,
  initialTarget,
  onTargetConsumed,
}: ScriptsPanelProps) {
  const [server, setServer] = useState<ServerAlias>(initialTarget?.server || serverKeys[0] || 'prod')
  const [scripts, setScripts] = useState<ScriptResult[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [runs, setRuns] = useState<Record<string, RunState>>({})

  // Persisted execution history + last-run badges
  const [executions, setExecutions] = useState<ScriptExecution[]>([])
  const [latest, setLatest] = useState<Record<string, ScriptExecution>>({})
  const [expandedExec, setExpandedExec] = useState<number | null>(null)
  const [execOutputs, setExecOutputs] = useState<Record<number, string>>({})
  const [aiConfigured, setAiConfigured] = useState(false)
  // Why the current script was opened via the alert/plan bridge — fed to
  // the AI interpretation so its verdict reconciles with that concern
  const [bridge, setBridge] = useState<{ script: string; context: string } | null>(null)

  // Detail/confirmation state
  const [selected, setSelected] = useState<ScriptResult | null>(null)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [destructiveConfirm, setDestructiveConfirm] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null)
  const serverInfo = servers

  // CRUD state
  const [editing, setEditing] = useState<ScriptFormData | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [saving, setSaving] = useState(false)

  const socketRef = useRef<Socket | null>(null)
  const currentRun = runs[server]
  const runServers = Object.keys(runs)
  const runAllMode = runServers.length > 1
  const anyExecuting = Object.values(runs).some(r => r.executing)
  const scrollRef = useAutoScroll<HTMLPreElement>([currentRun?.output])

  const needsSudo = (command: string) => command.includes('sudo')

  const fetchExecutions = useCallback(async () => {
    try {
      setExecutions(await api.getScriptHistory(server, 20))
    } catch (err) {
      console.error('Failed to fetch execution history:', err)
    }
  }, [server])

  const fetchLatest = useCallback(async () => {
    try {
      setLatest(await api.getLatestExecutions(server))
    } catch (err) {
      console.error('Failed to fetch latest executions:', err)
    }
  }, [server])

  // Socket handlers are registered once; route refreshes through a ref
  // so they always see the current server selection
  const refreshRef = useRef<() => void>(() => {})
  refreshRef.current = () => {
    fetchExecutions()
    fetchLatest()
  }

  // Socket connection
  useEffect(() => {
    const socket = getSharedSocket()

    const onStart = ({ server: srv }: { script: string; server: string }) => {
      setRuns(prev => ({ ...prev, [srv]: { output: [], executing: true, exitCode: null } }))
    }

    const onOutput = ({ stream, data, server: srv }: { stream: 'stdout' | 'stderr'; data: string; server?: string }) => {
      setRuns(prev => {
        const key = srv ?? Object.keys(prev)[0]
        const run = prev[key]
        if (!run) return prev
        return { ...prev, [key]: { ...run, output: [...run.output, { stream, data }] } }
      })
    }

    const onDone = ({ code, server: srv }: { code: number; script: string; server: string }) => {
      setRuns(prev => {
        const run = prev[srv]
        if (!run) return prev
        return { ...prev, [srv]: { ...run, executing: false, exitCode: code } }
      })
      refreshRef.current()
    }

    const onError = ({ error: errMsg, server: srv }: { error: string; server?: string }) => {
      setError(errMsg)
      setRuns(prev => {
        if (!srv || !prev[srv]) return prev
        return { ...prev, [srv]: { ...prev[srv], executing: false, exitCode: prev[srv].exitCode ?? 1 } }
      })
    }

    // Scheduled runs finish server-side; refresh history and badges
    const onExecutionFinished = () => refreshRef.current()

    socket.on('script:start', onStart)
    socket.on('script:output', onOutput)
    socket.on('script:done', onDone)
    socket.on('script:error', onError)
    socket.on('execution:finished', onExecutionFinished)

    socketRef.current = socket

    return () => {
      socket.off('script:start', onStart)
      socket.off('script:output', onOutput)
      socket.off('script:done', onDone)
      socket.off('script:error', onError)
      socket.off('execution:finished', onExecutionFinished)
      releaseSharedSocket()
      socketRef.current = null
    }
  }, [])

  // Update server selection when serverKeys change
  useEffect(() => {
    if (serverKeys.length > 0 && !serverKeys.includes(server)) {
      setServer(serverKeys[0])
    }
  }, [serverKeys])

  // Gate the "Interpret with AI" button on the module being configured
  useEffect(() => {
    api.getAiConfig().then(c => setAiConfigured(c.configured)).catch(() => setAiConfigured(false))
  }, [])

  const fetchScripts = async () => {
    try {
      setLoading(true)
      setError(null)
      const scriptsData = await api.getAvailableScripts()
      setScripts(scriptsData)
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : 'Failed to fetch scripts'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchScripts()
    fetchExecutions()
    fetchLatest()
    setSelected(null)
    setPassword('')
    setDestructiveConfirm('')
    setRuns({})
    setEditing(null)
    setExpandedExec(null)
  }, [server])

  // Consume the alert → script target once the scripts list is loaded
  const pendingTarget = useRef(initialTarget || null)
  useEffect(() => {
    if (!pendingTarget.current || scripts.length === 0) return
    const target = pendingTarget.current
    const match = scripts.find(s => s.id === target.script)
    if (match) setSelected(match)
    if (target.context) setBridge({ script: target.script, context: target.context })
    pendingTarget.current = null
    onTargetConsumed?.()
  }, [scripts])

  // Destructive scripts stay disabled until the user types the script id
  const destructiveArmed = !selected?.destructive || destructiveConfirm.trim() === selected.id
  const sudoReady = !selected || !needsSudo(selected.command) || password.length > 0

  const resetRun = () => {
    setRuns({})
    setDestructiveConfirm('')
  }

  const handleRunScript = () => {
    if (!selected || !socketRef.current) return
    setError(null)
    setRuns({ [server]: { output: [], executing: true, exitCode: null } })
    socketRef.current.emit('execute:script', {
      server,
      script: selected.id,
      password: needsSudo(selected.command) ? password : undefined,
    })
    setPassword('')
    setDestructiveConfirm('')
  }

  const handleRunAll = () => {
    if (!selected || !socketRef.current) return
    setError(null)
    const initial: Record<string, RunState> = {}
    for (const key of serverKeys) {
      initial[key] = { output: [], executing: true, exitCode: null }
    }
    setRuns(initial)
    for (const key of serverKeys) {
      socketRef.current.emit('execute:script', {
        server: key,
        script: selected.id,
        password: needsSudo(selected.command) ? password : undefined,
      })
    }
    setPassword('')
    setDestructiveConfirm('')
  }

  const toggleExecution = async (exec: ScriptExecution) => {
    if (expandedExec === exec.id) {
      setExpandedExec(null)
      return
    }
    setExpandedExec(exec.id)
    if (execOutputs[exec.id] === undefined && (exec.output_bytes ?? 0) > 0) {
      try {
        const full = await api.getExecution(exec.id)
        setExecOutputs(prev => ({ ...prev, [exec.id]: full.output || '' }))
      } catch (err) {
        console.error('Failed to fetch execution output:', err)
        setExecOutputs(prev => ({ ...prev, [exec.id]: '(failed to load output)' }))
      }
    }
  }

  // CRUD handlers
  const handleNewScript = () => {
    setEditing({ id: '', name: '', description: '', command: '', destructive: false, schedule: '', scheduleServers: [], alertTypes: [] })
    setIsNew(true)
    setSelected(null)
  }

  const handleEditScript = (script: ScriptResult) => {
    setEditing({
      id: script.id,
      name: script.name,
      description: script.description,
      command: script.command,
      destructive: script.destructive,
      schedule: script.schedule || '',
      scheduleServers: script.scheduleServers === '*' ? [] : script.scheduleServers.split(',').map(s => s.trim()).filter(Boolean),
      alertTypes: script.alertTypes,
    })
    setIsNew(false)
    setSelected(null)
  }

  const handleDeleteScript = async (scriptId: string) => {
    try {
      await api.deleteScript(scriptId)
      await fetchScripts()
      setSelected(null)
      setEditing(null)
      setConfirmingDelete(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete script')
    }
  }

  // Two-step delete: first click arms, second click (within 4s) deletes
  const requestDelete = (scriptId: string) => {
    if (confirmingDelete === scriptId) {
      handleDeleteScript(scriptId)
      return
    }
    setConfirmingDelete(scriptId)
    setTimeout(() => setConfirmingDelete(prev => (prev === scriptId ? null : prev)), 4000)
  }

  const handleSaveScript = async () => {
    if (!editing) return
    setSaving(true)
    setError(null)
    try {
      const scheduleFields = {
        schedule: editing.schedule.trim() || null,
        scheduleServers: editing.scheduleServers.length > 0 ? editing.scheduleServers.join(',') : '*',
        alertTypes: editing.alertTypes.join(','),
      }
      if (isNew) {
        const id = editing.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
        await api.createScript({
          id,
          name: editing.name,
          description: editing.description,
          command: editing.command,
          destructive: editing.destructive,
          ...scheduleFields,
        })
      } else {
        await api.updateScript(editing.id, {
          name: editing.name,
          description: editing.description,
          command: editing.command,
          destructive: editing.destructive,
          ...scheduleFields,
        })
      }
      await fetchScripts()
      setEditing(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save script')
    } finally {
      setSaving(false)
    }
  }

  // ANSI-aware rendering: real terminal colors when the output carries
  // escape codes, stream defaults (green/amber) otherwise. Style state
  // threads across chunks so colors survive chunk boundaries.
  const renderAnsiSegments = (segments: AnsiSegment[], fallbackClass: string, keyPrefix: string) =>
    segments.map((seg, i) => {
      const styled = seg.color || seg.bgColor || seg.bold || seg.dim
      return (
        <span
          key={`${keyPrefix}-${i}`}
          className={styled ? undefined : fallbackClass}
          style={styled ? {
            color: seg.color,
            backgroundColor: seg.bgColor,
            fontWeight: seg.bold ? 600 : undefined,
            opacity: seg.dim ? 0.7 : undefined,
          } : undefined}
        >
          {seg.text}
        </span>
      )
    })

  const renderOutputChunks = (chunks: OutputChunk[]) => {
    let state: AnsiState = {}
    return chunks.map((chunk, i) => {
      const { segments, endState } = parseAnsi(chunk.data, state)
      state = endState
      return renderAnsiSegments(
        segments,
        chunk.stream === 'stderr' ? 'text-amber-400' : 'text-green-400',
        String(i)
      )
    })
  }

  const renderStoredOutput = (text: string) =>
    renderAnsiSegments(parseAnsi(text).segments, 'text-zinc-300', 'h')

  const LastRunBadge = ({ exec }: { exec: ScriptExecution | undefined }) => {
    if (!exec) {
      return <span className="text-xs text-zinc-600">never run</span>
    }
    const ok = exec.exit_code === 0
    return (
      <span
        className={`flex items-center gap-1 text-xs ${ok ? 'text-green-500' : 'text-red-400'}`}
        title={`${new Date(exec.started_at).toLocaleString()} — exit ${exec.exit_code}, ${formatDuration(exec.duration_ms)}`}
      >
        {ok ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
        {ok ? '' : `exit ${exec.exit_code} · `}
        {formatRelativeTime(exec.started_at)} · {formatDuration(exec.duration_ms)}
      </span>
    )
  }

  // Editor view
  if (editing) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setEditing(null)}
            className="text-zinc-400 hover:text-zinc-200"
          >
            <ChevronLeft className="w-4 h-4 mr-1" />
            Back
          </Button>
          <h3 className="text-sm font-semibold text-zinc-300">
            {isNew ? 'New Script' : 'Edit Script'}
          </h3>
        </div>

        <Card className="border-zinc-700 bg-zinc-900/50 p-6 space-y-4">
          <div>
            <label className="text-xs text-zinc-400 font-semibold uppercase tracking-wider block mb-1">
              Name
            </label>
            <input
              type="text"
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              placeholder="Script name..."
              className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-50 placeholder:text-zinc-600 focus:outline-none focus:border-blue-600"
            />
          </div>

          <div>
            <label className="text-xs text-zinc-400 font-semibold uppercase tracking-wider block mb-1">
              Description
            </label>
            <input
              type="text"
              value={editing.description}
              onChange={(e) => setEditing({ ...editing, description: e.target.value })}
              placeholder="What does this script do..."
              className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-50 placeholder:text-zinc-600 focus:outline-none focus:border-blue-600"
            />
          </div>

          <div>
            <label className="text-xs text-zinc-400 font-semibold uppercase tracking-wider block mb-1">
              Command
            </label>
            <textarea
              value={editing.command}
              onChange={(e) => setEditing({ ...editing, command: e.target.value })}
              placeholder="Shell command to execute..."
              rows={4}
              className="w-full bg-black border border-zinc-700 rounded px-3 py-2 text-sm text-green-400 font-mono placeholder:text-zinc-600 focus:outline-none focus:border-blue-600 resize-y"
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={editing.destructive}
              onChange={(e) => setEditing({ ...editing, destructive: e.target.checked })}
              className="accent-red-600"
            />
            <TriangleAlert className="w-3.5 h-3.5 text-red-400" />
            <span className="text-xs text-zinc-300">
              Destructive — deletes data or disrupts services; executing it requires typing the script id
            </span>
          </label>

          <div className="border-t border-zinc-800 pt-4 space-y-2">
            <label className="text-xs text-zinc-400 font-semibold uppercase tracking-wider block">
              Suggest for alerts (optional)
            </label>
            <p className="text-xs text-zinc-500">
              Active alerts of these types will show a shortcut button to this script.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {TAGGABLE_ALERT_TYPES.map(t => {
                const on = editing.alertTypes.includes(t)
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setEditing({
                      ...editing,
                      alertTypes: on ? editing.alertTypes.filter(x => x !== t) : [...editing.alertTypes, t],
                    })}
                    className={`text-xs px-2 py-1 rounded border font-mono transition-colors ${on
                      ? 'border-blue-700 bg-blue-900/30 text-blue-300'
                      : 'border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600'}`}
                  >
                    {t}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="border-t border-zinc-800 pt-4 space-y-3">
            <div className="flex items-center gap-2">
              <CalendarClock className="w-4 h-4 text-blue-400" />
              <label className="text-xs text-zinc-400 font-semibold uppercase tracking-wider">
                Schedule (optional)
              </label>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={editing.schedule}
                onChange={(e) => setEditing({ ...editing, schedule: e.target.value })}
                placeholder="cron expression, e.g. 0 3 * * *  (empty = manual only)"
                className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-50 font-mono placeholder:text-zinc-600 focus:outline-none focus:border-blue-600"
              />
              {SCHEDULE_PRESETS.map(p => (
                <Button
                  key={p.expr}
                  variant="outline"
                  size="sm"
                  onClick={() => setEditing({ ...editing, schedule: p.expr })}
                  className={`border-zinc-700 text-xs ${editing.schedule === p.expr ? 'text-blue-400 border-blue-800' : 'text-zinc-400'} hover:bg-zinc-800`}
                >
                  {p.label}
                </Button>
              ))}
            </div>
            {editing.schedule.trim() && (
              <div className="space-y-2">
                <p className="text-xs text-zinc-500">
                  Runs on: {editing.scheduleServers.length === 0 ? 'all servers' : editing.scheduleServers.join(', ')}
                </p>
                <div className="flex items-center gap-4">
                  {serverKeys.map(k => (
                    <label key={k} className="flex items-center gap-1.5 cursor-pointer select-none text-xs text-zinc-300">
                      <input
                        type="checkbox"
                        checked={editing.scheduleServers.length === 0 || editing.scheduleServers.includes(k)}
                        onChange={(e) => {
                          const current = editing.scheduleServers.length === 0 ? [...serverKeys] : [...editing.scheduleServers]
                          const next = e.target.checked ? [...new Set([...current, k])] : current.filter(s => s !== k)
                          // all selected -> store as '*' (empty list)
                          setEditing({ ...editing, scheduleServers: next.length === serverKeys.length ? [] : next })
                        }}
                        className="accent-blue-600"
                      />
                      {serverInfo[k]?.displayName || k}
                    </label>
                  ))}
                </div>
                {editing.command.includes('sudo') && (
                  <p className="text-xs text-amber-400/80">
                    Scheduled runs execute without a password — this script uses sudo, so the servers need passwordless sudo.
                  </p>
                )}
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-900/20 border border-red-800 rounded text-red-200 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <Button
              onClick={handleSaveScript}
              disabled={saving || !editing.name || !editing.command}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {saving ? (
                <Loader className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Save className="w-4 h-4 mr-2" />
              )}
              {isNew ? 'Create Script' : 'Save Changes'}
            </Button>
            <Button
              variant="outline"
              onClick={() => setEditing(null)}
              className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
            >
              <X className="w-4 h-4 mr-2" />
              Cancel
            </Button>
            {!isNew && (
              <Button
                variant="outline"
                onClick={() => requestDelete(editing.id)}
                className="border-red-800 text-red-400 hover:bg-red-900/30 ml-auto"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                {confirmingDelete === editing.id ? 'Confirm delete?' : 'Delete'}
              </Button>
            )}
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Server Selector + New Script Button */}
      <div className="flex items-center gap-4">
        <span className="text-sm text-zinc-400">Target Server:</span>
        <Select value={server} onValueChange={(v) => setServer(v as ServerAlias)}>
          <SelectTrigger className="w-40 border-zinc-700 bg-zinc-900 text-zinc-50">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="border-zinc-700 bg-zinc-900">
            {serverKeys.map(k => (
              <SelectItem key={k} value={k}>{serverInfo[k]?.displayName || k}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {serverInfo[server] && (
          <span className="text-xs text-zinc-500 font-mono">
            {serverInfo[server].user}@{serverInfo[server].ip}:{serverInfo[server].port}
          </span>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={handleNewScript}
          className="ml-auto border-blue-700 text-blue-400 hover:bg-blue-900/30"
        >
          <Plus className="w-4 h-4 mr-1" />
          New Script
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-900/20 border border-red-800 rounded text-red-200 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Detail View */}
      {selected ? (
        <div className="space-y-4">
          <Card className={`${selected.destructive ? 'border-red-900/70' : 'border-zinc-700'} bg-zinc-900/50 overflow-hidden`}>
            {/* Header */}
            <div className="bg-zinc-900 border-b border-zinc-700 p-4 flex items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setSelected(null); setPassword(''); setDestructiveConfirm(''); setRuns({}) }}
                className="text-zinc-400 hover:text-zinc-200 -ml-2"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Code2 className="w-5 h-5 text-blue-400" />
              <div className="flex-1">
                <h3 className="font-mono text-sm font-semibold text-zinc-50">
                  {selected.name}
                </h3>
                <p className="text-xs text-zinc-400">{selected.description}</p>
              </div>
              {selected.destructive && (
                <span className="flex items-center gap-1 text-xs text-red-400 bg-red-900/30 px-2 py-1 rounded">
                  <TriangleAlert className="w-3 h-3" />
                  destructive
                </span>
              )}
              {needsSudo(selected.command) && (
                <span className="flex items-center gap-1 text-xs text-amber-400 bg-amber-900/30 px-2 py-1 rounded">
                  <Shield className="w-3 h-3" />
                  sudo
                </span>
              )}
            </div>

            {/* Command preview */}
            <div className="p-4 border-b border-zinc-700">
              <p className="text-xs text-zinc-500 mb-2 font-semibold uppercase tracking-wider">
                Command to execute
              </p>
              <div className="bg-black rounded p-3">
                <pre className="font-mono text-xs text-green-400 whitespace-pre-wrap break-all">
                  <span className="text-zinc-500">$ </span>{selected.command}
                </pre>
              </div>
              <div className="text-xs text-zinc-500 mt-2 space-y-1">
                <p>
                  Target: <span className="text-zinc-300">{serverInfo[server]?.displayName || server}</span>
                </p>
                {serverInfo[server] && (
                  <p className="font-mono">
                    SSH: <span className="text-zinc-300">{serverInfo[server].user}@{serverInfo[server].ip}:{serverInfo[server].port}</span>
                  </p>
                )}
              </div>
            </div>

            {/* Destructive confirmation */}
            {selected.destructive && !anyExecuting && runServers.length === 0 && (
              <div className="p-4 border-b border-zinc-700 bg-red-900/10">
                <div className="flex items-center gap-2 mb-2">
                  <TriangleAlert className="w-3 h-3 text-red-400" />
                  <p className="text-xs text-red-300 font-semibold">
                    Destructive script — type <span className="font-mono bg-red-900/40 px-1 rounded">{selected.id}</span> to enable execution
                  </p>
                </div>
                <input
                  type="text"
                  value={destructiveConfirm}
                  onChange={(e) => setDestructiveConfirm(e.target.value)}
                  placeholder={selected.id}
                  autoComplete="off"
                  className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-50 font-mono placeholder:text-zinc-700 focus:outline-none focus:border-red-600"
                />
              </div>
            )}

            {/* Sudo password input */}
            {needsSudo(selected.command) && !anyExecuting && runServers.length === 0 && (
              <div className="p-4 border-b border-zinc-700 bg-amber-900/10">
                <div className="flex items-center gap-2 mb-2">
                  <Lock className="w-3 h-3 text-amber-400" />
                  <p className="text-xs text-amber-300 font-semibold">
                    Requires sudo
                    {serverInfo[server] && (
                      <span className="text-amber-400/70 font-normal">
                        {' '}— enter password for <span className="font-mono font-semibold">{serverInfo[server].user}</span>
                      </span>
                    )}
                  </p>
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && password && destructiveArmed) handleRunScript()
                    }}
                    placeholder="Enter sudo password..."
                    className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-50 font-mono placeholder:text-zinc-600 focus:outline-none focus:border-amber-600 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* Execute / status bar */}
            <div className="p-4">
              {anyExecuting ? (
                <div className="flex items-center gap-3 text-amber-400 text-sm">
                  <Loader className="w-4 h-4 animate-spin" />
                  <span>
                    {runAllMode
                      ? `Executing on ${runServers.filter(k => runs[k].executing).length}/${runServers.length} servers...`
                      : `Executing on ${serverInfo[server]?.displayName || server}...`}
                  </span>
                </div>
              ) : runServers.length > 0 ? (
                <div className="flex items-center justify-between">
                  {runAllMode ? (
                    <div className="flex items-center gap-3 text-sm">
                      {runServers.every(k => runs[k].exitCode === 0) ? (
                        <span className="flex items-center gap-2 text-green-400">
                          <CheckCircle2 className="w-4 h-4" />
                          Completed on all {runServers.length} servers
                        </span>
                      ) : (
                        <span className="flex items-center gap-2 text-red-400">
                          <AlertCircle className="w-4 h-4" />
                          Failed on {runServers.filter(k => runs[k].exitCode !== 0).length}/{runServers.length} servers
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className={`flex items-center gap-2 text-sm ${currentRun?.exitCode === 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {currentRun?.exitCode === 0 ? (
                        <CheckCircle2 className="w-4 h-4" />
                      ) : (
                        <AlertCircle className="w-4 h-4" />
                      )}
                      <span>
                        {currentRun?.exitCode === 0 ? 'Completed successfully' : `Failed with exit code ${currentRun?.exitCode}`}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={resetRun}
                      className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                    >
                      Run again
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { setSelected(null); setPassword(''); setDestructiveConfirm(''); setRuns({}) }}
                      className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                    >
                      <ChevronLeft className="w-3 h-3 mr-1" />
                      Back to Scripts
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <Button
                      onClick={handleRunScript}
                      disabled={!destructiveArmed || !sudoReady}
                      className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      <Play className="w-4 h-4 mr-2" />
                      Execute on {serverInfo[server]?.displayName || server}
                    </Button>
                    {serverKeys.length > 1 && (
                      <Button
                        onClick={handleRunAll}
                        disabled={!destructiveArmed || !sudoReady}
                        variant="outline"
                        className="border-zinc-600 text-zinc-200 hover:bg-zinc-800"
                        title="Execute this script on every server, side by side"
                      >
                        <Layers className="w-4 h-4 mr-2" />
                        Run on all ({serverKeys.length})
                      </Button>
                    )}
                  </div>
                  {serverKeys.length > 1 && needsSudo(selected.command) && (
                    <p className="text-xs text-zinc-500">
                      Run on all uses the same sudo password for every server.
                    </p>
                  )}
                </div>
              )}
            </div>
          </Card>

          {/* Live output — one pane per server in Run on all mode */}
          {runAllMode ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
              {runServers.map((key) => {
                const run = runs[key]
                return (
                  <Card key={key} className="border-zinc-700 bg-zinc-900/50 overflow-hidden">
                    <div className="bg-zinc-900 border-b border-zinc-700 p-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Terminal className="w-4 h-4 text-green-400" />
                        <span className="text-xs font-semibold text-zinc-300">
                          {serverInfo[key]?.displayName || key}
                        </span>
                      </div>
                      {run.executing ? (
                        <Loader className="w-3.5 h-3.5 text-amber-400 animate-spin" />
                      ) : run.exitCode === 0 ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-red-400">
                          <AlertCircle className="w-3.5 h-3.5" />
                          exit {run.exitCode}
                        </span>
                      )}
                    </div>
                    <pre className="h-64 overflow-auto bg-black p-3 font-mono text-xs whitespace-pre-wrap break-words">
                      {renderOutputChunks(run.output)}
                      {run.executing && <span className="text-zinc-500 animate-pulse">_</span>}
                      {!run.executing && run.output.length === 0 && (
                        <span className="text-zinc-500">(no output)</span>
                      )}
                    </pre>
                  </Card>
                )
              })}
            </div>
          ) : (
            (currentRun) && (
              <Card className="border-zinc-700 bg-zinc-900/50 overflow-hidden">
                <div className="bg-zinc-900 border-b border-zinc-700 p-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-green-400" />
                    <span className="text-xs font-semibold text-zinc-300">Live Output</span>
                    {currentRun.executing && (
                      <span className="flex items-center gap-1 text-xs text-amber-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                        streaming
                      </span>
                    )}
                  </div>
                  {currentRun.output.length > 0 && (
                    <span className="text-xs text-zinc-500">
                      {currentRun.output.map(c => c.data).join('').split('\n').length} lines
                    </span>
                  )}
                </div>
                <pre
                  ref={scrollRef}
                  className="h-80 overflow-auto bg-black p-3 font-mono text-xs whitespace-pre-wrap break-words"
                >
                  {renderOutputChunks(currentRun.output)}
                  {currentRun.executing && (
                    <span className="text-zinc-500 animate-pulse">_</span>
                  )}
                  {!currentRun.executing && currentRun.output.length === 0 && currentRun.exitCode !== null && (
                    <span className="text-zinc-500">(no output)</span>
                  )}
                </pre>
                {!currentRun.executing && currentRun.output.length > 0 && (
                  <InterpretBlock
                    aiConfigured={aiConfigured}
                    payload={{
                      script: selected?.id,
                      server,
                      output: currentRun.output.map(c => c.data).join(''),
                      context: bridge && selected?.id === bridge.script ? bridge.context : undefined,
                    }}
                  />
                )}
              </Card>
            )
          )}
        </div>
      ) : (
        /* Scripts Grid */
        <div>
          <h3 className="text-sm font-semibold text-zinc-300 mb-4">
            Available Scripts
          </h3>
          {loading ? (
            <div className="grid grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => (
                <Card
                  key={i}
                  className="border-zinc-700 bg-zinc-900/50 p-4 animate-pulse"
                >
                  <div className="space-y-3">
                    <div className="h-5 bg-zinc-800 rounded w-24" />
                    <div className="h-4 bg-zinc-800 rounded w-32" />
                    <div className="h-10 bg-zinc-800 rounded" />
                  </div>
                </Card>
              ))}
            </div>
          ) : scripts.length === 0 ? (
            <Card className="border-zinc-700 bg-zinc-900/50 p-6 text-center text-zinc-400">
              No scripts available
            </Card>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              {scripts.map((script) => (
                <Card
                  key={script.id}
                  className={`${script.destructive ? 'border-red-900/60 hover:border-red-800' : 'border-zinc-700 hover:border-zinc-600'} bg-zinc-900/50 p-4 flex flex-col cursor-pointer transition-colors`}
                  onClick={() => setSelected(script)}
                >
                  <div className="flex items-start gap-3 mb-3">
                    <Code2 className="w-5 h-5 text-blue-400 flex-shrink-0 mt-1" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="font-mono text-sm font-semibold text-zinc-50 truncate">
                          {script.name}
                        </h4>
                        {script.destructive && (
                          <TriangleAlert className="w-3 h-3 text-red-400 flex-shrink-0" />
                        )}
                        {needsSudo(script.command) && (
                          <Shield className="w-3 h-3 text-amber-400 flex-shrink-0" />
                        )}
                      </div>
                      <LastRunBadge exec={latest[script.id]} />
                    </div>
                  </div>
                  {script.schedule && (
                    <span
                      className="flex items-center gap-1 text-xs text-blue-400/90 mb-2"
                      title={`Scheduled: ${script.schedule} on ${script.scheduleServers === '*' ? 'all servers' : script.scheduleServers}`}
                    >
                      <CalendarClock className="w-3 h-3" />
                      <span className="font-mono">{script.schedule}</span>
                      <span className="text-zinc-500">· {script.scheduleServers === '*' ? 'all servers' : script.scheduleServers}</span>
                    </span>
                  )}
                  <p className="text-xs text-zinc-400 mb-3 flex-1 line-clamp-2">
                    {script.description}
                  </p>
                  <p className="text-xs text-zinc-600 font-mono truncate mb-3">
                    {script.command}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelected(script)
                      }}
                    >
                      <Play className="w-3 h-3 mr-1" />
                      Run
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-zinc-500 hover:text-zinc-300"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleEditScript(script)
                      }}
                    >
                      <Pencil className="w-3 h-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={confirmingDelete === script.id
                        ? 'text-red-400 bg-red-900/30 hover:bg-red-900/50'
                        : 'text-zinc-500 hover:text-red-400'}
                      onClick={(e) => {
                        e.stopPropagation()
                        requestDelete(script.id)
                      }}
                    >
                      {confirmingDelete === script.id ? (
                        <span className="text-xs px-1">Confirm?</span>
                      ) : (
                        <Trash2 className="w-3 h-3" />
                      )}
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Execution History (persisted) */}
      {executions.length > 0 && !selected && (
        <Card className="border-zinc-700 bg-zinc-900/50 overflow-hidden">
          <div className="bg-zinc-900 border-b border-zinc-700 p-3 flex items-center gap-2">
            <Clock className="w-4 h-4 text-zinc-400" />
            <span className="text-xs font-semibold text-zinc-300">
              Execution History — {serverInfo[server]?.displayName || server}
            </span>
          </div>
          <div className="divide-y divide-zinc-800">
            {executions.map((exec) => {
              const ok = exec.exit_code === 0
              const hasOutput = (exec.output_bytes ?? 0) > 0
              const expanded = expandedExec === exec.id
              return (
                <div key={exec.id}>
                  <div
                    className={`p-3 flex items-center gap-3 transition-colors ${hasOutput ? 'cursor-pointer hover:bg-zinc-800/50' : ''}`}
                    onClick={() => hasOutput && toggleExecution(exec)}
                  >
                    {hasOutput ? (
                      expanded
                        ? <ChevronDown className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />
                        : <ChevronRight className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />
                    ) : (
                      <span className="w-3.5 flex-shrink-0" />
                    )}
                    {ok ? (
                      <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                    )}
                    <span className="font-mono text-sm text-zinc-200 flex-1 truncate">
                      {exec.script_id || '(unknown)'}
                      {exec.triggered_by === 'schedule' && (
                        <span className="ml-2 text-[10px] text-blue-400 bg-blue-900/30 px-1.5 py-0.5 rounded uppercase tracking-wider">auto</span>
                      )}
                    </span>
                    {!ok && (
                      <span className="text-xs text-red-400 font-mono">exit {exec.exit_code}</span>
                    )}
                    <span className="text-xs text-zinc-500 font-mono">{formatDuration(exec.duration_ms)}</span>
                    <span
                      className="text-xs text-zinc-500"
                      title={new Date(exec.started_at).toLocaleString()}
                    >
                      {formatRelativeTime(exec.started_at)}
                    </span>
                  </div>
                  {expanded && (
                    <>
                      <pre className="max-h-64 overflow-auto bg-black border-t border-zinc-800 p-3 font-mono text-xs text-zinc-300 whitespace-pre-wrap break-words">
                        {execOutputs[exec.id] === undefined
                          ? 'Loading output...'
                          : execOutputs[exec.id]
                            ? renderStoredOutput(execOutputs[exec.id])
                            : '(no output)'}
                      </pre>
                      {hasOutput && execOutputs[exec.id] && (
                        <InterpretBlock
                          aiConfigured={aiConfigured}
                          payload={{ executionId: exec.id, script: exec.script_id, server: exec.server }}
                        />
                      )}
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </Card>
      )}
    </div>
  )
}
