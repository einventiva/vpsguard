import { useState, useEffect, useRef } from 'react'
import { Socket } from 'socket.io-client'
import type { ServerAlias, ScriptResult, ServerInfo } from '@/types'
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
  Code2,
  Play,
  AlertCircle,
  CheckCircle2,
  Loader,
  Terminal,
  Clock,
  ChevronLeft,
  Shield,
  Eye,
  Lock,
  Plus,
  Pencil,
  Trash2,
  X,
  Save,
} from 'lucide-react'

interface ScriptsPanelProps {
  servers: Record<string, ServerInfo>
  serverKeys: string[]
}

interface ScriptFormData {
  id: string
  name: string
  description: string
  command: string
}

export function ScriptsPanel({
  servers,
  serverKeys,
}: ScriptsPanelProps) {
  const [server, setServer] = useState<ServerAlias>(serverKeys[0] || 'prod')
  const [scripts, setScripts] = useState<ScriptResult[]>([])
  const [history, setHistory] = useState<ScriptResult[]>([])
  const [loading, setLoading] = useState(true)
  const [executing, setExecuting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [output, setOutput] = useState<string[]>([])
  const [exitCode, setExitCode] = useState<number | null>(null)

  // Detail/confirmation state
  const [selected, setSelected] = useState<ScriptResult | null>(null)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const serverInfo = servers

  // CRUD state
  const [editing, setEditing] = useState<ScriptFormData | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [saving, setSaving] = useState(false)

  const socketRef = useRef<Socket | null>(null)
  const scrollRef = useAutoScroll<HTMLPreElement>([output])

  const needsSudo = (command: string) => command.includes('sudo')

  // Socket connection
  useEffect(() => {
    const socket = getSharedSocket()

    const onStart = () => {
      setExecuting(true)
      setExitCode(null)
    }

    const onOutput = ({ stream, data }: { stream: string; data: string }) => {
      setOutput((prev) => [...prev, data])
    }

    const onDone = ({ code, script: scriptId, server: srv }: { code: number; script: string; server: string }) => {
      setExecuting(false)
      setExitCode(code)
      setHistory((prev) => [{
        id: scriptId,
        name: scriptId.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        description: '',
        command: '',
        output: `Exit code: ${code}`,
        status: code === 0 ? 'success' : 'error',
        timestamp: new Date().toLocaleString(),
        server: srv as ServerAlias,
      }, ...prev.slice(0, 9)])
    }

    const onError = ({ error: errMsg }: { error: string }) => {
      setExecuting(false)
      setError(errMsg)
    }

    socket.on('script:start', onStart)
    socket.on('script:output', onOutput)
    socket.on('script:done', onDone)
    socket.on('script:error', onError)

    socketRef.current = socket

    return () => {
      socket.off('script:start', onStart)
      socket.off('script:output', onOutput)
      socket.off('script:done', onDone)
      socket.off('script:error', onError)
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
    setSelected(null)
    setPassword('')
    setOutput([])
    setExitCode(null)
    setEditing(null)
  }, [server])

  const handleRunScript = () => {
    if (!selected || !socketRef.current) return
    setOutput([])
    setError(null)
    setExitCode(null)

    socketRef.current.emit('execute:script', {
      server,
      script: selected.id,
      password: needsSudo(selected.command) ? password : undefined,
    })
    setPassword('')
  }

  // CRUD handlers
  const handleNewScript = () => {
    setEditing({ id: '', name: '', description: '', command: '' })
    setIsNew(true)
    setSelected(null)
  }

  const handleEditScript = (script: ScriptResult) => {
    setEditing({
      id: script.id,
      name: script.name,
      description: script.description,
      command: script.command,
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete script')
    }
  }

  const handleSaveScript = async () => {
    if (!editing) return
    setSaving(true)
    setError(null)
    try {
      if (isNew) {
        const id = editing.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
        await api.createScript({
          id,
          name: editing.name,
          description: editing.description,
          command: editing.command,
        })
      } else {
        await api.updateScript(editing.id, {
          name: editing.name,
          description: editing.description,
          command: editing.command,
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
                onClick={() => handleDeleteScript(editing.id)}
                className="border-red-800 text-red-400 hover:bg-red-900/30 ml-auto"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete
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
          <Card className="border-zinc-700 bg-zinc-900/50 overflow-hidden">
            {/* Header */}
            <div className="bg-zinc-900 border-b border-zinc-700 p-4 flex items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setSelected(null); setPassword(''); setOutput([]); setExitCode(null) }}
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

            {/* Sudo password input */}
            {needsSudo(selected.command) && !executing && exitCode === null && (
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
                      if (e.key === 'Enter' && password) handleRunScript()
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
              {executing ? (
                <div className="flex items-center gap-3 text-amber-400 text-sm">
                  <Loader className="w-4 h-4 animate-spin" />
                  <span>Executing on {serverInfo[server]?.displayName || server}...</span>
                </div>
              ) : exitCode !== null ? (
                <div className="flex items-center justify-between">
                  <div className={`flex items-center gap-2 text-sm ${exitCode === 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {exitCode === 0 ? (
                      <CheckCircle2 className="w-4 h-4" />
                    ) : (
                      <AlertCircle className="w-4 h-4" />
                    )}
                    <span>
                      {exitCode === 0 ? 'Completed successfully' : `Failed with exit code ${exitCode}`}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { setOutput([]); setExitCode(null) }}
                      className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                    >
                      Run again
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { setSelected(null); setPassword(''); setOutput([]); setExitCode(null) }}
                      className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                    >
                      <ChevronLeft className="w-3 h-3 mr-1" />
                      Back to Scripts
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  onClick={handleRunScript}
                  disabled={needsSudo(selected.command) && !password}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                >
                  <Play className="w-4 h-4 mr-2" />
                  Execute on {serverInfo[server]?.displayName || server}
                </Button>
              )}
            </div>
          </Card>

          {/* Live terminal output */}
          {(output.length > 0 || executing || exitCode !== null) && (
            <Card className="border-zinc-700 bg-zinc-900/50 overflow-hidden">
              <div className="bg-zinc-900 border-b border-zinc-700 p-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-green-400" />
                  <span className="text-xs font-semibold text-zinc-300">Live Output</span>
                  {executing && (
                    <span className="flex items-center gap-1 text-xs text-amber-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                      streaming
                    </span>
                  )}
                </div>
                {output.length > 0 && (
                  <span className="text-xs text-zinc-500">
                    {output.join('').split('\n').length} lines
                  </span>
                )}
              </div>
              <pre
                ref={scrollRef}
                className="h-80 overflow-auto bg-black p-3 font-mono text-xs whitespace-pre-wrap break-words"
              >
                {output.map((chunk, i) => {
                  return (
                    <span key={i} className="text-green-400">
                      {chunk}
                    </span>
                  )
                })}
                {executing && (
                  <span className="text-zinc-500 animate-pulse">_</span>
                )}
                {!executing && output.length === 0 && exitCode !== null && (
                  <span className="text-zinc-500">(no output)</span>
                )}
              </pre>
            </Card>
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
                  className="border-zinc-700 bg-zinc-900/50 p-4 flex flex-col cursor-pointer hover:border-zinc-600 transition-colors"
                  onClick={() => setSelected(script)}
                >
                  <div className="flex items-start gap-3 mb-3">
                    <Code2 className="w-5 h-5 text-blue-400 flex-shrink-0 mt-1" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="font-mono text-sm font-semibold text-zinc-50 truncate">
                          {script.name}
                        </h4>
                        {needsSudo(script.command) && (
                          <Shield className="w-3 h-3 text-amber-400 flex-shrink-0" />
                        )}
                      </div>
                    </div>
                  </div>
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
                      className="text-zinc-500 hover:text-red-400"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDeleteScript(script.id)
                      }}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Execution History */}
      {history.length > 0 && !selected && (
        <Card className="border-zinc-700 bg-zinc-900/50 overflow-hidden">
          <div className="bg-zinc-900 border-b border-zinc-700 p-3 flex items-center gap-2">
            <Clock className="w-4 h-4 text-zinc-400" />
            <span className="text-xs font-semibold text-zinc-300">
              Recent Executions
            </span>
          </div>
          <div className="divide-y divide-zinc-700">
            {history.map((item, idx) => (
              <div
                key={`${item.id}-${idx}`}
                className="p-3 hover:bg-zinc-800/50 transition-colors"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-zinc-200">
                      {item.name}
                    </span>
                    {item.status === 'success' && (
                      <CheckCircle2 className="w-4 h-4 text-green-500" />
                    )}
                    {item.status === 'error' && (
                      <AlertCircle className="w-4 h-4 text-red-500" />
                    )}
                    {item.status === 'running' && (
                      <Loader className="w-4 h-4 text-amber-500 animate-spin" />
                    )}
                  </div>
                  <span className="text-xs text-zinc-500">{item.timestamp}</span>
                </div>
                {item.output && (
                  <p className="text-xs text-zinc-400 font-mono truncate">
                    {item.output}
                  </p>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
