import { useState, useEffect, useRef } from 'react'
import type { ServerAlias, DockerContainer, ServerInfo } from '@/types'
import { api, ApiError } from '@/lib/api'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { RefreshCw, Copy, Check } from 'lucide-react'

interface LogViewerProps {
  servers: Record<string, ServerInfo>
  serverKeys: string[]
}

export function LogViewer({ servers, serverKeys }: LogViewerProps) {
  const [server, setServer] = useState<ServerAlias>(serverKeys[0] || 'prod')
  const [containers, setContainers] = useState<DockerContainer[]>([])
  const [selectedContainer, setSelectedContainer] = useState<string | null>(null)
  const [logs, setLogs] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const [copied, setCopied] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Fetch containers when server changes
  useEffect(() => {
    const fetchContainers = async () => {
      try {
        setError(null)
        const data = await api.getContainers(server)
        setContainers(data)
        if (data.length > 0 && !selectedContainer) {
          setSelectedContainer(data[0].id)
        }
      } catch (err) {
        const message =
          err instanceof ApiError ? err.message : 'Failed to fetch containers'
        setError(message)
      }
    }

    fetchContainers()
  }, [server])

  // Fetch logs when container changes
  useEffect(() => {
    if (!selectedContainer) return

    const fetchLogs = async () => {
      try {
        setLoading(true)
        setError(null)
        const logsText = await api.getContainerLogs(
          server,
          selectedContainer,
          500
        )
        setLogs(logsText)
      } catch (err) {
        const message =
          err instanceof ApiError ? err.message : 'Failed to fetch logs'
        setError(message)
      } finally {
        setLoading(false)
      }
    }

    fetchLogs()
  }, [server, selectedContainer])

  // Auto scroll to bottom
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs, autoScroll])

  const handleRefresh = async () => {
    if (!selectedContainer) return

    try {
      setLoading(true)
      setError(null)
      const logsText = await api.getContainerLogs(
        server,
        selectedContainer,
        500
      )
      setLogs(logsText)
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to refresh logs'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  const handleCopyLogs = () => {
    navigator.clipboard.writeText(logs)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const containerName =
    containers.find((c) => c.id === selectedContainer)?.name || 'Unknown'

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <label className="text-sm text-zinc-400 mb-2 block">Server</label>
          <Select value={server} onValueChange={(v) => setServer(v as ServerAlias)}>
            <SelectTrigger className="w-40 border-zinc-700 bg-zinc-900 text-zinc-50">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-zinc-700 bg-zinc-900">
              {serverKeys.map(k => (
                <SelectItem key={k} value={k}>{servers[k]?.displayName || k}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex-1">
          <label className="text-sm text-zinc-400 mb-2 block">Container</label>
          <Select value={selectedContainer || ''} onValueChange={setSelectedContainer}>
            <SelectTrigger className="border-zinc-700 bg-zinc-900 text-zinc-50">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-zinc-700 bg-zinc-900">
              {containers.map((container) => (
                <SelectItem key={container.id} value={container.id}>
                  {container.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={loading}
            className="border-zinc-700 text-zinc-300 hover:bg-zinc-900"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="ml-2">Refresh</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopyLogs}
            disabled={!logs}
            className="border-zinc-700 text-zinc-300 hover:bg-zinc-900"
          >
            {copied ? (
              <>
                <Check className="w-4 h-4 text-green-400" />
                <span className="ml-2">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                <span className="ml-2">Copy</span>
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Options */}
      <div className="flex items-center gap-2 text-sm">
        <label className="text-zinc-400">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            className="mr-2 cursor-pointer"
          />
          Auto-scroll
        </label>
      </div>

      {/* Error Display */}
      {error && (
        <div className="p-3 bg-red-900/20 border border-red-800 rounded text-red-200 text-sm">
          {error}
        </div>
      )}

      {/* Logs Display */}
      <Card className="border-zinc-700 bg-black overflow-hidden h-96">
        <ScrollArea className="h-full w-full">
          <div className="p-4 font-mono text-sm">
            {logs ? (
              logs.split('\n').map((line, idx) => {
                const levelClass =
                  line.includes('ERROR') || line.includes('error')
                    ? 'text-red-400'
                    : line.includes('WARN') || line.includes('warning')
                      ? 'text-amber-400'
                      : 'text-green-400'

                return (
                  <div
                    key={idx}
                    className={`${levelClass} whitespace-pre-wrap break-words hover:bg-zinc-900/50 px-1 py-0.5 leading-relaxed`}
                  >
                    <span className="text-zinc-600 select-none mr-3 inline-block w-6">
                      {String(idx + 1).padStart(4, ' ')}
                    </span>
                    {line}
                  </div>
                )
              })
            ) : (
              <div className="text-zinc-500">
                {loading ? 'Loading logs...' : 'No logs available'}
              </div>
            )}
            <div ref={scrollRef} />
          </div>
        </ScrollArea>
      </Card>

      {/* Info */}
      <div className="text-xs text-zinc-500 text-right">
        Container: <span className="font-mono text-zinc-400">{containerName}</span> •{' '}
        {logs.split('\n').length} lines
      </div>
    </div>
  )
}
