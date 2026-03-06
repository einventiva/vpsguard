import { useState, useEffect, useRef } from 'react'
import { Socket } from 'socket.io-client'
import type { ServerAlias, CrontabEntry, ServerInfo } from '@/types'
import { api, ApiError } from '@/lib/api'
import { getSharedSocket, releaseSharedSocket } from '@/lib/socket'
import { useAutoScroll } from '@/hooks/useAutoScroll'
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
  AlertCircle,
  CalendarClock,
  ChevronLeft,
  Loader,
  Pause,
  Pencil,
  Play,
  Plus,
  Terminal,
  Trash2,
} from 'lucide-react'

interface CrontabPanelProps {
  servers: Record<string, ServerInfo>
  serverKeys: string[]
}

const PRESETS = [
  { label: 'Cada hora', minute: '0', hour: '*', dayOfMonth: '*', month: '*', dayOfWeek: '*' },
  { label: 'Diario 3am', minute: '0', hour: '3', dayOfMonth: '*', month: '*', dayOfWeek: '*' },
  { label: 'Semanal lunes', minute: '0', hour: '0', dayOfMonth: '*', month: '*', dayOfWeek: '1' },
  { label: 'Cada 15 min', minute: '*/15', hour: '*', dayOfMonth: '*', month: '*', dayOfWeek: '*' },
]

function describeCron(m: string, h: string, dom: string, mon: string, dow: string): string {
  const parts: string[] = []

  if (m === '*/15' && h === '*') return 'Every 15 minutes'
  if (m === '*/5' && h === '*') return 'Every 5 minutes'
  if (m === '*/30' && h === '*') return 'Every 30 minutes'
  if (m === '0' && h === '*') return 'Every hour'

  if (m === '*' && h === '*' && dom === '*' && mon === '*' && dow === '*') return 'Every minute'

  if (h !== '*') {
    const hour = parseInt(h)
    const min = m === '0' ? '00' : m
    if (!isNaN(hour)) {
      parts.push(`at ${hour}:${min.padStart(2, '0')}`)
    } else {
      parts.push(`hour ${h}, min ${m}`)
    }
  } else if (m !== '*') {
    parts.push(`at minute ${m}`)
  }

  if (dow !== '*') {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const d = parseInt(dow)
    parts.push(days[d] ? `on ${days[d]}` : `day-of-week ${dow}`)
  }

  if (dom !== '*') parts.push(`on day ${dom}`)
  if (mon !== '*') parts.push(`in month ${mon}`)

  return parts.length ? parts.join(', ') : `${m} ${h} ${dom} ${mon} ${dow}`
}

