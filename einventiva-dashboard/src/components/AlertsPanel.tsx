import { useState } from 'react'
import type { Alert, ServerInfo } from '@/types'
import type { UseAlertsReturn } from '@/hooks/useAlerts'
import type { UseThresholdsReturn } from '@/hooks/useThresholds'
import { ThresholdsEditor } from './ThresholdsEditor'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AlertCircle, AlertTriangle, CheckCircle, Check, Loader, BellOff } from 'lucide-react'

interface AlertsPanelProps {
  alertsApi: UseAlertsReturn
  thresholdsApi: UseThresholdsReturn
  servers: Record<string, ServerInfo>
}

type FilterType = 'active' | 'all'

function formatDuration(startIso: string, endIso: string | null): string {
  const start = new Date(startIso).getTime()
  const end = endIso ? new Date(endIso).getTime() : Date.now()
  const totalSec = Math.max(0, Math.floor((end - start) / 1000))
  if (totalSec < 60) return `${totalSec}s`
  const min = Math.floor(totalSec / 60)
  if (min < 60) return `${min}m ${totalSec % 60}s`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours}h ${min % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

function formatWhen(iso: string): string {
  const d = new Date(iso)
  const sameDay = d.toDateString() === new Date().toDateString()
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return sameDay ? time : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`
}

const TYPE_LABELS: Record<Alert['type'], string> = {
  cpu: 'CPU',
  memory: 'MEM',
  disk: 'DISK',
  offline: 'OFFLINE',
  'disk-eta': 'DISK ETA',
  cron: 'CRON',
  'pg-connections': 'PG CONN',
  inodes: 'INODES',
  systemd: 'SYSTEMD',
  ssl: 'SSL',
  flapping: 'FLAPPING',
  'pg-replication': 'PG REPL',
  script: 'SCRIPT',
}

function AlertRow({ alert, serverName, onAck }: { alert: Alert; serverName: string; onAck: (id: number) => void }) {
  const active = !alert.resolved_at
  const Icon = active
    ? (alert.severity === 'critical' ? AlertCircle : AlertTriangle)
    : CheckCircle
  const iconColor = active
    ? (alert.severity === 'critical' ? 'text-red-500' : 'text-amber-500')
    : 'text-green-500'

  return (
    <div className={`flex items-center gap-3 px-4 py-3 border-b border-zinc-800/70 last:border-b-0 ${active ? '' : 'opacity-60'}`}>
      <Icon className={`w-4 h-4 flex-shrink-0 ${iconColor}`} />
      <Badge variant="outline" className="border-zinc-700 text-zinc-400 font-mono text-[10px] w-20 justify-center flex-shrink-0">
        {TYPE_LABELS[alert.type]}
      </Badge>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-zinc-200 truncate">{alert.message}</p>
        <p className="text-xs text-zinc-500 font-mono">
          {serverName} · {formatWhen(alert.started_at)} · {active ? 'ongoing' : 'lasted'} {formatDuration(alert.started_at, alert.resolved_at)}
          {alert.value != null && alert.threshold != null && ['cpu', 'memory', 'disk'].includes(alert.type) && ` · peak ${alert.value.toFixed(1)}% (limit ${alert.threshold}%)`}
          {alert.type === 'disk-eta' && alert.value != null && ` · ~${Math.round(alert.value)}d left (alert at ${alert.threshold}d)`}
        </p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {active ? (
          <Badge className="bg-red-900/40 text-red-300 border border-red-800 text-[10px]">Active</Badge>
        ) : (
          <Badge className="bg-green-900/30 text-green-400 border border-green-800/50 text-[10px]">Resolved</Badge>
        )}
        {active && (
          alert.acknowledged_at ? (
            <span className="text-xs text-zinc-500 flex items-center gap-1"><Check className="w-3 h-3" /> Ack</span>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onAck(alert.id)}
              className="h-7 px-2 border-zinc-700 text-zinc-300 hover:bg-zinc-800 text-xs"
            >
              Acknowledge
            </Button>
          )
        )}
      </div>
    </div>
  )
}

export function AlertsPanel({ alertsApi, thresholdsApi, servers }: AlertsPanelProps) {
  const { alerts, loading, activeCount, acknowledge } = alertsApi
  const [filter, setFilter] = useState<FilterType>('all')

  const visible = filter === 'active' ? alerts.filter(a => !a.resolved_at) : alerts

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40 text-zinc-500 text-sm gap-2">
        <Loader className="w-4 h-4 animate-spin" /> Loading alerts...
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant={filter === 'all' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter('all')}
            className={filter === 'all' ? 'bg-zinc-800 text-zinc-50 hover:bg-zinc-700' : 'border-zinc-700 text-zinc-400 hover:bg-zinc-900'}
          >
            All ({alerts.length})
          </Button>
          <Button
            variant={filter === 'active' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter('active')}
            className={filter === 'active' ? 'bg-zinc-800 text-zinc-50 hover:bg-zinc-700' : 'border-zinc-700 text-zinc-400 hover:bg-zinc-900'}
          >
            Active ({activeCount})
          </Button>
        </div>
      </div>

      <Card className="border-zinc-700 bg-zinc-900/50 overflow-hidden">
        {visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-zinc-500 gap-2">
            <BellOff className="w-6 h-6" />
            <p className="text-sm">{filter === 'active' ? 'No active alerts — all clear' : 'No alerts recorded yet'}</p>
          </div>
        ) : (
          visible.map(alert => (
            <AlertRow
              key={alert.id}
              alert={alert}
              serverName={servers[alert.server]?.displayName || alert.server}
              onAck={acknowledge}
            />
          ))
        )}
      </Card>

      <p className="text-xs text-zinc-600">
        Alerts open after 2 consecutive samples over threshold (~30s) and resolve after 4 clean samples (~1min). Offline alerts resolve on the first successful connection.
      </p>

      <ThresholdsEditor thresholdsApi={thresholdsApi} servers={servers} />
    </div>
  )
}
