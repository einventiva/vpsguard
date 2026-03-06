import type { ServerStatus } from '@/types'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Activity, HardDrive, Zap } from 'lucide-react'
import { formatUptime, getStatusColor } from '@/lib/formatters'

interface ServerCardProps {
  server: ServerStatus
  title: string
  onClick?: () => void
}

export function ServerCard({ server, title, onClick }: ServerCardProps) {
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
            <div className={`w-3 h-3 rounded-full ${getStatusColor(server)}`} />
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
              stroke={
                server.cpu_percent > 80
                  ? '#dc2626'
                  : server.cpu_percent > 60
                    ? '#f59e0b'
                    : '#22c55e'
              }
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
              className={`h-full transition-all duration-500 ${
                server.memory_percent > 85
                  ? 'bg-red-600'
                  : server.memory_percent > 70
                    ? 'bg-amber-500'
                    : 'bg-green-500'
              }`}
              style={{ width: `${server.memory_percent}%` }}
            />
          </div>
          <p className="text-xs text-zinc-500 mt-1 font-mono">
            {(server.memory_used / 1024).toFixed(1)}GB / {(server.memory_total / 1024).toFixed(1)}GB
          </p>
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
              className={`h-full transition-all duration-500 ${
                server.disk_percent > 85
                  ? 'bg-red-600'
                  : server.disk_percent > 70
                    ? 'bg-amber-500'
                    : 'bg-green-500'
              }`}
              style={{ width: `${server.disk_percent}%` }}
            />
          </div>
          <p className="text-xs text-zinc-500 mt-1 font-mono">
            {(server.disk_used / 1024 / 1024 / 1024).toFixed(1)}GB / {(server.disk_total / 1024 / 1024 / 1024).toFixed(1)}GB
          </p>
        </div>

        {/* Load Average */}
        <div className="pt-2 border-t border-zinc-700">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-zinc-400" />
              <span className="text-sm text-zinc-400">Load Avg</span>
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
      </div>
    </Card>
  )
}
