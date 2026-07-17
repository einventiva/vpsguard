import type { ServerStatus, Thresholds, ServerProjection } from '@/types'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Activity, HardDrive, Zap, TrendingUp, Wifi, AlertTriangle, RotateCcw } from 'lucide-react'
import { formatUptime, getStatusColor, metricLevel, DEFAULT_THRESHOLDS } from '@/lib/formatters'

interface ServerCardProps {
  server: ServerStatus
  title: string
  thresholds?: Thresholds
  projection?: ServerProjection
  onClick?: () => void
}

const LEVEL_HEX = { critical: '#dc2626', warning: '#f59e0b', ok: '#22c55e' } as const
const LEVEL_BG = { critical: 'bg-red-600', warning: 'bg-amber-500', ok: 'bg-green-500' } as const

function diskEtaColor(etaDays: number): string {
  if (etaDays < 14) return 'text-red-400'
  if (etaDays < 30) return 'text-amber-400'
  return 'text-zinc-500'
}

// The measurement includes the metrics command itself (top -bn1 alone
// takes ~2s), so the healthy baseline is 2-3s — color on deviation
function latencyColor(ms: number): string {
  if (ms > 10000) return 'text-red-400'
  if (ms > 6000) return 'text-amber-400'
  return 'text-zinc-200'
}

