import { useEffect, useState } from 'react'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'
import { Card } from '@/components/ui/card'
import { api } from '@/lib/api'
import type { MetricEntry, MetricDetailEntry, ServerAlias } from '@/types'
import { Cpu, Container, Loader } from 'lucide-react'

interface TrendChartProps {
  server: ServerAlias
  title: string
  mini?: boolean
  onClick?: () => void
}

export function TrendChart({ server, title, mini = false, onClick }: TrendChartProps) {
  const [data, setData] = useState<MetricEntry[]>([])
  const [loading, setLoading] = useState(true)

  // Latest breakdown state
  const [processes, setProcesses] = useState<MetricDetailEntry[]>([])
  const [containers, setContainers] = useState<MetricDetailEntry[]>([])
  const [breakdownTime, setBreakdownTime] = useState<string | null>(null)
  const [breakdownLoading, setBreakdownLoading] = useState(true)

  // Fetch history
  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const response = await api.getHistory(server)
        setData(response.entries || [])
      } catch {
        // silently fail
      } finally {
        setLoading(false)
      }
    }

    fetchHistory()
    const interval = setInterval(fetchHistory, 60000)
    return () => clearInterval(interval)
  }, [server])

  // Fetch latest breakdown — runs every 15s (skip in mini mode)
  useEffect(() => {
    if (mini) {
      setBreakdownLoading(false)
      return
    }

    const fetchBreakdown = async () => {
      try {
        const response = await api.getHistory(server)
        const entries = response.entries || []
        if (entries.length === 0) return

        const latestTs = entries[entries.length - 1].timestamp
        const detail = await api.getMetricDetail(server, latestTs)
        setProcesses(detail.processes || [])
        setContainers(detail.containers || [])
        setBreakdownTime(latestTs)
      } catch {
        // silently fail
      } finally {
        setBreakdownLoading(false)
      }
    }

    fetchBreakdown()
    const interval = setInterval(fetchBreakdown, 15000)
    return () => clearInterval(interval)
  }, [server, mini])

  const chartData = data.slice(-240).map((entry) => ({
    time: new Date(entry.timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    }),
    cpu: Math.round(entry.cpu * 10) / 10,
    memory: Math.round(entry.memory * 10) / 10,
    disk: Math.round(entry.disk * 10) / 10,
  }))

  if (loading) {
    return (
      <Card className="border-zinc-700 bg-zinc-900/50 p-4">
        <div className="h-48 flex items-center justify-center text-zinc-500 text-sm">
          Loading {title} history...
        </div>
      </Card>
    )
  }

  if (chartData.length === 0) {
    return (
      <Card className="border-zinc-700 bg-zinc-900/50 p-4">
        <h4 className="text-sm font-semibold text-zinc-300 mb-2">{title} — Trends</h4>
        <div className="h-40 flex items-center justify-center text-zinc-500 text-sm">
          No history data yet. Metrics are collected every 15s.
        </div>
      </Card>
    )
  }

  return (
    <div className="space-y-2">
      {/* Chart */}
      <Card
        className={`border-zinc-700 bg-zinc-900/50 p-4 ${onClick ? 'cursor-pointer hover:border-zinc-500 transition-colors' : ''}`}
        onClick={onClick}
      >
        <h4 className="text-sm font-semibold text-zinc-300 mb-3">{title} — Trends</h4>
        <ResponsiveContainer width="100%" height={mini ? 120 : 180}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id={`cpu-${server}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
              <linearGradient id={`mem-${server}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#a855f7" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
              </linearGradient>
              <linearGradient id={`disk-${server}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis
              dataKey="time"
              tick={{ fill: '#71717a', fontSize: 10 }}
              tickLine={false}
              axisLine={{ stroke: '#3f3f46' }}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fill: '#71717a', fontSize: 10 }}
              tickLine={false}
              axisLine={{ stroke: '#3f3f46' }}
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#18181b',
                border: '1px solid #3f3f46',
                borderRadius: '6px',
                fontSize: 12,
              }}
              labelStyle={{ color: '#a1a1aa' }}
            />
            <Area type="monotone" dataKey="cpu" stroke="#3b82f6" fill={`url(#cpu-${server})`} strokeWidth={1.5} name="CPU" />
            <Area type="monotone" dataKey="memory" stroke="#a855f7" fill={`url(#mem-${server})`} strokeWidth={1.5} name="Memory" />
            <Area type="monotone" dataKey="disk" stroke="#f59e0b" fill={`url(#disk-${server})`} strokeWidth={1.5} name="Disk" />
          </AreaChart>
        </ResponsiveContainer>
        <div className="flex gap-4 mt-2 text-xs text-zinc-500">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500" /> CPU</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-500" /> Memory</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" /> Disk</span>
        </div>
      </Card>

      {/* Live Resource Breakdown */}
      {!mini && <Card className="border-zinc-700 bg-zinc-900/50 p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-semibold text-zinc-300">Resource Breakdown</h4>
          {breakdownTime && (
            <span className="text-xs text-zinc-500 font-mono">
              {new Date(breakdownTime).toLocaleTimeString()}
            </span>
          )}
        </div>

        {breakdownLoading ? (
          <div className="flex items-center gap-2 text-zinc-500 text-sm py-6 justify-center">
            <Loader className="w-4 h-4 animate-spin" />
            Loading breakdown...
          </div>
        ) : (processes.length === 0 && containers.length === 0) ? (
          <p className="text-xs text-zinc-500 text-center py-4">
            No breakdown data yet. Data appears after a few collection cycles.
          </p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Top Processes */}
            {processes.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Cpu className="w-3.5 h-3.5 text-blue-400" />
                  <span className="text-xs font-semibold text-zinc-400">Top Processes ({processes.length})</span>
                </div>
                <div className="bg-black rounded border border-zinc-800 overflow-hidden max-h-[220px] overflow-y-auto">
                  <table className="w-full text-xs font-mono">
                    <thead className="sticky top-0">
                      <tr className="text-zinc-500 border-b border-zinc-800 bg-zinc-900">
                        <th className="text-left px-2 py-1">Process</th>
                        <th className="text-right px-2 py-1 w-14">CPU</th>
                        <th className="text-right px-2 py-1 w-14">MEM</th>
                      </tr>
                    </thead>
                    <tbody>
                      {processes.filter(p => !p.name.startsWith('ps aux') && !p.name.startsWith('ps -')).map((p, i) => (
                        <tr key={i} className="border-b border-zinc-900/50 hover:bg-zinc-900/30">
                          <td className="px-2 py-1 text-zinc-300 truncate max-w-[180px]" title={p.name}>{p.name}</td>
                          <td className={`text-right px-2 py-1 ${p.cpu > 100 ? 'text-red-400 font-bold' : p.cpu > 50 ? 'text-red-400' : p.cpu > 20 ? 'text-amber-400' : 'text-green-400'}`}>
                            {(p.cpu ?? 0).toFixed(1)}%
                          </td>
                          <td className={`text-right px-2 py-1 ${p.memory > 50 ? 'text-red-400' : p.memory > 20 ? 'text-amber-400' : 'text-green-400'}`}>
                            {(p.memory ?? 0).toFixed(1)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Docker Containers */}
            {containers.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Container className="w-3.5 h-3.5 text-purple-400" />
                  <span className="text-xs font-semibold text-zinc-400">Docker Containers ({containers.length})</span>
                </div>
                <div className="bg-black rounded border border-zinc-800 overflow-hidden max-h-[220px] overflow-y-auto">
                  <table className="w-full text-xs font-mono">
                    <thead className="sticky top-0">
                      <tr className="text-zinc-500 border-b border-zinc-800 bg-zinc-900">
                        <th className="text-left px-2 py-1">Container</th>
                        <th className="text-right px-2 py-1 w-14">CPU</th>
                        <th className="text-right px-2 py-1 w-14">MEM</th>
                        <th className="text-right px-2 py-1 w-20">Usage</th>
                      </tr>
                    </thead>
                    <tbody>
                      {containers.map((c, i) => (
                        <tr key={i} className="border-b border-zinc-900/50 hover:bg-zinc-900/30">
                          <td className="px-2 py-1 text-zinc-300 truncate max-w-[140px]" title={c.name}>{c.name}</td>
                          <td className={`text-right px-2 py-1 ${c.cpu > 50 ? 'text-red-400' : c.cpu > 20 ? 'text-amber-400' : 'text-green-400'}`}>
                            {(c.cpu ?? 0).toFixed(1)}%
                          </td>
                          <td className={`text-right px-2 py-1 ${c.memory > 50 ? 'text-red-400' : c.memory > 20 ? 'text-amber-400' : 'text-green-400'}`}>
                            {(c.memory ?? 0).toFixed(1)}%
                          </td>
                          <td className="text-right px-2 py-1 text-zinc-400">
                            {c.extra?.memUsage || '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </Card>}
    </div>
  )
}
