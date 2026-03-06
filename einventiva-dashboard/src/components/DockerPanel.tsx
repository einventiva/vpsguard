import { useState, useEffect } from 'react'
import type { ServerAlias, DockerContainer, ServerInfo } from '@/types'
import { api, ApiError } from '@/lib/api'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'
import { RefreshCw, X, Copy, Check } from 'lucide-react'

interface DockerPanelProps {
  servers: Record<string, ServerInfo>
  serverKeys: string[]
}

export function DockerPanel({ servers, serverKeys }: DockerPanelProps) {
  const [server, setServer] = useState<ServerAlias>(serverKeys[0] || 'prod')
  const [containers, setContainers] = useState<DockerContainer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedContainer, setSelectedContainer] =
    useState<DockerContainer | null>(null)
  const [logs, setLogs] = useState<string>('')
  const [logsLoading, setLogsLoading] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const fetchContainers = async (srv: ServerAlias) => {
    try {
      setLoading(true)
      setError(null)
      const data = await api.getContainers(srv)
      setContainers(data)
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : 'Failed to fetch containers'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  const fetchLogs = async (container: DockerContainer) => {
    try {
      setLogsLoading(true)
      const logsText = await api.getContainerLogs(server, container.id, 200)
      setLogs(logsText)
    } catch (err) {
      setLogs(
        `Error fetching logs: ${err instanceof Error ? err.message : 'Unknown error'}`
      )
    } finally {
      setLogsLoading(false)
    }
  }

  useEffect(() => {
    fetchContainers(server)
  }, [server])

  const handleContainerClick = (container: DockerContainer) => {
    setSelectedContainer(container)
    fetchLogs(container)
  }

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  return (
    <div className="space-y-6">
      <Tabs
        value={server}
        onValueChange={(v) => setServer(v as ServerAlias)}
        className="w-full"
      >
        <div className="flex items-center justify-between mb-4">
          <TabsList className="bg-zinc-900 border border-zinc-700">
            {serverKeys.map(k => (
              <TabsTrigger key={k} value={k}>{servers[k]?.displayName || k}</TabsTrigger>
            ))}
          </TabsList>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchContainers(server)}
            disabled={loading}
            className="border-zinc-700 text-zinc-300 hover:bg-zinc-900"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="ml-2">Refresh</span>
          </Button>
        </div>

        {serverKeys.map(k => (
          <TabsContent key={k} value={k} className="space-y-4">
            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-900/20 border border-red-800 rounded text-red-200 text-sm">
                <X className="w-4 h-4" />
                {error}
              </div>
            )}
            <ContainerTable
              containers={containers}
              loading={loading}
              onSelectContainer={handleContainerClick}
              onCopyId={copyToClipboard}
              copiedId={copiedId}
            />
          </TabsContent>
        ))}
      </Tabs>

      {/* Logs Side Panel */}
      <Sheet
        open={selectedContainer !== null}
        onOpenChange={(open) => !open && setSelectedContainer(null)}
      >
        <SheetContent
          side="right"
          className="border-l border-zinc-700 bg-zinc-950 p-0 w-1/2"
        >
          <SheetHeader className="border-b border-zinc-700 p-4">
            <SheetTitle className="text-zinc-50">
              Logs: {selectedContainer?.name}
            </SheetTitle>
          </SheetHeader>

          <div className="p-4 h-full flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs text-zinc-400 font-mono">
                {selectedContainer?.id.substring(0, 12)}
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => selectedContainer && fetchLogs(selectedContainer)}
                disabled={logsLoading}
                className="text-zinc-400 hover:text-zinc-200"
              >
                <RefreshCw
                  className={`w-4 h-4 ${logsLoading ? 'animate-spin' : ''}`}
                />
              </Button>
            </div>

            <ScrollArea className="flex-1 bg-black rounded border border-zinc-800 p-3 font-mono text-sm">
              <div className="text-green-400 whitespace-pre-wrap break-words">
                {logs || 'No logs available'}
              </div>
            </ScrollArea>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

interface ContainerTableProps {
  containers: DockerContainer[]
  loading: boolean
  onSelectContainer: (container: DockerContainer) => void
  onCopyId: (text: string, id: string) => void
  copiedId: string | null
}

