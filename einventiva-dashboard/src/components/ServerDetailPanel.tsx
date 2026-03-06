import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceArea,
  Brush,
} from 'recharts'
import { Card } from '@/components/ui/card'
import { api } from '@/lib/api'
import { formatUptime, getStatusColor } from '@/lib/formatters'
import type { ServerInfo, ServerStatus, MetricEntry, MetricDetailEntry } from '@/types'
import { Cpu, Container, Loader, ArrowUpDown, ArrowUp, ArrowDown, TrendingUp, X, FileText, RefreshCw } from 'lucide-react'

type SortField = 'name' | 'cpu' | 'memory'
type SortDir = 'asc' | 'desc'
interface SortState { field: SortField; dir: SortDir }

interface ChartPoint {
  idx: number
  time: string
  timestamp: string
  cpu: number
  memory: number
  disk: number
}

interface ServerDetailPanelProps {
  serverKey: string
  serverInfo: ServerInfo
  serverStatus: ServerStatus | null
  onBack?: () => void
}

/** Format timestamp: include date when range spans multiple days */
function formatTs(ts: string, includeDate: boolean): string {
  const d = new Date(ts)
  if (includeDate) {
    return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function spansMultipleDays(ts1: string, ts2: string): boolean {
  return new Date(ts1).toDateString() !== new Date(ts2).toDateString()
}

export function ServerDetailPanel({ serverKey, serverInfo, serverStatus }: ServerDetailPanelProps) {
  const [data, setData] = useState<MetricEntry[]>([])
  const [loading, setLoading] = useState(true)

  // Selection state (click-drag on chart) — stores idx values
  const [dragStart, setDragStart] = useState<number | null>(null)
  const [dragEnd, setDragEnd] = useState<number | null>(null)
  const [selection, setSelection] = useState<{ startIdx: number; endIdx: number } | null>(null)
  const isDragging = useRef(false)

  // Breakdown
  const [processes, setProcesses] = useState<MetricDetailEntry[]>([])
  const [containers, setContainers] = useState<MetricDetailEntry[]>([])
  const [breakdownTime, setBreakdownTime] = useState<string | null>(null)
  const [breakdownLoading, setBreakdownLoading] = useState(false)

  // Sort state
  const [procSort, setProcSort] = useState<SortState>({ field: 'cpu', dir: 'desc' })
  const [contSort, setContSort] = useState<SortState>({ field: 'cpu', dir: 'desc' })

  // Container log viewer state
  const [logContainer, setLogContainer] = useState<string | null>(null)
  const [logText, setLogText] = useState('')
  const [logLoading, setLogLoading] = useState(false)
  const [logError, setLogError] = useState<string | null>(null)

  // Fetch history
  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const response = await api.getHistory(serverKey)
        setData(response.entries || [])
      } catch { /* silently fail */ }
      finally { setLoading(false) }
    }
    fetchHistory()
    const interval = setInterval(fetchHistory, 60000)
    return () => clearInterval(interval)
  }, [serverKey])

  // Chart data — all entries with numeric idx
  const chartData: ChartPoint[] = useMemo(() =>
    data.map((entry, i) => ({
      idx: i,
      time: new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      timestamp: entry.timestamp,
      cpu: Math.round(entry.cpu * 10) / 10,
      memory: Math.round(entry.memory * 10) / 10,
      disk: Math.round(entry.disk * 10) / 10,
    })),
    [data]
  )

  // XAxis tick formatter: idx → time label
  const formatXTick = useCallback((idx: number) => {
    const point = chartData[idx]
    return point ? point.time : ''
  }, [chartData])

  // Tooltip label formatter
  const formatTooltipLabel = useCallback((idx: number) => {
    const point = chartData[idx]
    if (!point) return ''
    return formatTs(point.timestamp, chartData.length > 0 && spansMultipleDays(chartData[0].timestamp, chartData[chartData.length - 1].timestamp))
  }, [chartData])

  // Mouse handlers for click-drag selection — use activeTooltipIndex (numeric idx)
  const handleMouseDown = useCallback((e: any) => {
    if (e?.activeTooltipIndex == null) return
    isDragging.current = true
    setDragStart(e.activeTooltipIndex)
    setDragEnd(e.activeTooltipIndex)
    setSelection(null)
  }, [])

  const handleMouseMove = useCallback((e: any) => {
    if (!isDragging.current || e?.activeTooltipIndex == null) return
    setDragEnd(e.activeTooltipIndex)
  }, [])

  const handleMouseUp = useCallback(() => {
    if (!isDragging.current) return
    isDragging.current = false

    if (dragStart != null && dragEnd != null) {
      let s = dragStart, e = dragEnd
      if (s > e) [s, e] = [e, s]
      if (e - s >= 1) {
        setSelection({ startIdx: s, endIdx: e })
      }
    }
    setDragStart(null)
    setDragEnd(null)
  }, [dragStart, dragEnd])

  const clearSelection = useCallback(() => setSelection(null), [])

  // Range analysis for selection — filters out zero entries (collection errors / offline)
  const rangeAnalysis = useMemo(() => {
    if (chartData.length === 0 || !selection) return null
    const slice = chartData.slice(selection.startIdx, selection.endIdx + 1)
    if (slice.length === 0) return null

    // Separate valid entries (non-zero) from total for stats
    let peakCpuIdx = 0, maxCpu = -1
    const stats = {
      cpu: { min: Infinity, max: -Infinity, sum: 0, count: 0 },
      memory: { min: Infinity, max: -Infinity, sum: 0, count: 0 },
      disk: { min: Infinity, max: -Infinity, sum: 0, count: 0 },
    }

    slice.forEach((d, i) => {
      if (d.cpu > maxCpu) { maxCpu = d.cpu; peakCpuIdx = i }
      for (const key of ['cpu', 'memory', 'disk'] as const) {
        // Skip zero values for min/avg — they're collection errors
        if (d[key] > 0) {
          stats[key].min = Math.min(stats[key].min, d[key])
          stats[key].sum += d[key]
          stats[key].count++
        }
        stats[key].max = Math.max(stats[key].max, d[key])
      }
    })

    const n = slice.length
    const startTs = slice[0].timestamp
    const endTs = slice[n - 1].timestamp
    const multiDay = spansMultipleDays(startTs, endTs)

    // Count how many entries had zero values (offline/error)
    const offlineCount = slice.filter(d => d.cpu === 0 && d.memory === 0).length

    return {
      peakTimestamp: slice[peakCpuIdx].timestamp,
      peakTimeLabel: formatTs(slice[peakCpuIdx].timestamp, multiDay),
      peakCpu: maxCpu,
      startLabel: formatTs(startTs, multiDay),
      endLabel: formatTs(endTs, multiDay),
      dataPoints: n,
      offlineCount,
      cpu:    { min: stats.cpu.count > 0 ? stats.cpu.min : 0,    max: stats.cpu.max,    avg: stats.cpu.count > 0 ? stats.cpu.sum / stats.cpu.count : 0 },
      memory: { min: stats.memory.count > 0 ? stats.memory.min : 0, max: stats.memory.max, avg: stats.memory.count > 0 ? stats.memory.sum / stats.memory.count : 0 },
      disk:   { min: stats.disk.count > 0 ? stats.disk.min : 0,   max: stats.disk.max,   avg: stats.disk.count > 0 ? stats.disk.sum / stats.disk.count : 0 },
    }
  }, [chartData, selection])

  // Fetch breakdown for peak CPU timestamp
  const peakTimestamp = rangeAnalysis?.peakTimestamp ?? (chartData.length > 0 ? chartData[chartData.length - 1].timestamp : null)
  useEffect(() => {
    if (!peakTimestamp) return
    const fetchBreakdown = async () => {
      setBreakdownLoading(true)
      try {
        const detail = await api.getMetricDetail(serverKey, peakTimestamp)
        setProcesses(detail.processes || [])
        setContainers(detail.containers || [])
        setBreakdownTime(peakTimestamp)
      } catch { /* silently fail */ }
      finally { setBreakdownLoading(false) }
    }
    fetchBreakdown()
  }, [serverKey, peakTimestamp])

  // Sort helpers
  const sortItems = useCallback((items: MetricDetailEntry[], sort: SortState) => {
    return [...items].sort((a, b) => {
      const dir = sort.dir === 'asc' ? 1 : -1
      if (sort.field === 'name') return dir * a.name.localeCompare(b.name)
      if (sort.field === 'cpu') return dir * ((a.cpu ?? 0) - (b.cpu ?? 0))
      return dir * ((a.memory ?? 0) - (b.memory ?? 0))
    })
  }, [])

  // Filter out monitoring artifacts (ps aux itself) from processes
  const filteredProcesses = useMemo(() =>
    processes.filter(p => !p.name.startsWith('ps aux') && !p.name.startsWith('ps -')),
    [processes]
  )

  const sortedProcesses = useMemo(() => sortItems(filteredProcesses, procSort), [filteredProcesses, procSort, sortItems])
  const sortedContainers = useMemo(() => sortItems(containers, contSort), [containers, contSort, sortItems])

  const toggleSort = (current: SortState, field: SortField): SortState => {
    if (current.field === field) return { field, dir: current.dir === 'asc' ? 'desc' : 'asc' }
    return { field, dir: 'desc' }
  }

  const fetchContainerLogs = useCallback(async (containerName: string) => {
    setLogContainer(containerName)
    setLogLoading(true)
    setLogError(null)
    setLogText('')
    try {
      const containerList = await api.getContainers(serverKey)
      const match = containerList.find(c => c.name === containerName)
      if (!match) {
        setLogError(`Container "${containerName}" not found`)
        return
      }
      const logs = await api.getContainerLogs(serverKey, match.id, 200)
      setLogText(logs || '(no logs)')
    } catch (err: any) {
      setLogError(err?.message || 'Failed to fetch logs')
    } finally {
      setLogLoading(false)
    }
  }, [serverKey])

  const SortIcon = ({ sort, field }: { sort: SortState; field: SortField }) => {
    if (sort.field !== field) return <ArrowUpDown className="w-3 h-3 opacity-40" />
    return sort.dir === 'asc'
      ? <ArrowUp className="w-3 h-3 text-blue-400" />
      : <ArrowDown className="w-3 h-3 text-blue-400" />
  }

  // Compute drag preview indices (ordered)
  const dragMin = dragStart != null && dragEnd != null ? Math.min(dragStart, dragEnd) : null
  const dragMax = dragStart != null && dragEnd != null ? Math.max(dragStart, dragEnd) : null

  const cores = serverStatus?.cpu_cores ?? 0
  const dataMultiDay = chartData.length > 1 && spansMultipleDays(chartData[0].timestamp, chartData[chartData.length - 1].timestamp)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-zinc-500">
        <Loader className="w-5 h-5 animate-spin mr-2" />
        Loading {serverInfo.displayName} detail...
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Inline Header */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold text-zinc-50">{serverInfo.displayName}</h3>
          <div className={`w-3 h-3 rounded-full ${getStatusColor(serverStatus)}`} />
        </div>
        {serverStatus && (
          <div className="flex items-center gap-4 text-xs font-mono text-zinc-400">
            <span>CPU <span className="text-zinc-200">{serverStatus.cpu_percent.toFixed(1)}%</span></span>
            <span>MEM <span className="text-zinc-200">{serverStatus.memory_percent.toFixed(1)}%</span></span>
            <span>Disk <span className="text-zinc-200">{serverStatus.disk_percent.toFixed(1)}%</span></span>
            <span>Uptime <span className="text-zinc-200">{formatUptime(serverStatus.uptime_seconds)}</span></span>
          </div>
        )}
      </div>

      {/* Chart Card */}
      <Card className="border-zinc-700 bg-zinc-900/50 p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-semibold text-zinc-300">Resource Trends</h4>
          <div className="flex items-center gap-3">
            {selection && rangeAnalysis ? (
              <>
                <span className="text-xs font-mono text-blue-400">
                  {rangeAnalysis.startLabel} — {rangeAnalysis.endLabel}
                </span>
                <button onClick={clearSelection} className="text-zinc-500 hover:text-zinc-300 transition-colors" title="Limpiar selección">
                  <X className="w-3.5 h-3.5" />
                </button>
              </>
            ) : (
              <span className="text-xs text-zinc-600 font-mono">Click y arrastra sobre la gráfica para analizar un rango</span>
            )}
          </div>
        </div>

        {chartData.length === 0 ? (
          <div className="h-40 flex items-center justify-center text-zinc-500 text-sm">No history data yet.</div>
        ) : (
          <>
            {/* Main chart — click-drag to select analysis range */}
            <div className="select-none">
              <ResponsiveContainer width="100%" height={320}>
                <AreaChart
                  data={chartData}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                  style={{ cursor: 'crosshair' }}
                >
                  <defs>
                    <linearGradient id={`cpu-d-${serverKey}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id={`mem-d-${serverKey}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#a855f7" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id={`disk-d-${serverKey}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis
                    dataKey="idx"
                    type="number"
                    domain={['dataMin', 'dataMax']}
                    tickFormatter={formatXTick}
                    tick={{ fill: '#71717a', fontSize: 10 }}
                    tickLine={false}
                    axisLine={{ stroke: '#3f3f46' }}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fill: '#71717a', fontSize: 10 }}
                    tickLine={false}
                    axisLine={{ stroke: '#3f3f46' }}
                    tickFormatter={(v) => `${v}%`}
                  />
                  <Tooltip
                    labelFormatter={formatTooltipLabel}
                    contentStyle={{ backgroundColor: '#18181b', border: '1px solid #3f3f46', borderRadius: '6px', fontSize: 12 }}
                    labelStyle={{ color: '#a1a1aa' }}
                  />
                  <Area type="monotone" dataKey="cpu" stroke="#3b82f6" fill={`url(#cpu-d-${serverKey})`} strokeWidth={1.5} name="CPU" />
                  <Area type="monotone" dataKey="memory" stroke="#a855f7" fill={`url(#mem-d-${serverKey})`} strokeWidth={1.5} name="Memory" />
                  <Area type="monotone" dataKey="disk" stroke="#f59e0b" fill={`url(#disk-d-${serverKey})`} strokeWidth={1.5} name="Disk" />

                  {/* Live drag preview */}
                  {dragMin != null && dragMax != null && (
                    <ReferenceArea
                      x1={dragMin}
                      x2={dragMax}
                      fill="#3b82f6"
                      fillOpacity={0.2}
                      stroke="#3b82f6"
                      strokeOpacity={0.6}
                      strokeDasharray="4 2"
                    />
                  )}

                  {/* Confirmed selection */}
                  {selection && !isDragging.current && (
                    <ReferenceArea
                      x1={selection.startIdx}
                      x2={selection.endIdx}
                      fill="#3b82f6"
                      fillOpacity={0.15}
                      stroke="#60a5fa"
                      strokeOpacity={0.9}
                      strokeWidth={2}
                    />
                  )}

                  {/* Brush navigator at bottom — for panning/zooming through time */}
                  <Brush
                    dataKey="idx"
                    height={40}
                    stroke="#3f3f46"
                    fill="#0c0c0e"
                    travellerWidth={12}
                    tickFormatter={formatXTick}
                  >
                    <AreaChart data={chartData}>
                      <Area type="monotone" dataKey="cpu" stroke="#3b82f650" fill="#3b82f620" strokeWidth={1} />
                    </AreaChart>
                  </Brush>
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Legend */}
            <div className="flex items-center justify-between mt-2">
              <div className="flex gap-4 text-xs text-zinc-500">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500" /> CPU</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-500" /> Memory</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" /> Disk</span>
              </div>
              <span className="text-[10px] text-zinc-600 font-mono">
                Brush inferior: arrastra para navegar en el tiempo
              </span>
            </div>
          </>
        )}
      </Card>

      {/* Range Summary */}
      {rangeAnalysis && selection && (
        <Card className="border-blue-900/50 bg-zinc-900/50 p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-4 h-4 text-blue-400" />
            <h4 className="text-sm font-semibold text-zinc-300">
              Rango: {rangeAnalysis.startLabel} — {rangeAnalysis.endLabel}
            </h4>
            <span className="text-xs text-zinc-500 font-mono ml-auto">{rangeAnalysis.dataPoints} muestras</span>
          </div>
          <div className="grid grid-cols-3 gap-4">
            {([
              { label: 'CPU', color: 'text-blue-400', data: rangeAnalysis.cpu },
              { label: 'Memory', color: 'text-purple-400', data: rangeAnalysis.memory },
              { label: 'Disk', color: 'text-amber-400', data: rangeAnalysis.disk },
            ] as const).map(({ label, color, data }) => (
              <div key={label} className="bg-black/30 rounded border border-zinc-800 p-3">
                <p className={`text-xs font-semibold ${color} mb-2`}>{label}</p>
                <div className="grid grid-cols-3 gap-2 text-xs font-mono">
                  <div>
                    <p className="text-zinc-500">Min</p>
                    <p className="text-zinc-300">{data.min.toFixed(1)}%</p>
                  </div>
                  <div>
                    <p className="text-zinc-500">Avg</p>
                    <p className="text-zinc-300">{data.avg.toFixed(1)}%</p>
                  </div>
                  <div>
                    <p className="text-zinc-500">Max</p>
                    <p className={`${data.max > 80 ? 'text-red-400' : data.max > 60 ? 'text-amber-400' : 'text-green-400'} font-bold`}>
                      {data.max.toFixed(1)}%
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 text-xs text-zinc-500 font-mono border-t border-zinc-800 pt-2 space-y-1">
            <p>
              Pico CPU: <span className="text-red-400 font-bold">{rangeAnalysis.peakCpu.toFixed(1)}%</span> a las <span className="text-zinc-300">{rangeAnalysis.peakTimeLabel}</span>
              {' — '}el breakdown muestra los procesos de ese momento
            </p>
            {rangeAnalysis.offlineCount > 0 && (
              <p className="text-amber-500">
                {rangeAnalysis.offlineCount} muestras sin datos (offline/error de recolección) excluidas de Min/Avg
              </p>
            )}
          </div>
        </Card>
      )}

      {/* Resource Breakdown */}
      <Card className="border-zinc-700 bg-zinc-900/50 p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-semibold text-zinc-300">
            {selection ? 'Breakdown en el pico' : 'Resource Breakdown'}
          </h4>
          {breakdownTime && (
            <span className="text-xs text-zinc-500 font-mono">
              {formatTs(breakdownTime, dataMultiDay)}
              {rangeAnalysis && selection && (
                <span className="ml-2 text-red-400">CPU: {rangeAnalysis.peakCpu.toFixed(1)}%</span>
              )}
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
            No breakdown data available for this timestamp.
          </p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Top Processes */}
            {sortedProcesses.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Cpu className="w-3.5 h-3.5 text-blue-400" />
                  <span className="text-xs font-semibold text-zinc-400">Top Processes ({sortedProcesses.length})</span>
                  {cores > 0 && <span className="text-[10px] text-zinc-600">{cores} cores</span>}
                </div>
                <div className="bg-black rounded border border-zinc-800 overflow-hidden max-h-[320px] overflow-y-auto">
                  <table className="w-full text-xs font-mono">
                    <thead className="sticky top-0">
                      <tr className="text-zinc-500 border-b border-zinc-800 bg-zinc-900">
                        <th className="text-left px-2 py-1.5 cursor-pointer hover:text-zinc-300 select-none" onClick={() => setProcSort(toggleSort(procSort, 'name'))}>
                          <span className="flex items-center gap-1">Process <SortIcon sort={procSort} field="name" /></span>
                        </th>
                        <th className="text-right px-2 py-1.5 w-24 cursor-pointer hover:text-zinc-300 select-none" onClick={() => setProcSort(toggleSort(procSort, 'cpu'))}>
                          <span className="flex items-center justify-end gap-1">CPU <SortIcon sort={procSort} field="cpu" /></span>
                        </th>
                        <th className="text-right px-2 py-1.5 w-16 cursor-pointer hover:text-zinc-300 select-none" onClick={() => setProcSort(toggleSort(procSort, 'memory'))}>
                          <span className="flex items-center justify-end gap-1">MEM <SortIcon sort={procSort} field="memory" /></span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedProcesses.map((p, i) => {
                        const cpuVal = p.cpu ?? 0
                        const coresUsed = cores > 0 ? cpuVal / 100 : 0
                        const normalizedPct = cores > 0 ? (cpuVal / (cores * 100)) * 100 : 0
                        return (
                          <tr key={i} className="border-b border-zinc-900/50 hover:bg-zinc-900/30">
                            <td className="px-2 py-1 text-zinc-300 truncate max-w-[200px]" title={p.name}>{p.name}</td>
                            <td className="text-right px-2 py-1 whitespace-nowrap">
                              {cores > 0 ? (
                                <>
                                  <span className={`${normalizedPct > 80 ? 'text-red-400 font-bold' : normalizedPct > 50 ? 'text-red-400' : normalizedPct > 20 ? 'text-amber-400' : 'text-green-400'}`}>
                                    {normalizedPct.toFixed(0)}%
                                  </span>
                                  <span className="text-zinc-600 ml-1">
                                    {coresUsed.toFixed(1)}c
                                  </span>
                                </>
                              ) : (
                                <span className={`${cpuVal > 100 ? 'text-red-400 font-bold' : cpuVal > 50 ? 'text-red-400' : cpuVal > 20 ? 'text-amber-400' : 'text-green-400'}`}>
                                  {cpuVal.toFixed(1)}%
                                </span>
                              )}
                            </td>
                            <td className={`text-right px-2 py-1 ${p.memory > 50 ? 'text-red-400' : p.memory > 20 ? 'text-amber-400' : 'text-green-400'}`}>
                              {(p.memory ?? 0).toFixed(1)}%
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Docker Containers */}
            {sortedContainers.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Container className="w-3.5 h-3.5 text-purple-400" />
                  <span className="text-xs font-semibold text-zinc-400">Docker Containers ({sortedContainers.length})</span>
                </div>
                <div className="bg-black rounded border border-zinc-800 overflow-hidden max-h-[320px] overflow-y-auto">
                  <table className="w-full text-xs font-mono">
                    <thead className="sticky top-0">
                      <tr className="text-zinc-500 border-b border-zinc-800 bg-zinc-900">
                        <th className="text-left px-2 py-1.5 cursor-pointer hover:text-zinc-300 select-none" onClick={() => setContSort(toggleSort(contSort, 'name'))}>
                          <span className="flex items-center gap-1">Container <SortIcon sort={contSort} field="name" /></span>
                        </th>
                        <th className="text-right px-2 py-1.5 w-16 cursor-pointer hover:text-zinc-300 select-none" onClick={() => setContSort(toggleSort(contSort, 'cpu'))}>
                          <span className="flex items-center justify-end gap-1">CPU <SortIcon sort={contSort} field="cpu" /></span>
                        </th>
                        <th className="text-right px-2 py-1.5 w-16 cursor-pointer hover:text-zinc-300 select-none" onClick={() => setContSort(toggleSort(contSort, 'memory'))}>
                          <span className="flex items-center justify-end gap-1">MEM <SortIcon sort={contSort} field="memory" /></span>
                        </th>
                        <th className="text-right px-2 py-1.5 w-20">Usage</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedContainers.map((c, i) => (
                        <tr key={i} onDoubleClick={() => fetchContainerLogs(c.name)} className="border-b border-zinc-900/50 hover:bg-zinc-900/30 cursor-pointer">
                          <td className="px-2 py-1 text-zinc-300 truncate max-w-[160px]" title={c.name}>{c.name}</td>
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

                {/* Container log viewer */}
                {logContainer ? (
                  <div className="mt-3 bg-black rounded border border-zinc-800 overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800 bg-zinc-900/80">
                      <div className="flex items-center gap-2">
                        <FileText className="w-3.5 h-3.5 text-purple-400" />
                        <span className="text-xs font-semibold text-zinc-300">{logContainer}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => fetchContainerLogs(logContainer)}
                          disabled={logLoading}
                          className="p-1 text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-50"
                          title="Refresh logs"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${logLoading ? 'animate-spin' : ''}`} />
                        </button>
                        <button
                          onClick={() => setLogContainer(null)}
                          className="p-1 text-zinc-500 hover:text-zinc-300 transition-colors"
                          title="Close logs"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="max-h-[400px] overflow-y-auto p-2">
                      {logLoading ? (
                        <div className="flex items-center gap-2 text-zinc-500 text-xs py-4 justify-center">
                          <Loader className="w-3.5 h-3.5 animate-spin" />
                          Loading logs...
                        </div>
                      ) : logError ? (
                        <p className="text-xs text-red-400 py-2 px-1">{logError}</p>
                      ) : (
                        <pre className="text-[11px] font-mono leading-relaxed whitespace-pre-wrap break-all">
                          {logText.split('\n').map((line, i) => {
                            const color = /error/i.test(line) ? 'text-red-400'
                              : /warn/i.test(line) ? 'text-amber-400'
                              : 'text-green-400/80'
                            return <div key={i} className={color}>{line}</div>
                          })}
                        </pre>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-[10px] text-zinc-600 mt-1.5 text-center">Double-click a container to view logs</p>
                )}
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}
