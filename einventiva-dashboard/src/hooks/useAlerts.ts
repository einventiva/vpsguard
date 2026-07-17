import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { getSharedSocket, releaseSharedSocket } from '@/lib/socket'
import { api } from '@/lib/api'
import type { Alert } from '@/types'

export interface UseAlertsReturn {
  alerts: Alert[]
  loading: boolean
  activeCount: number
  unackedCount: number
  acknowledge: (id: number) => Promise<void>
  refetch: () => Promise<void>
}

export function useAlerts(): UseAlertsReturn {
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)

  const refetch = useCallback(async () => {
    try {
      const response = await api.getAlerts(false, 200)
      setAlerts(response.alerts)
    } catch (err) {
      console.error('Failed to fetch alerts:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refetch()

    const socket = getSharedSocket()

    const DESCRIPTIONS: Partial<Record<Alert['type'], string>> = {
      offline: 'Server unreachable',
      'disk-eta': 'Disk projected to fill up',
      cron: 'Cron jobs overdue',
      'pg-connections': 'PostgreSQL connections near limit',
      inodes: 'Inode exhaustion',
      systemd: 'Failed systemd units',
      ssl: 'SSL certificate expiring',
      flapping: 'Container restarts increasing',
      'pg-replication': 'PostgreSQL replication lagging',
      script: 'Scheduled script failing',
      ai: 'AI analysis findings',
    }

    const onOpened = (alert: Alert) => {
      setAlerts(prev => [alert, ...prev.filter(a => a.id !== alert.id)])
      const description = DESCRIPTIONS[alert.type] ?? `${alert.type.toUpperCase()} threshold exceeded`
      if (alert.severity === 'critical') {
        toast.error(alert.message, { description, duration: 10000 })
      } else {
        toast.warning(alert.message, { description, duration: 7000 })
      }
    }

    const onResolved = (alert: Alert) => {
      setAlerts(prev => prev.map(a => (a.id === alert.id ? alert : a)))
      toast.success(`Resolved: ${alert.message}`, { duration: 5000 })
    }

    socket.on('alert:opened', onOpened)
    socket.on('alert:resolved', onResolved)

    return () => {
      socket.off('alert:opened', onOpened)
      socket.off('alert:resolved', onResolved)
      releaseSharedSocket()
    }
  }, [refetch])

  const acknowledge = useCallback(async (id: number) => {
    try {
      const updated = await api.ackAlert(id)
      setAlerts(prev => prev.map(a => (a.id === id ? updated : a)))
    } catch (err) {
      console.error('Failed to acknowledge alert:', err)
      toast.error('Failed to acknowledge alert')
    }
  }, [])

  const activeCount = alerts.filter(a => !a.resolved_at).length
  const unackedCount = alerts.filter(a => !a.resolved_at && !a.acknowledged_at).length

  return { alerts, loading, activeCount, unackedCount, acknowledge, refetch }
}