function ContainerTable({
  containers,
  loading,
  onSelectContainer,
  onCopyId,
  copiedId,
}: ContainerTableProps) {
  const getStatusBadge = (status: DockerContainer['status']) => {
    switch (status) {
      case 'running':
        return (
          <Badge variant="outline" className="border-green-800 text-green-400">
            Running
          </Badge>
        )
      case 'exited':
        return (
          <Badge variant="outline" className="border-red-800 text-red-400">
            Exited
          </Badge>
        )
      case 'paused':
        return (
          <Badge variant="outline" className="border-amber-800 text-amber-400">
            Paused
          </Badge>
        )
      case 'unhealthy':
        return (
          <Badge variant="outline" className="border-red-800 text-red-400">
            Unhealthy
          </Badge>
        )
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  if (loading) {
    return (
      <Card className="border-zinc-700 bg-zinc-900/50 p-6">
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-12 bg-zinc-800 rounded animate-pulse"
            />
          ))}
        </div>
      </Card>
    )
  }

  if (containers.length === 0) {
    return (
      <Card className="border-zinc-700 bg-zinc-900/50 p-6 text-center text-zinc-400">
        No containers found
      </Card>
    )
  }

  return (
    <Card className="border-zinc-700 bg-zinc-900/50 overflow-hidden">
      <Table>
        <TableHeader className="bg-zinc-900 border-b border-zinc-700">
          <TableRow className="hover:bg-transparent border-b border-zinc-700">
            <TableHead className="text-zinc-400">Name</TableHead>
            <TableHead className="text-zinc-400">Image</TableHead>
            <TableHead className="text-zinc-400">Status</TableHead>
            <TableHead className="text-zinc-400 text-right">CPU</TableHead>
            <TableHead className="text-zinc-400 text-right">Memory</TableHead>
            <TableHead className="text-zinc-400 text-right">Disk I/O</TableHead>
            <TableHead className="text-zinc-400">Ports</TableHead>
            <TableHead className="text-zinc-400">Uptime</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {containers.map((container) => (
            <TableRow
              key={container.id}
              className="hover:bg-zinc-800/50 border-b border-zinc-700/50 cursor-pointer"
              onClick={() => onSelectContainer(container)}
            >
              <TableCell className="font-mono text-sm text-blue-400">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onCopyId(container.name, container.id)
                  }}
                  className="flex items-center gap-2 hover:text-blue-300"
                >
                  {container.name}
                  {copiedId === container.id ? (
                    <Check className="w-4 h-4 text-green-400" />
                  ) : (
                    <Copy className="w-4 h-4 opacity-0 group-hover:opacity-100" />
                  )}
                </button>
              </TableCell>
              <TableCell className="text-xs text-zinc-400 font-mono max-w-xs truncate">
                {container.image}
              </TableCell>
              <TableCell>{getStatusBadge(container.status)}</TableCell>
              <TableCell className="text-xs font-mono text-right">
                {container.cpu ? (
                  <span className={parseFloat(container.cpu) > 50 ? 'text-red-400' : parseFloat(container.cpu) > 20 ? 'text-amber-400' : 'text-green-400'}>
                    {container.cpu}
                  </span>
                ) : <span className="text-zinc-600">—</span>}
              </TableCell>
              <TableCell className="text-xs font-mono text-right">
                {container.memUsage ? (
                  <div>
                    <span className={parseFloat(container.memPerc) > 80 ? 'text-red-400' : parseFloat(container.memPerc) > 50 ? 'text-amber-400' : 'text-zinc-300'}>
                      {container.memPerc}
                    </span>
                    <span className="text-zinc-600 block text-[10px]">{container.memUsage}</span>
                  </div>
                ) : <span className="text-zinc-600">—</span>}
              </TableCell>
              <TableCell className="text-xs text-zinc-500 font-mono text-right">
                {container.blockIO || '—'}
              </TableCell>
              <TableCell className="text-xs text-zinc-500 font-mono">
                {container.ports.length > 0
                  ? container.ports.join(', ')
                  : '—'}
              </TableCell>
              <TableCell className="text-xs text-zinc-500">
                {container.created}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  )
}
