import { useState, useEffect } from 'react'
import type {
  ServerAlias,
  ServerInfo,
  PgContainer,
  PgDetailedResponse,
} from '@/types'
import { api, ApiError } from '@/lib/api'
import { formatBytes } from '@/lib/formatters'
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
import { RefreshCw, X, ChevronDown, ChevronRight } from 'lucide-react'

interface PostgresPanelProps {
  servers: Record<string, ServerInfo>
  serverKeys: string[]
}

export function PostgresPanel({ servers, serverKeys }: PostgresPanelProps) {
  const [server, setServer] = useState<ServerAlias>(serverKeys[0] || 'prod')
  const [containers, setContainers] = useState<PgContainer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchBasic = async (srv: ServerAlias) => {
    try {
      setLoading(true)
      setError(null)
      const data = await api.getPostgresBasic(srv)
      setContainers(data.containers)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to fetch PostgreSQL info')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchBasic(server)
  }, [server])

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
            onClick={() => fetchBasic(server)}
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
            {loading ? (
              <Card className="border-zinc-700 bg-zinc-900/50 p-6">
                <div className="space-y-3">
                  {[1, 2].map((i) => (
                    <div key={i} className="h-12 bg-zinc-800 rounded animate-pulse" />
                  ))}
                </div>
              </Card>
            ) : containers.length === 0 ? (
              <Card className="border-zinc-700 bg-zinc-900/50 p-6 text-center text-zinc-400">
                No PostgreSQL containers found
              </Card>
            ) : (
              containers.map(c => (
                <PgContainerCard key={c.id} container={c} server={server} />
              ))
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}

interface PgContainerCardProps {
  container: PgContainer
  server: ServerAlias
}

function PgContainerCard({ container, server }: PgContainerCardProps) {
  const [selectedDb, setSelectedDb] = useState<string | null>(null)
  const [detailed, setDetailed] = useState<PgDetailedResponse | null>(null)
  const [detailedLoading, setDetailedLoading] = useState(false)
  const [detailedError, setDetailedError] = useState<string | null>(null)

  const fetchDetailed = async (dbName: string) => {
    try {
      setDetailedLoading(true)
      setDetailedError(null)
      const data = await api.getPostgresDetailed(server, container.name, dbName)
      setDetailed(data)
    } catch (err) {
      setDetailedError(err instanceof ApiError ? err.message : 'Failed to fetch detailed stats')
    } finally {
      setDetailedLoading(false)
    }
  }

  const handleDbClick = (dbName: string) => {
    if (selectedDb === dbName) {
      setSelectedDb(null)
      setDetailed(null)
    } else {
      setSelectedDb(dbName)
      fetchDetailed(dbName)
    }
  }

  return (
    <Card className="border-zinc-700 bg-zinc-900/50 overflow-hidden">
      {/* Container Header */}
      <div className="flex items-center gap-3 flex-wrap p-4 border-b border-zinc-800">
        <span className="font-mono text-sm text-blue-400">{container.name}</span>
        <span className="text-xs text-zinc-500 font-mono">{container.image}</span>
        <Badge variant="outline" className="border-green-800 text-green-400 text-xs">
          {container.status}
        </Badge>
        {container.version && (
          <span className="text-xs text-zinc-500">{container.version.split(' ').slice(0, 2).join(' ')}</span>
        )}
        {container.error && (
          <Badge variant="outline" className="border-red-800 text-red-400 text-xs">
            Error
          </Badge>
        )}
      </div>

      {/* Basic: Databases table */}
      {container.error ? (
        <div className="p-4 text-sm text-red-400">{container.error}</div>
      ) : container.databases.length === 0 ? (
        <div className="p-4 text-sm text-zinc-500">No databases found</div>
      ) : (
        <Table>
          <TableHeader className="bg-zinc-900">
            <TableRow className="hover:bg-transparent border-b border-zinc-700">
              <TableHead className="text-zinc-400">Database</TableHead>
              <TableHead className="text-zinc-400 text-right">Size</TableHead>
              <TableHead className="text-zinc-400 text-right">Connections</TableHead>
              <TableHead className="text-zinc-400 w-8"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {container.databases.map(db => (
              <TableRow
                key={db.name}
                className={`border-b border-zinc-700/50 cursor-pointer ${selectedDb === db.name ? 'bg-zinc-800' : 'hover:bg-zinc-800/50'}`}
                onClick={() => handleDbClick(db.name)}
              >
                <TableCell className="font-mono text-sm text-zinc-200">
                  <span className={selectedDb === db.name ? 'text-blue-400' : ''}>{db.name}</span>
                </TableCell>
                <TableCell className="text-sm text-zinc-300 text-right font-mono">{formatBytes(db.sizeBytes)}</TableCell>
                <TableCell className="text-sm text-zinc-300 text-right font-mono">{db.activeConnections}</TableCell>
                <TableCell className="text-zinc-500">
                  {selectedDb === db.name ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Detailed section for selected DB */}
      {selectedDb && (
        <div className="border-t border-zinc-800 p-4 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-400 font-semibold uppercase tracking-wider">
              Detalle: <span className="text-blue-400">{selectedDb}</span>
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => fetchDetailed(selectedDb)}
              disabled={detailedLoading}
              className="text-zinc-400 hover:text-zinc-200"
            >
              <RefreshCw className={`w-3 h-3 ${detailedLoading ? 'animate-spin' : ''}`} />
            </Button>
          </div>

          {detailedError && (
            <div className="p-3 bg-red-900/20 border border-red-800 rounded text-red-200 text-sm">
              {detailedError}
            </div>
          )}

          {detailedLoading && !detailed && (
            <div className="space-y-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-8 bg-zinc-800 rounded animate-pulse" />
              ))}
            </div>
          )}

          {detailed && (
            <>
              {/* Cache Hit Ratio — solo para la DB seleccionada */}
              <DetailSection title="Cache Hit Ratio">
                {(() => {
                  const dbHit = detailed.cacheHit.find(ch => ch.datname === selectedDb)
                  if (!dbHit) return <EmptyState />
                  return (
                    <div className="bg-zinc-800 rounded p-3 inline-block">
                      <p className={`text-lg font-mono font-bold ${
                        dbHit.cache_hit_ratio >= 95 ? 'text-green-400' :
                        dbHit.cache_hit_ratio >= 80 ? 'text-amber-400' : 'text-red-400'
                      }`}>
                        {dbHit.cache_hit_ratio}%
                      </p>
                      <p className="text-[10px] text-zinc-600">
                        hit: {dbHit.blks_hit.toLocaleString()} / read: {dbHit.blks_read.toLocaleString()}
                      </p>
                    </div>
                  )
                })()}
              </DetailSection>

              {/* Top Tables */}
              <DetailSection title="Top Tablas">
                {detailed.tables.length === 0 ? (
                  <EmptyState text="Sin tablas de usuario" />
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader className="bg-zinc-800">
                        <TableRow className="hover:bg-transparent border-b border-zinc-700">
                          <TableHead className="text-zinc-400 text-xs">Tabla</TableHead>
                          <TableHead className="text-zinc-400 text-xs text-right">Size</TableHead>
                          <TableHead className="text-zinc-400 text-xs text-right">Live Rows</TableHead>
                          <TableHead className="text-zinc-400 text-xs text-right">Dead Rows</TableHead>
                          <TableHead className="text-zinc-400 text-xs">Last Vacuum</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detailed.tables.map(t => (
                          <TableRow key={t.table} className="hover:bg-zinc-800/50 border-b border-zinc-700/50">
                            <TableCell className="font-mono text-xs text-zinc-200">{t.table}</TableCell>
                            <TableCell className="font-mono text-xs text-zinc-300 text-right">{formatBytes(t.total_size)}</TableCell>
                            <TableCell className="font-mono text-xs text-zinc-300 text-right">{t.live_rows.toLocaleString()}</TableCell>
                            <TableCell className={`font-mono text-xs text-right ${t.dead_rows > t.live_rows * 0.1 ? 'text-amber-400' : 'text-zinc-300'}`}>
                              {t.dead_rows.toLocaleString()}
                            </TableCell>
                            <TableCell className="text-xs text-zinc-500">
                              {t.last_autovacuum || t.last_vacuum || 'Never'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </DetailSection>

              {/* Active Queries — filtrado a la DB seleccionada */}
              <DetailSection title="Queries Activas">
                {(() => {
                  const dbQueries = detailed.activeQueries.filter(q => q.datname === selectedDb)
                  if (dbQueries.length === 0) return <EmptyState text="Sin queries activas" />
                  return (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader className="bg-zinc-800">
                          <TableRow className="hover:bg-transparent border-b border-zinc-700">
                            <TableHead className="text-zinc-400 text-xs">PID</TableHead>
                            <TableHead className="text-zinc-400 text-xs">User</TableHead>
                            <TableHead className="text-zinc-400 text-xs">State</TableHead>
                            <TableHead className="text-zinc-400 text-xs">Query</TableHead>
                            <TableHead className="text-zinc-400 text-xs text-right">Duration</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {dbQueries.map(q => (
                            <TableRow key={q.pid} className="hover:bg-zinc-800/50 border-b border-zinc-700/50">
                              <TableCell className="font-mono text-xs text-zinc-300">{q.pid}</TableCell>
                              <TableCell className="text-xs text-zinc-300">{q.usename}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className={`text-xs ${
                                  q.state === 'active' ? 'border-green-800 text-green-400' :
                                  q.state === 'idle' ? 'border-zinc-700 text-zinc-500' :
                                  'border-amber-800 text-amber-400'
                                }`}>
                                  {q.state}
                                </Badge>
                              </TableCell>
                              <TableCell className="font-mono text-xs text-zinc-400 max-w-xs truncate">
                                {q.query}
                              </TableCell>
                              <TableCell className={`font-mono text-xs text-right ${q.duration > 60 ? 'text-red-400' : q.duration > 10 ? 'text-amber-400' : 'text-zinc-300'}`}>
                                {q.duration}s
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )
                })()}
              </DetailSection>

              {/* Locks */}
              <DetailSection title="Locks Bloqueados">
                {detailed.locks.length === 0 ? (
                  <EmptyState text="Sin locks bloqueados" />
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader className="bg-zinc-800">
                        <TableRow className="hover:bg-transparent border-b border-zinc-700">
                          <TableHead className="text-zinc-400 text-xs">Type</TableHead>
                          <TableHead className="text-zinc-400 text-xs">Mode</TableHead>
                          <TableHead className="text-zinc-400 text-xs">PID</TableHead>
                          <TableHead className="text-zinc-400 text-xs">Relation</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detailed.locks.map((l, i) => (
                          <TableRow key={i} className="hover:bg-zinc-800/50 border-b border-zinc-700/50">
                            <TableCell className="text-xs text-zinc-300">{l.locktype}</TableCell>
                            <TableCell className="text-xs text-zinc-300">{l.mode}</TableCell>
                            <TableCell className="font-mono text-xs text-zinc-300">{l.pid}</TableCell>
                            <TableCell className="font-mono text-xs text-zinc-400">{l.relation || '—'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </DetailSection>

              {/* Replication */}
              <DetailSection title="Replicación">
                {detailed.replication.length === 0 ? (
                  <EmptyState text="Sin replicación configurada" />
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader className="bg-zinc-800">
                        <TableRow className="hover:bg-transparent border-b border-zinc-700">
                          <TableHead className="text-zinc-400 text-xs">Client</TableHead>
                          <TableHead className="text-zinc-400 text-xs">State</TableHead>
                          <TableHead className="text-zinc-400 text-xs">Sent LSN</TableHead>
                          <TableHead className="text-zinc-400 text-xs">Write LSN</TableHead>
                          <TableHead className="text-zinc-400 text-xs">Replay LSN</TableHead>
                          <TableHead className="text-zinc-400 text-xs">Sync</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detailed.replication.map((r, i) => (
                          <TableRow key={i} className="hover:bg-zinc-800/50 border-b border-zinc-700/50">
                            <TableCell className="font-mono text-xs text-zinc-300">{r.client_addr}</TableCell>
                            <TableCell className="text-xs text-zinc-300">{r.state}</TableCell>
                            <TableCell className="font-mono text-xs text-zinc-400">{r.sent_lsn}</TableCell>
                            <TableCell className="font-mono text-xs text-zinc-400">{r.write_lsn}</TableCell>
                            <TableCell className="font-mono text-xs text-zinc-400">{r.replay_lsn}</TableCell>
                            <TableCell className="text-xs text-zinc-300">{r.sync_state}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </DetailSection>
            </>
          )}
        </div>
      )}
    </Card>
  )
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-xs text-zinc-400 font-semibold mb-2">{title}</h4>
      {children}
    </div>
  )
}

function EmptyState({ text = 'Sin datos' }: { text?: string }) {
  return <p className="text-xs text-zinc-600 py-2">{text}</p>
}