export function CrontabPanel({ servers, serverKeys }: CrontabPanelProps) {
  const [server, setServer] = useState<ServerAlias>(serverKeys[0] || 'prod')
  const [entries, setEntries] = useState<CrontabEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const serverInfo = servers
  const [busy, setBusy] = useState<number | null>(null)

  // Editor state
  const [editing, setEditing] = useState<CrontabEntry | 'new' | null>(null)
  const [formMinute, setFormMinute] = useState('*')
  const [formHour, setFormHour] = useState('*')
  const [formDom, setFormDom] = useState('*')
  const [formMonth, setFormMonth] = useState('*')
  const [formDow, setFormDow] = useState('*')
  const [formCommand, setFormCommand] = useState('')
  const [saving, setSaving] = useState(false)

  // Test execution state
  const [testOutput, setTestOutput] = useState<string[]>([])
  const [testRunning, setTestRunning] = useState(false)
  const [testExitCode, setTestExitCode] = useState<number | null>(null)

  const socketRef = useRef<Socket | null>(null)
  const scrollRef = useAutoScroll<HTMLPreElement>([testOutput])

  // Socket connection for test execution
  useEffect(() => {
    const socket = getSharedSocket()

    const onStart = () => {
      setTestRunning(true)
      setTestExitCode(null)
    }

    const onOutput = ({ data }: { stream: string; data: string }) => {
      setTestOutput((prev) => [...prev, data])
    }

    const onDone = ({ code }: { code: number }) => {
      setTestRunning(false)
      setTestExitCode(code)
    }

    const onError = ({ error: errMsg }: { error: string }) => {
      setTestRunning(false)
      setError(errMsg)
    }

    socket.on('crontab:start', onStart)
    socket.on('crontab:output', onOutput)
    socket.on('crontab:done', onDone)
    socket.on('crontab:error', onError)

    socketRef.current = socket

    return () => {
      socket.off('crontab:start', onStart)
      socket.off('crontab:output', onOutput)
      socket.off('crontab:done', onDone)
      socket.off('crontab:error', onError)
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

  // Fetch crontab entries
  const fetchEntries = async (srv: ServerAlias) => {
    try {
      setLoading(true)
      setError(null)
      const data = await api.getCrontab(srv)
      setEntries(data)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to fetch crontab')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchEntries(server)
    setEditing(null)
    resetForm()
  }, [server])

  const resetForm = () => {
    setFormMinute('*')
    setFormHour('*')
    setFormDom('*')
    setFormMonth('*')
    setFormDow('*')
    setFormCommand('')
    setTestOutput([])
    setTestExitCode(null)
    setTestRunning(false)
  }

  const openEditor = (entry: CrontabEntry | 'new') => {
    if (entry === 'new') {
      resetForm()
    } else {
      setFormMinute(entry.minute)
      setFormHour(entry.hour)
      setFormDom(entry.dayOfMonth)
      setFormMonth(entry.month)
      setFormDow(entry.dayOfWeek)
      setFormCommand(entry.command)
      setTestOutput([])
      setTestExitCode(null)
    }
    setEditing(entry)
  }

  const handleSave = async () => {
    if (!formCommand.trim()) return
    setSaving(true)
    setError(null)
    try {
      const payload = {
        minute: formMinute,
        hour: formHour,
        dayOfMonth: formDom,
        month: formMonth,
        dayOfWeek: formDow,
        command: formCommand.trim(),
      }
      if (editing === 'new') {
        await api.addCrontabEntry(server, payload)
      } else if (editing) {
        await api.updateCrontabEntry(server, editing.index, payload)
      }
      await fetchEntries(server)
      setEditing(null)
      resetForm()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (index: number) => {
    setBusy(index)
    try {
      await api.deleteCrontabEntry(server, index)
      await fetchEntries(server)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete')
    } finally {
      setBusy(null)
    }
  }

  const handleToggle = async (index: number) => {
    setBusy(index)
    try {
      await api.toggleCrontabEntry(server, index)
      await fetchEntries(server)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to toggle')
    } finally {
      setBusy(null)
    }
  }

  const handleTest = () => {
    if (!socketRef.current || !formCommand.trim()) return
    setTestOutput([])
    setTestExitCode(null)
    setError(null)
    socketRef.current.emit('crontab:test', {
      server,
      command: formCommand.trim(),
    })
  }

  const applyPreset = (preset: (typeof PRESETS)[0]) => {
    setFormMinute(preset.minute)
    setFormHour(preset.hour)
    setFormDom(preset.dayOfMonth)
    setFormMonth(preset.month)
    setFormDow(preset.dayOfWeek)
  }

  const cronPreview = `${formMinute} ${formHour} ${formDom} ${formMonth} ${formDow} ${formCommand}`

  // ─── Editor View ──────────────────────────────────────────────────
  if (editing !== null) {
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setEditing(null)
              resetForm()
            }}
            className="text-zinc-400 hover:text-zinc-200 -ml-2"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <CalendarClock className="w-5 h-5 text-blue-400" />
          <h3 className="text-sm font-semibold text-zinc-200">
            {editing === 'new' ? 'New Cron Job' : 'Edit Cron Job'}
          </h3>
          {serverInfo[server] && (
            <span className="text-xs text-zinc-500 font-mono ml-auto">
              {serverInfo[server].user}@{serverInfo[server].ip}:{serverInfo[server].port}
            </span>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-900/20 border border-red-800 rounded text-red-200 text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        <Card className="border-zinc-700 bg-zinc-900/50 overflow-hidden">
          {/* Schedule fields */}
          <div className="p-4 border-b border-zinc-700">
            <p className="text-xs text-zinc-500 mb-3 font-semibold uppercase tracking-wider">
              Schedule
            </p>

            {/* Presets */}
            <div className="flex gap-2 mb-4">
              {PRESETS.map((preset) => (
                <Button
                  key={preset.label}
                  variant="outline"
                  size="sm"
                  onClick={() => applyPreset(preset)}
                  className="border-zinc-700 text-zinc-300 hover:bg-zinc-800 text-xs"
                >
                  {preset.label}
                </Button>
              ))}
            </div>

            {/* Cron fields */}
            <div className="grid grid-cols-5 gap-3">
              {[
                { label: 'Minute', value: formMinute, set: setFormMinute, ph: '0-59, */5' },
                { label: 'Hour', value: formHour, set: setFormHour, ph: '0-23' },
                { label: 'Day', value: formDom, set: setFormDom, ph: '1-31' },
                { label: 'Month', value: formMonth, set: setFormMonth, ph: '1-12' },
                { label: 'Weekday', value: formDow, set: setFormDow, ph: '0-6 (Sun=0)' },
              ].map((field) => (
                <div key={field.label}>
                  <label className="text-xs text-zinc-500 block mb-1">{field.label}</label>
                  <input
                    type="text"
                    value={field.value}
                    onChange={(e) => field.set(e.target.value)}
                    placeholder={field.ph}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-50 font-mono placeholder:text-zinc-600 focus:outline-none focus:border-blue-600"
                  />
                </div>
              ))}
            </div>

            {/* Human-readable description */}
            <p className="text-xs text-blue-400 mt-3">
              {describeCron(formMinute, formHour, formDom, formMonth, formDow)}
            </p>
          </div>

          {/* Command */}
          <div className="p-4 border-b border-zinc-700">
            <p className="text-xs text-zinc-500 mb-2 font-semibold uppercase tracking-wider">
              Command
            </p>
            <textarea
              value={formCommand}
              onChange={(e) => setFormCommand(e.target.value)}
              placeholder="e.g. docker system prune -f"
              rows={3}
              className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-50 font-mono placeholder:text-zinc-600 focus:outline-none focus:border-blue-600 resize-none"
            />
          </div>

          {/* Cron line preview */}
          <div className="p-4 border-b border-zinc-700">
            <p className="text-xs text-zinc-500 mb-2 font-semibold uppercase tracking-wider">
              Preview
            </p>
            <div className="bg-black rounded p-3">
              <pre className="font-mono text-xs text-green-400 whitespace-pre-wrap break-all">
                {cronPreview}
              </pre>
            </div>
          </div>

          {/* Action buttons */}
          <div className="p-4 flex items-center gap-3">
            <Button
              onClick={handleSave}
              disabled={saving || !formCommand.trim()}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {saving ? (
                <Loader className="w-4 h-4 animate-spin mr-2" />
              ) : null}
              Save
            </Button>
            <Button
              variant="outline"
              onClick={handleTest}
              disabled={testRunning || !formCommand.trim()}
              className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
            >
              <Play className="w-4 h-4 mr-2" />
              Test
            </Button>
          </div>
        </Card>

        {/* Test output */}
        {(testOutput.length > 0 || testRunning) && (
          <Card className="border-zinc-700 bg-zinc-900/50 overflow-hidden">
            <div className="bg-zinc-900 border-b border-zinc-700 p-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-green-400" />
                <span className="text-xs font-semibold text-zinc-300">Test Output</span>
                {testRunning && (
                  <span className="flex items-center gap-1 text-xs text-amber-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                    streaming
                  </span>
                )}
              </div>
              {testExitCode !== null && (
                <span
                  className={`text-xs ${testExitCode === 0 ? 'text-green-400' : 'text-red-400'}`}
                >
                  exit {testExitCode}
                </span>
              )}
            </div>
            <pre
              ref={scrollRef}
              className="h-60 overflow-auto bg-black p-3 font-mono text-xs whitespace-pre-wrap break-words"
            >
              {testOutput.map((chunk, i) => (
                <span key={i} className="text-green-400">
                  {chunk}
                </span>
              ))}
              {testRunning && <span className="text-zinc-500 animate-pulse">_</span>}
            </pre>
          </Card>
        )}
      </div>
    )
  }

  // ─── List View ────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Server Selector */}
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
        <div className="ml-auto">
          <Button
            onClick={() => openEditor('new')}
            className="bg-blue-600 hover:bg-blue-700 text-white"
            size="sm"
          >
            <Plus className="w-4 h-4 mr-2" />
            New Job
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-900/20 border border-red-800 rounded text-red-200 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Crontab table */}
      <Card className="border-zinc-700 bg-zinc-900/50 overflow-hidden">
        <div className="bg-zinc-900 border-b border-zinc-700 p-3 flex items-center gap-2">
          <CalendarClock className="w-4 h-4 text-blue-400" />
          <span className="text-xs font-semibold text-zinc-300">
            Cron Jobs
          </span>
          <span className="text-xs text-zinc-500 ml-1">({entries.length})</span>
        </div>

        {loading ? (
          <div className="p-6 flex items-center justify-center gap-2 text-zinc-400 text-sm">
            <Loader className="w-4 h-4 animate-spin" />
            Loading crontab...
          </div>
        ) : entries.length === 0 ? (
          <div className="p-6 text-center text-zinc-500 text-sm">
            No cron jobs configured on this server.
          </div>
        ) : (
          <div className="divide-y divide-zinc-800">
            {entries.map((entry) => (
              <div
                key={entry.index}
                className={`p-4 hover:bg-zinc-800/30 transition-colors ${
                  !entry.enabled ? 'opacity-50' : ''
                }`}
              >
                <div className="flex items-start gap-4">
                  {/* Toggle */}
                  <button
                    onClick={() => handleToggle(entry.index)}
                    disabled={busy === entry.index}
                    className={`mt-1 flex-shrink-0 w-8 h-5 rounded-full relative transition-colors ${
                      entry.enabled ? 'bg-green-600' : 'bg-zinc-700'
                    }`}
                    title={entry.enabled ? 'Disable' : 'Enable'}
                  >
                    <span
                      className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                        entry.enabled ? 'left-3.5' : 'left-0.5'
                      }`}
                    />
                  </button>

                  {/* Schedule + command */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <span className="font-mono text-xs text-blue-400 bg-blue-900/20 px-2 py-0.5 rounded">
                        {entry.minute} {entry.hour} {entry.dayOfMonth} {entry.month}{' '}
                        {entry.dayOfWeek}
                      </span>
                      <span className="text-xs text-zinc-400">
                        {describeCron(
                          entry.minute,
                          entry.hour,
                          entry.dayOfMonth,
                          entry.month,
                          entry.dayOfWeek
                        )}
                      </span>
                    </div>
                    <p className="font-mono text-xs text-zinc-300 truncate">
                      {entry.command}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEditor(entry)}
                      className="text-zinc-400 hover:text-zinc-200 h-8 w-8 p-0"
                      title="Edit"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(entry.index)}
                      disabled={busy === entry.index}
                      className="text-zinc-400 hover:text-red-400 h-8 w-8 p-0"
                      title="Delete"
                    >
                      {busy === entry.index ? (
                        <Loader className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
