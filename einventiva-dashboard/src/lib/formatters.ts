import type { ServerStatus, Thresholds } from '@/types'

// Fallback while /api/thresholds hasn't loaded; the server resolves the
// real effective values (per-server -> global -> builtin)
export const DEFAULT_THRESHOLDS: Thresholds = { cpu: 80, memory: 85, disk: 90 }

// Below warnRatio*threshold = green, between = amber, over threshold = red
const WARN_RATIO = 0.8

export type MetricLevel = 'ok' | 'warning' | 'critical'

export function metricLevel(value: number, threshold: number): MetricLevel {
  if (value > threshold) return 'critical'
  if (value > threshold * WARN_RATIO) return 'warning'
  return 'ok'
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const value = bytes / Math.pow(1024, i)
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const mins = Math.floor((seconds % 3600) / 60)

  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

// "just now" / "5m ago" / "3h ago" / "2d ago" — for last-run badges
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const seconds = Math.floor((now.getTime() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

// Execution duration: "850ms" / "2.5s" / "1m 12s"
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const mins = Math.floor(ms / 60000)
  const secs = Math.round((ms % 60000) / 1000)
  return `${mins}m ${secs}s`
}

export function getStatusColor(server: ServerStatus | null, thresholds: Thresholds = DEFAULT_THRESHOLDS): string {
  if (!server?.online) return 'bg-red-600'
  const levels = [
    metricLevel(server.cpu_percent, thresholds.cpu),
    metricLevel(server.memory_percent, thresholds.memory),
    metricLevel(server.disk_percent, thresholds.disk),
  ]
  if (levels.includes('critical')) return 'bg-red-600'
  if (levels.includes('warning')) return 'bg-amber-500'
  return 'bg-green-500'
}
