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
  swap_percent: number
  inodes_percent: number
  failed_units: string[]
  reboot_required: boolean
  ssh_latency_ms: number | null
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
  restartCount: number
  oomKilled: boolean
}

export interface ScriptResult {
  id: string
  name: string
  description: string
  command: string
  destructive: boolean
  // 5-field cron expression; null = manual only
  schedule: string | null
  // '*' = every server, or comma-separated server keys
  scheduleServers: string
  // Alert types this script helps diagnose/remediate (suggestion buttons)
  alertTypes: string[]
  output: string
  status: 'idle' | 'running' | 'success' | 'error'
  timestamp: string
  server: ServerAlias
}

// Persisted execution record. Lists omit `output` (fetch per-id);
// output_bytes signals whether there is anything to expand.
export interface ScriptExecution {
  id: number
  script_id: string
  server: string
  exit_code: number | null
  started_at: string
  duration_ms: number
  triggered_by?: 'manual' | 'schedule'
  output_bytes: number | null
  output?: string | null
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
  id: number
  server: string
  type: 'cpu' | 'memory' | 'disk' | 'offline' | 'disk-eta' | 'cron' | 'pg-connections' | 'pg-replication' | 'inodes' | 'systemd' | 'ssl' | 'flapping' | 'script' | 'ai' | 'service'
  severity: 'warning' | 'critical'
  message: string
  value: number | null
  threshold: number | null
  started_at: string
  resolved_at: string | null
  acknowledged_at: string | null
}

// ─── Service checks ──────────────────────────────────────────────────

export type ServiceCheckKind = 'http' | 'tcp' | 'command' | 'container'

// Kinds that probe something local to a host; they cannot run from the
// dashboard, and the editor hides the dashboard option for them.
export const SERVER_ONLY_KINDS: ServiceCheckKind[] = ['command', 'container']

export interface ServiceCheckConfig {
  method?: string
  expectStatus?: string
  expectBody?: string
  jsonPath?: string
  jsonEquals?: string
  // Values keep their ${VAR} form — they are resolved from the backend's
  // environment at request time, so no secret is ever stored or sent here
  headers?: Record<string, string>
  followRedirects?: boolean
  runtime?: 'docker' | 'systemd'
}

export interface ServiceCheckResult {
  ok: boolean
  latencyMs: number | null
  statusCode: number | null
  error: string | null
  timestamp?: string
}

export interface ServiceCheck {
  id: string
  name: string
  kind: ServiceCheckKind
  target: string
  run_from: string
  config: ServiceCheckConfig
  interval_sec: number
  timeout_ms: number
  failures_to_open: number
  successes_to_resolve: number
  severity: 'warning' | 'critical'
  enabled: boolean
  created_at: string
  updated_at: string
  // null means the check has never run — unknown, not down
  lastResult: ServiceCheckResult | null
  uptime24hPct: number | null
  avgLatencyMs24h: number | null
}

// Raw DB row as returned by the history endpoint
export interface ServiceCheckHistoryRow {
  id: number
  check_id: string
  timestamp: string
  ok: number
  latency_ms: number | null
  status_code: number | null
  error: string | null
}

export interface ServiceCheckInput {
  id?: string
  name: string
  kind: ServiceCheckKind
  target: string
  runFrom: string
  config: ServiceCheckConfig
  intervalSec: number
  timeoutMs: number
  failuresToOpen: number
  successesToResolve: number
  severity: 'warning' | 'critical'
  enabled: boolean
}

export interface Thresholds {
  cpu: number
  memory: number
  disk: number
}

// Override values: null = inherit from the next level up
export interface ThresholdOverride {
  cpu: number | null
  memory: number | null
  disk: number | null
}

export interface ThresholdsResponse {
  builtin: Thresholds
  global: ThresholdOverride
  overrides: Record<string, ThresholdOverride>
  effective: Record<string, Thresholds>
}

export type HistoryRange = '1h' | '6h' | '24h' | '7d' | '30d' | '90d' | '1y'

export interface HistoryResponse {
  server: string
  count: number
  entries: MetricEntry[]
  range?: HistoryRange
  granularity?: string
  bucketSeconds?: number
}

export interface DiskProjection {
  current: number | null
  slopePerDay: number | null
  etaDays: number | null
  insufficient: boolean
}

