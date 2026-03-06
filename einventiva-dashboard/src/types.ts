export type ServerAlias = string

export interface ServerStatus {
  hostname: string
  ip: string
  online: boolean
  cpu_percent: number
  cpu_cores: number
  memory_percent: number
  memory_used: number
  memory_total: number
  disk_percent: number
  disk_used: number
  disk_total: number
  uptime_seconds: number
  load_avg: number[]
  container_count: number
}

export interface DockerContainer {
  id: string
  name: string
  image: string
  status: 'running' | 'exited' | 'paused' | 'unhealthy'
  ports: string[]
  created: string
  uptime: string
  cpu: string
  memUsage: string
  memPerc: string
  blockIO: string
  netIO: string
}

export interface ScriptResult {
  id: string
  name: string
  description: string
  command: string
  output: string
  status: 'idle' | 'running' | 'success' | 'error'
  timestamp: string
  server: ServerAlias
}

export interface LogEntry {
  timestamp: string
  level: 'info' | 'warning' | 'error'
  message: string
}

export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

export interface ServerData {
  [key: string]: ServerStatus
}

export interface ServerInfo {
  displayName: string
  user: string
  ip: string
  port: number
  alias: string
}

export interface MetricEntry {
  timestamp: string
  cpu: number
  memory: number
  disk: number
  online: boolean
}

export interface Alert {
  server: string
  type: 'cpu' | 'memory' | 'disk' | 'offline'
  severity: 'warning' | 'critical'
  message: string
  value?: number
  threshold?: number
  timestamp: string
}

export interface HistoryResponse {
  server: string
  count: number
  entries: MetricEntry[]
}

export interface CrontabEntry {
  index: number
  minute: string
  hour: string
  dayOfMonth: string
  month: string
  dayOfWeek: string
  command: string
  enabled: boolean
  raw: string
}

export interface MetricDetailEntry {
  type: 'process' | 'container'
  name: string
  cpu: number
  memory: number
  extra: Record<string, any> | null
}

export interface MetricDetailResponse {
  server: string
  timestamp: string
  processes: MetricDetailEntry[]
  containers: MetricDetailEntry[]
}

export interface ScriptItem {
  id: string
  name: string
  description: string
  command: string
  created_at: string
  updated_at: string
}
