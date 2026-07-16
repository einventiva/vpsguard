import { useState, useEffect } from 'react'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from 'recharts'
import { api } from '@/lib/api'
import { formatBytes } from '@/lib/formatters'
import type { ServerAlias, PgHistoryEntry, PgHistoryRange } from '@/types'
import { Loader } from 'lucide-react'

const RANGE_OPTIONS: PgHistoryRange[] = ['24h', '7d', '30d']

interface PgTrendsProps {
  server: ServerAlias
  container: string
}

// Connections vs max_connections + total size over time, fed by the
// backend's 5-min sampler
export function PgTrends({ server, container }: PgTrendsProps) {
  const [entries, setEntries] = useState<PgHistoryEntry[]>([])
  const [range, setRange] = useState<PgHistoryRange>('24h')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const fetchHistory = async () => {
      try {
        const response = await api.getPgHistory(server, container, range)
        if (!cancelled) {
          setEntries(response.entries)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load history')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchHistory()
    const interval = setInterval(fetchHistory, 5 * 60 * 1000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [server, container, range])

  const multiDay = range !== '24h'
  const chartData = entries.map(e => ({
    time: new Date(e.timestamp).toLocaleString([], multiDay
      ? { month: 'short', day: 'numeric', hour: '2-digit' }
      : { hour: '2-digit', minute: '2-digit' }),
    connections: e.connections,
    sizeMB: e.size_bytes != null ? Math.round(e.size_bytes / 1048576 * 10) / 10 : null,
  }))
  const maxConn = entries.length > 0 ? entries[entries.length - 1].max_connections : null

  return (
    <div className="p-4 border-b border-zinc-800 bg-zinc-950/40">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-zinc-400">Trends</span>
        <div className="flex items-center gap-1">
          {RANGE_OPTIONS.map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-2 py-0.5 rounded text-xs font-mono transition-colors ${
                range === r ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="h-32 flex items-center justify-center gap-2 text-zinc-500 text-sm">
          <Loader className="w-4 h-4 animate-spin" /> Loading trends...
        </div>
      ) : error ? (
        <div className="h-32 flex items-center justify-center text-red-400 text-sm">{error}</div>
      ) : chartData.length < 2 ? (
        <div className="h-32 flex items-center justify-center text-zinc-500 text-sm">
          Not enough samples yet — PostgreSQL is sampled every 5 minutes.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Connections vs max */}
          <div>
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">
              Connections{maxConn != null && <span className="text-zinc-600"> / max {maxConn}</span>}
            </p>
            <ResponsiveContainer width="100%" height={130}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id={`pgconn-${container}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="time" tick={{ fill: '#71717a', fontSize: 9 }} tickLine={false} axisLine={{ stroke: '#3f3f46' }} interval="preserveStartEnd" />
                <YAxis domain={[0, maxConn ?? 'auto']} tick={{ fill: '#71717a', fontSize: 9 }} tickLine={false} axisLine={{ stroke: '#3f3f46' }} width={32} />
                <Tooltip contentStyle={{ backgroundColor: '#18181b', border: '1px solid #3f3f46', borderRadius: '6px', fontSize: 11 }} labelStyle={{ color: '#a1a1aa' }} />
                {maxConn != null && (
                  <ReferenceLine y={maxConn} stroke="#dc2626" strokeDasharray="4 4" strokeOpacity={0.6} />
                )}
                <Area type="monotone" dataKey="connections" stroke="#3b82f6" fill={`url(#pgconn-${container})`} strokeWidth={1.5} name="Connections" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Total size */}
          <div>
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">
              Total size{entries.length > 0 && entries[entries.length - 1].size_bytes != null && (
                <span className="text-zinc-600"> · now {formatBytes(entries[entries.length - 1].size_bytes!)}</span>
              )}
            </p>
            <ResponsiveContainer width="100%" height={130}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id={`pgsize-${container}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#a855f7" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="time" tick={{ fill: '#71717a', fontSize: 9 }} tickLine={false} axisLine={{ stroke: '#3f3f46' }} interval="preserveStartEnd" />
                <YAxis domain={['auto', 'auto']} tick={{ fill: '#71717a', fontSize: 9 }} tickLine={false} axisLine={{ stroke: '#3f3f46' }} width={48} tickFormatter={(v) => `${v}MB`} />
                <Tooltip contentStyle={{ backgroundColor: '#18181b', border: '1px solid #3f3f46', borderRadius: '6px', fontSize: 11 }} labelStyle={{ color: '#a1a1aa' }} />
                <Area type="monotone" dataKey="sizeMB" stroke="#a855f7" fill={`url(#pgsize-${container})`} strokeWidth={1.5} name="Size (MB)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}
