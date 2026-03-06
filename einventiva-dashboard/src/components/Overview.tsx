import type { ServerData, ServerInfo } from '@/types'
import { ServerCard } from './ServerCard'
import { TrendChart } from './TrendChart'
import { Card } from '@/components/ui/card'
import { AlertCircle, AlertTriangle, CheckCircle } from 'lucide-react'

interface OverviewProps {
  data: ServerData | null
  loading: boolean
  error: string | null
  servers: Record<string, ServerInfo>
  serverKeys: string[]
  onServerClick?: (serverKey: string) => void
}

export function Overview({ data, loading, error, servers, serverKeys, onServerClick }: OverviewProps) {
  if (error) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 p-4 bg-red-900/20 border border-red-800 rounded">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <div>
            <h3 className="font-semibold text-red-50">Connection Error</h3>
            <p className="text-sm text-red-200">{error}</p>
          </div>
        </div>
      </div>
    )
  }

  if (loading || !data) {
    return (
      <div className="space-y-4">
        <div className={`grid gap-6 ${serverKeys.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
          {(serverKeys.length > 0 ? serverKeys : [1, 2]).map((i) => (
            <Card
              key={String(i)}
              className="border-zinc-700 bg-zinc-900/50 p-6 animate-pulse"
            >
              <div className="space-y-4">
                <div className="h-6 bg-zinc-800 rounded w-32" />
                <div className="h-32 bg-zinc-800 rounded-full mx-auto w-32" />
                <div className="space-y-2">
                  <div className="h-2 bg-zinc-800 rounded w-full" />
                  <div className="h-2 bg-zinc-800 rounded w-full" />
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  const entries = Object.entries(data)

  const getSystemHealth = () => {
    const anyOffline = entries.some(([, s]) => !s.online)
    const anyAlerts = entries.some(([, s]) => s.cpu_percent > 80 || s.memory_percent > 85)

    if (anyOffline) {
      return {
        icon: AlertCircle,
        color: 'text-red-500',
        bg: 'bg-red-900/20',
        border: 'border-red-800',
        text: 'Critical',
      }
    }
    if (anyAlerts) {
      return {
        icon: AlertTriangle,
        color: 'text-amber-500',
        bg: 'bg-amber-900/20',
        border: 'border-amber-800',
        text: 'Warning',
      }
    }
    return {
      icon: CheckCircle,
      color: 'text-green-500',
      bg: 'bg-green-900/20',
      border: 'border-green-800',
      text: 'Healthy',
    }
  }

  const health = getSystemHealth()
  const HealthIcon = health.icon

  const totalContainers = entries.reduce((sum, [, s]) => sum + s.container_count, 0)
  const avgCpu = entries.length > 0
    ? entries.reduce((sum, [, s]) => sum + s.cpu_percent, 0) / entries.length
    : 0
  const avgMemory = entries.length > 0
    ? entries.reduce((sum, [, s]) => sum + s.memory_percent, 0) / entries.length
    : 0
  const onlineCount = entries.filter(([, s]) => s.online).length

  const gridCols = entries.length === 1 ? 'grid-cols-1' : entries.length <= 2 ? 'grid-cols-2' : entries.length === 3 ? 'grid-cols-3' : 'grid-cols-2 lg:grid-cols-3'

  return (
    <div className="space-y-6">
      {/* System Health Summary */}
      <div
        className={`flex items-center gap-3 p-4 ${health.bg} border ${health.border} rounded`}
      >
        <HealthIcon className={`w-6 h-6 ${health.color} flex-shrink-0`} />
        <div>
          <h2 className="font-semibold text-zinc-50">System Status</h2>
          <p className="text-sm text-zinc-300">{health.text}</p>
        </div>
      </div>

      {/* Server Cards Grid */}
      <div className={`grid gap-6 ${gridCols}`}>
        {entries.map(([key, status]) => (
          <ServerCard
            key={key}
            server={status}
            title={servers[key]?.displayName || key}
            onClick={onServerClick ? () => onServerClick(key) : undefined}
          />
        ))}
      </div>

      {/* Trend Charts */}
      <div className={`grid gap-6 ${gridCols}`}>
        {entries.map(([key]) => (
          <TrendChart
            key={key}
            server={key}
            title={servers[key]?.displayName || key}
            mini
            onClick={onServerClick ? () => onServerClick(key) : undefined}
          />
        ))}
      </div>

      {/* Quick Stats */}
      <Card className="border-zinc-700 bg-zinc-900/50 p-6">
        <h3 className="text-sm font-semibold text-zinc-50 mb-4">Quick Stats</h3>
        <div className="grid grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-zinc-400 mb-1">Total Containers</p>
            <p className="text-2xl font-mono font-bold text-blue-400">
              {totalContainers}
            </p>
          </div>
          <div>
            <p className="text-xs text-zinc-400 mb-1">Avg CPU Usage</p>
            <p className="text-2xl font-mono font-bold text-zinc-200">
              {avgCpu.toFixed(1)}%
            </p>
          </div>
          <div>
            <p className="text-xs text-zinc-400 mb-1">Avg Memory</p>
            <p className="text-2xl font-mono font-bold text-zinc-200">
              {avgMemory.toFixed(1)}%
            </p>
          </div>
          <div>
            <p className="text-xs text-zinc-400 mb-1">Online Servers</p>
            <p className="text-2xl font-mono font-bold text-green-400">
              {onlineCount}/{entries.length}
            </p>
          </div>
        </div>
      </Card>
    </div>
  )
}