export interface MemoryProjection {
  slopePerHour: number | null
  r2: number | null
  trendingUp: boolean
  insufficient: boolean
}

export interface ServerProjection {
  disk: DiskProjection
  memory: MemoryProjection
}

export interface ProjectionsResponse {
  timestamp: string
  servers: Record<string, ServerProjection>
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
  source?: 'user' | 'system'
  user?: string
  file?: string
  // Execution watch (from syslog): null lastRun = never seen in logs
  lastRun?: string | null
  intervalMs?: number | null
  overdue?: boolean
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

// PostgreSQL types
export interface PgDatabase {
  name: string
  sizeBytes: number
  activeConnections: number
}

export interface PgContainer {
  id: string
  name: string
  image: string
  status: string
  version: string
  databases: PgDatabase[]
  error: string | null
}

export interface PgBasicResponse {
  server: string
  timestamp: string
  containers: PgContainer[]
}

export interface PgCacheHit {
  datname: string
  blks_hit: number
  blks_read: number
  cache_hit_ratio: number
}

export interface PgTable {
  table: string
  total_size: number
  live_rows: number
  dead_rows: number
  last_vacuum: string | null
  last_autovacuum: string | null
}

export interface PgActiveQuery {
  pid: number
  datname: string
  usename: string
  state: string
  query: string
  duration: number
}

export interface PgLock {
  locktype: string
  mode: string
  granted: boolean
  pid: number
  relation: string
}

export interface PgReplication {
  client_addr: string
  state: string
  sent_lsn: string
  write_lsn: string
  replay_lsn: string
  sync_state: string
}

export type PgHistoryRange = '24h' | '7d' | '30d'

export interface PgHistoryEntry {
  timestamp: string
  connections: number | null
  max_connections: number | null
  size_bytes: number | null
  cache_hit_ratio: number | null
  replication_lag_bytes: number | null
}

export interface PgHistoryResponse {
  server: string
  container: string
  range: PgHistoryRange
  count: number
  entries: PgHistoryEntry[]
}

export interface PgDetailedResponse {
  server: string
  container: string
  db: string
  timestamp: string
  cacheHit: PgCacheHit[]
  tables: PgTable[]
  activeQueries: PgActiveQuery[]
  locks: PgLock[]
  replication: PgReplication[]
}

// ─── AI analysis module ────────────────────────────────────────────
export interface AiFinding {
  severity: 'critical' | 'warning' | 'info'
  server: string
  title: string
  detail: string
  action: string
  script: string | null
  trend?: 'worse' | 'improved' | 'new' | 'persisting' | null
}

export interface AiActionStep {
  horizon: 'now' | 'week' | 'watch'
  step: string
  server: string
  script: string | null
  dependsOn: string | null
}

export type AiStepState = 'pending' | 'applied' | 'verified' | 'dismissed'

// Lifecycle attached to one action-plan step (by its index in actionPlan)
export interface AiStepStatus {
  stepIndex: number
  status: AiStepState
  executionId: number | null
  verdict: {
    summary: string
    severity: AiInterpretation['severity']
    resolved: 'yes' | 'no' | 'unclear'
    at: string
  } | null
  note: string | null
  updatedAt: string
}

export interface AiAnalysis {
  id: number
  timestamp: string
  provider: string | null
  model: string | null
  summary: string | null
  findings: AiFinding[] | null
  actionPlan?: AiActionStep[] | null
  stepStatuses?: AiStepStatus[]
  tokensIn: number | null
  tokensOut: number | null
  durationMs: number | null
  error: string | null
  sample?: unknown
}

export interface AiInterpretation {
  summary: string
  severity: 'ok' | 'info' | 'warning' | 'critical'
  points: string[]
  action: string
  // Whether the output settles the concern that motivated running the script
  resolved?: 'yes' | 'no' | 'unclear'
  model?: string
  tokensIn?: number | null
  tokensOut?: number | null
}

export interface AiConfig {
  configured: boolean
  provider: string | null
  model: string | null
  defaultModel?: string | null
  modelOverride?: string | null
  schedule: string | null
  openAlerts: boolean
}

export interface ScriptItem {
  id: string
  name: string
  description: string
  command: string
  destructive: number
  schedule: string | null
  schedule_servers: string
  alert_types: string
  created_at: string
  updated_at: string
}