export function ServerCard({ server, title, thresholds = DEFAULT_THRESHOLDS, projection, onClick }: ServerCardProps) {
  const diskEta = projection?.disk.etaDays ?? null
  const memTrend = projection?.memory.trendingUp ? projection.memory.slopePerHour : null
  const cpuRadius = 45
  const cpuCircumference = 2 * Math.PI * cpuRadius
  const cpuOffset = cpuCircumference - (server.cpu_percent / 100) * cpuCircumference

  const getLoadColor = (): string => {
    const load = server.load_avg?.[0] ?? 0
    if (load > 4) return 'text-red-400'
    if (load > 2) return 'text-amber-400'
    return 'text-green-400'
  }

  return (
    <Card
      className={`border-zinc-700 bg-zinc-900/50 p-6 ${onClick ? 'cursor-pointer hover:border-zinc-500 transition-colors' : ''}`}
      onClick={onClick}
    >
      {/* Header with status */}
      <div className="mb-6 flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-1">
            <h3 className="text-lg font-semibold text-zinc-50">{title}</h3>
            <div className={`w-3 h-3 rounded-full ${getStatusColor(server, thresholds)}`} />
          </div>
          <p className="text-sm text-zinc-400 font-mono">{server.hostname}</p>
          <p className="text-xs text-zinc-500 font-mono">{server.ip}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-zinc-400 mb-1">Uptime</p>
          <p className="text-sm font-mono text-zinc-200">
            {formatUptime(server.uptime_seconds)}
          </p>
        </div>
      </div>

      {/* CPU Gauge */}
      <div className="mb-6 flex items-center justify-center">
        <div className="relative w-32 h-32">
          <svg
            viewBox="0 0 100 100"
            className="w-full h-full transform -rotate-90"
          >
            {/* Background circle */}
            <circle
              cx="50"
              cy="50"
              r={cpuRadius}
              fill="none"
              stroke="hsl(from hsl(240,10%,11%) h s l / 0.3)"
              strokeWidth="6"
            />
            {/* Progress circle */}
            <circle
              cx="50"
              cy="50"
              r={cpuRadius}
              fill="none"
              stroke={LEVEL_HEX[metricLevel(server.cpu_percent, thresholds.cpu)]}
              strokeWidth="6"
              strokeDasharray={cpuCircumference}
              strokeDashoffset={cpuOffset}
              strokeLinecap="round"
              className="transition-all duration-500"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <p className="text-2xl font-mono font-bold text-zinc-100">
              {server.cpu_percent.toFixed(1)}%
            </p>
            <p className="text-xs text-zinc-500">CPU</p>
          </div>
        </div>
      </div>

      {/* Memory and Disk bars */}
      <div className="space-y-4">
        {/* Memory */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-zinc-400" />
              <span className="text-sm text-zinc-400">Memory</span>
            </div>
            <span className="text-sm font-mono text-zinc-200">
              {server.memory_percent.toFixed(1)}%
            </span>
          </div>
          <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${LEVEL_BG[metricLevel(server.memory_percent, thresholds.memory)]}`}
              style={{ width: `${server.memory_percent}%` }}
            />
          </div>
          <div className="flex items-center justify-between mt-1">
            <p className="text-xs text-zinc-500 font-mono">
              {(server.memory_used / 1024).toFixed(1)}GB / {(server.memory_total / 1024).toFixed(1)}GB
            </p>
            {memTrend != null && (
              <p className="text-xs font-mono text-amber-400 flex items-center gap-1" title="Sustained memory climb — possible leak">
                <TrendingUp className="w-3 h-3" /> +{memTrend.toFixed(1)}%/h
              </p>
            )}
          </div>
        </div>

        {/* Disk */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-zinc-400" />
              <span className="text-sm text-zinc-400">Disk</span>
            </div>
            <span className="text-sm font-mono text-zinc-200">
              {server.disk_percent.toFixed(1)}%
            </span>
          </div>
          <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${LEVEL_BG[metricLevel(server.disk_percent, thresholds.disk)]}`}
              style={{ width: `${server.disk_percent}%` }}
            />
          </div>
          <div className="flex items-center justify-between mt-1">
            <p className="text-xs text-zinc-500 font-mono">
              {(server.disk_used / 1024 / 1024 / 1024).toFixed(1)}GB / {(server.disk_total / 1024 / 1024 / 1024).toFixed(1)}GB
            </p>
            {diskEta != null && diskEta < 90 && (
              <p className={`text-xs font-mono ${diskEtaColor(diskEta)}`} title={`Filling ~${projection?.disk.slopePerDay?.toFixed(2)}%/day`}>
                ≈ {Math.round(diskEta)}d until full
              </p>
            )}
          </div>
        </div>

        {/* Load Average + SSH latency */}
        <div className="pt-2 border-t border-zinc-700">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-zinc-400" />
              <span className="text-sm text-zinc-400">Load Avg</span>
              {server.ssh_latency_ms != null && (
                <span
                  className={`flex items-center gap-1 text-xs font-mono ${latencyColor(server.ssh_latency_ms)}`}
                  title="SSH round-trip time of the metrics collection"
                >
                  <Wifi className="w-3 h-3 text-zinc-500" />
                  {server.ssh_latency_ms < 1000 ? `${server.ssh_latency_ms}ms` : `${(server.ssh_latency_ms / 1000).toFixed(1)}s`}
                </span>
              )}
            </div>
            <Tooltip>
              <TooltipTrigger className="text-sm font-mono text-zinc-200">
                <span className={getLoadColor()}>
                  {(server.load_avg?.[0] ?? 0).toFixed(2)}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <div className="font-mono text-xs space-y-1">
                  <p>1min: {(server.load_avg?.[0] ?? 0).toFixed(2)}</p>
                  <p>5min: {(server.load_avg?.[1] ?? 0).toFixed(2)}</p>
                  <p>15min: {(server.load_avg?.[2] ?? 0).toFixed(2)}</p>
                </div>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Container Count */}
        <div className="flex items-center justify-between pt-2 border-t border-zinc-700">
          <span className="text-sm text-zinc-400">Containers</span>
          <Badge variant="outline" className="border-zinc-700 text-zinc-300">
            {server.container_count} running
          </Badge>
        </div>

        {/* Signal chips — only shown when something needs attention */}
        {(server.reboot_required || server.failed_units.length > 0 || server.swap_percent > 50 || server.inodes_percent > 80) && (
          <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-zinc-700">
            {server.reboot_required && (
              <span className="flex items-center gap-1 text-[10px] text-amber-400 bg-amber-900/20 border border-amber-800/50 px-1.5 py-0.5 rounded font-semibold uppercase tracking-wider" title="Pending updates require a reboot">
                <RotateCcw className="w-3 h-3" /> Reboot required
              </span>
            )}
            {server.failed_units.length > 0 && (
              <span className="flex items-center gap-1 text-[10px] text-red-400 bg-red-900/20 border border-red-800/50 px-1.5 py-0.5 rounded font-semibold uppercase tracking-wider" title={server.failed_units.join(', ')}>
                <AlertTriangle className="w-3 h-3" /> {server.failed_units.length} failed unit{server.failed_units.length !== 1 ? 's' : ''}
              </span>
            )}
            {server.swap_percent > 50 && (
              <span className="text-[10px] text-amber-400 bg-amber-900/20 border border-amber-800/50 px-1.5 py-0.5 rounded font-semibold uppercase tracking-wider" title="Sustained swap usage means real memory pressure">
                Swap {server.swap_percent.toFixed(0)}%
              </span>
            )}
            {server.inodes_percent > 80 && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wider border ${server.inodes_percent > 90 ? 'text-red-400 bg-red-900/20 border-red-800/50' : 'text-amber-400 bg-amber-900/20 border-amber-800/50'}`} title="Inode usage — a disk can fill on inodes with free space left">
                Inodes {server.inodes_percent}%
              </span>
            )}
          </div>
        )}
      </div>
    </Card>
  )
}
