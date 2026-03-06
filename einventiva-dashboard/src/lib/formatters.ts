import type { ServerStatus } from '@/types'

export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const mins = Math.floor((seconds % 3600) / 60)

  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

export function getStatusColor(server: ServerStatus | null): string {
  if (!server?.online) return 'bg-red-600'
  if (server.cpu_percent > 80 || server.memory_percent > 85) return 'bg-red-600'
  if (server.cpu_percent > 60 || server.memory_percent > 70) return 'bg-amber-500'
  return 'bg-green-500'
}
