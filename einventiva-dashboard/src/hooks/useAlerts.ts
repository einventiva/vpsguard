import { useEffect } from 'react'
import { toast } from 'sonner'
import { getSharedSocket, releaseSharedSocket } from '@/lib/socket'
import type { Alert } from '@/types'

export function useAlerts() {
  useEffect(() => {
    const socket = getSharedSocket()

    const handleAlerts = (alerts: Alert[]) => {
      for (const alert of alerts) {
        if (alert.severity === 'critical') {
          toast.error(alert.message, {
            description: `${alert.type.toUpperCase()} threshold exceeded`,
            duration: 10000,
          })
        } else {
          toast.warning(alert.message, {
            description: `${alert.type.toUpperCase()} threshold exceeded`,
            duration: 7000,
          })
        }
      }
    }

    socket.on('alerts', handleAlerts)

    return () => {
      socket.off('alerts', handleAlerts)
      releaseSharedSocket()
    }
  }, [])
}
