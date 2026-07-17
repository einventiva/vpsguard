import type {
  Alert,
  ThresholdOverride,
  ThresholdsResponse,
  HistoryRange,
  ProjectionsResponse,
  PgHistoryRange,
  PgHistoryResponse,
  ServerStatus,
  DockerContainer,
  ScriptResult,
  ScriptExecution,
  AiAnalysis,
  AiConfig,
  ServerData,
  ServerAlias,
  ApiResponse,
  CrontabEntry,
  MetricDetailResponse,
  HistoryResponse,
  ScriptItem,
  ServerInfo,
  PgBasicResponse,
  PgDetailedResponse,
} from '@/types'
import { API_BASE, API_TOKEN } from './config'
import { transformServerStatus } from './parsers'

class ApiError extends Error {
  status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function fetchApi<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      headers: {
        'Content-Type': 'application/json',
        ...(API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {}),
        ...options?.headers,
      },
      ...options,
    })

    if (!response.ok) {
      throw new ApiError(
        `API Error: ${response.statusText}`,
        response.status
      )
    }

    const data = await response.json()
    return data as T
  } catch (error) {
    if (error instanceof ApiError) {
      throw error
    }
    throw new ApiError(
      error instanceof Error ? error.message : 'Unknown API error'
    )
  }
}

/**
 * Parse Docker JSON output into DockerContainer objects
 */
function parseDockerContainer(dockerData: any): DockerContainer {
  return {
    id: dockerData.ID || dockerData.id || '',
    name: dockerData.Names ? dockerData.Names.replace(/^\//, '') : dockerData.name || '',
    image: dockerData.Image || '',
    status: normalizeStatus(dockerData.State || 'unknown'),
    ports: dockerData.Ports ? dockerData.Ports.split(', ').filter((p: string) => p) : [],
    created: dockerData.RunningFor || formatDate(dockerData.CreatedAt || ''),
    uptime: dockerData.RunningFor || 'N/A',
    cpu: dockerData.CPUPerc || '',
    memUsage: dockerData.MemUsage || '',
    memPerc: dockerData.MemPerc || '',
    blockIO: dockerData.BlockIO || '',
    netIO: dockerData.NetIO || '',
    restartCount: dockerData.RestartCount ?? 0,
    oomKilled: dockerData.OOMKilled ?? false,
  }
}

/**
 * Normalize docker state to our status enum
 */
function normalizeStatus(state: string): DockerContainer['status'] {
  const lower = state.toLowerCase()
  if (lower.includes('running')) return 'running'
  if (lower.includes('exited')) return 'exited'
  if (lower.includes('paused')) return 'paused'
  if (lower.includes('unhealthy')) return 'unhealthy'
  return 'exited'
}

/**
 * Format date for display
 */
function formatDate(dateString: string): string {
  try {
    const date = new Date(dateString)
    return date.toLocaleString()
  } catch {
    return dateString
  }
}

export const api = {
  // Server status endpoints
  async getServerStatus(server: ServerAlias): Promise<ServerStatus> {
    const data = await fetchApi<any>('/status')
    if (!data[server]) {
      throw new ApiError(`Server '${server}' not found`)
    }
    return transformServerStatus(data[server], server)
  },

  async getAllServerStatus(): Promise<ServerData> {
    const data = await fetchApi<any>('/status')
    const result: ServerData = {}
    for (const [key, value] of Object.entries(data)) {
      result[key] = transformServerStatus(value, key)
    }
    return result
  },

  async getServers(): Promise<Record<string, { displayName: string; user: string; ip: string; port: number; alias: string }>> {
    return fetchApi<any>('/servers')
  },

  // Docker endpoints
  async getContainers(server: ServerAlias): Promise<DockerContainer[]> {
    const response = await fetchApi<any>(`/docker/${server}`)
    const containers = response.containers || []
    return containers.map((c: any) => parseDockerContainer(c))
  },

  async getContainerLogs(
    server: ServerAlias,
    containerId: string,
    lines: number = 100
  ): Promise<string> {
    const response = await fetchApi<any>(`/docker/${server}/${containerId}/logs`)
    return response.logs ? response.logs.join('\n') : ''
  },

  // Script endpoints
  async getAvailableScripts(): Promise<ScriptResult[]> {
    const response = await fetchApi<any>('/scripts')
    const items: ScriptItem[] = response.items || []
    return items.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      command: s.command,
      destructive: !!s.destructive,
      schedule: s.schedule || null,
      scheduleServers: s.schedule_servers || '*',
      alertTypes: (s.alert_types || '').split(',').map(t => t.trim()).filter(Boolean),
      output: '',
      status: 'idle' as const,
      timestamp: new Date().toISOString(),
      server: 'prod' as ServerAlias,
    }))
  },

  async getScriptItems(): Promise<ScriptItem[]> {
    const response = await fetchApi<any>('/scripts')
    return response.items || []
  },

  async createScript(data: { id: string; name: string; description: string; command: string; destructive?: boolean; schedule?: string | null; scheduleServers?: string; alertTypes?: string }): Promise<ScriptItem> {
    return fetchApi<ScriptItem>('/scripts', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  async updateScript(id: string, data: { name?: string; description?: string; command?: string; destructive?: boolean; schedule?: string | null; scheduleServers?: string; alertTypes?: string }): Promise<ScriptItem> {
    return fetchApi<ScriptItem>(`/scripts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  },

  async deleteScript(id: string): Promise<void> {
    await fetchApi<any>(`/scripts/${id}`, {
      method: 'DELETE',
    })
  },

  async runScript(
    server: ServerAlias,
    scriptId: string,
    password?: string
  ): Promise<ApiResponse<ScriptResult>> {
    try {
      const body: Record<string, string> = { script: scriptId }
      if (password) body.password = password
      const response = await fetchApi<any>(`/execute/${server}`, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      return {
        success: response.success,
        data: {
          id: scriptId,
          name: scriptId,
          description: '',
          command: scriptId,
          destructive: false,
          schedule: null,
          scheduleServers: '*',
          alertTypes: [],
          output: response.output || '',
          status: response.success ? 'success' : 'error',
          timestamp: response.timestamp || new Date().toISOString(),
          server: server,
        },
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to execute script',
      }
    }
  },

  // Persisted execution history (list rows omit output)
  async getScriptHistory(
    server: ServerAlias,
    limit: number = 20
  ): Promise<ScriptExecution[]> {
    const response = await fetchApi<any>(`/executions?server=${server}&limit=${limit}`)
    return response.executions || []
  },

  // Full execution record including stored output
  async getExecution(id: number): Promise<ScriptExecution> {
    return fetchApi<ScriptExecution>(`/executions/${id}`)
  },

  // Latest execution per script — powers the last-run badges
  async getLatestExecutions(server: ServerAlias): Promise<Record<string, ScriptExecution>> {
    const response = await fetchApi<any>(`/executions/latest?server=${server}`)
    const map: Record<string, ScriptExecution> = {}
    for (const e of response.executions || []) map[e.script_id] = e
    return map
  },

  // AI analysis module
  async getAiConfig(): Promise<AiConfig> {
    return fetchApi<AiConfig>('/ai/config')
  },

  async getAiModels(): Promise<string[]> {
    const response = await fetchApi<any>('/ai/models')
    return response.models || []
  },

  // Persist the model choice (null clears back to the env default)
  async setAiModel(model: string | null): Promise<AiConfig> {
    return fetchApi<AiConfig>('/ai/model', { method: 'PUT', body: JSON.stringify({ model }) })
  },

  // Optional `model` runs this analysis with a one-off model
  async runAiAnalysis(model?: string): Promise<AiAnalysis> {
    return fetchApi<AiAnalysis>('/ai/analyze', {
      method: 'POST',
      body: JSON.stringify(model ? { model } : {}),
    })
  },

  async getAiAnalyses(limit: number = 20): Promise<AiAnalysis[]> {
    const response = await fetchApi<any>(`/ai/analyses?limit=${limit}`)
    return response.analyses || []
  },

  async getAiAnalysis(id: number): Promise<AiAnalysis> {
    return fetchApi<AiAnalysis>(`/ai/analyses/${id}`)
  },

  // History endpoints
  async getHistory(server: ServerAlias, opts?: { since?: string; range?: HistoryRange }): Promise<HistoryResponse> {
    const params = new URLSearchParams()
    if (opts?.range) params.set('range', opts.range)
    else if (opts?.since) params.set('since', opts.since)
    const qs = params.toString()
    return fetchApi<HistoryResponse>(`/history/${server}${qs ? `?${qs}` : ''}`)
  },

  // Metric detail (drill-down). `windowSeconds` finds the nearest
  // detail when the chart point is a bucketed/rolled-up average.
  async getMetricDetail(server: ServerAlias, timestamp: string, windowSeconds?: number): Promise<MetricDetailResponse> {
    const params = new URLSearchParams({ ts: timestamp })
    if (windowSeconds) params.set('window', String(windowSeconds))
    return fetchApi<MetricDetailResponse>(`/history/${server}/detail?${params}`)
  },

  // PostgreSQL time series (5-min sampler)
  async getPgHistory(server: ServerAlias, container: string, range: PgHistoryRange = '24h'): Promise<PgHistoryResponse> {
    const params = new URLSearchParams({ container, range })
    return fetchApi<PgHistoryResponse>(`/postgres/${server}/history?${params}`)
  },

  // Projections (disk-full ETA, memory slope)
  async getProjections(): Promise<ProjectionsResponse> {
    return fetchApi<ProjectionsResponse>('/projections')
  },

  // Alert endpoints
  async getAlerts(activeOnly = false, limit = 100): Promise<{ alerts: Alert[]; count: number }> {
    const params = new URLSearchParams()
    if (activeOnly) params.set('active', '1')
    params.set('limit', String(limit))
    return fetchApi<{ alerts: Alert[]; count: number }>(`/alerts?${params}`)
  },

  async ackAlert(id: number): Promise<Alert> {
    return fetchApi<Alert>(`/alerts/${id}/ack`, { method: 'POST' })
  },

  // Threshold endpoints
  async getThresholds(): Promise<ThresholdsResponse> {
    return fetchApi<ThresholdsResponse>('/thresholds')
  },

  async setGlobalThresholds(values: ThresholdOverride): Promise<ThresholdOverride> {
    return fetchApi<ThresholdOverride>('/thresholds/global', {
      method: 'PUT',
      body: JSON.stringify(values),
    })
  },

  async setServerThresholds(server: string, values: ThresholdOverride): Promise<ThresholdOverride> {
    return fetchApi<ThresholdOverride>(`/thresholds/${server}`, {
      method: 'PUT',
      body: JSON.stringify(values),
    })
  },

  // Crontab endpoints
  async getCrontab(server: ServerAlias): Promise<CrontabEntry[]> {
    const response = await fetchApi<any>(`/crontab/${server}`)
    return response.entries || []
  },

  async addCrontabEntry(
    server: ServerAlias,
    entry: Omit<CrontabEntry, 'index' | 'enabled' | 'raw'>
  ): Promise<CrontabEntry> {
    const response = await fetchApi<any>(`/crontab/${server}`, {
      method: 'POST',
      body: JSON.stringify(entry),
    })
    return response.entry
  },

  async updateCrontabEntry(
    server: ServerAlias,
    index: number,
    entry: Partial<Omit<CrontabEntry, 'index' | 'enabled' | 'raw'>>
  ): Promise<CrontabEntry> {
    const response = await fetchApi<any>(`/crontab/${server}/${index}`, {
      method: 'PUT',
      body: JSON.stringify(entry),
    })
    return response.entry
  },

  async deleteCrontabEntry(server: ServerAlias, index: number): Promise<void> {
    await fetchApi<any>(`/crontab/${server}/${index}`, {
      method: 'DELETE',
    })
  },

  async toggleCrontabEntry(server: ServerAlias, index: number): Promise<CrontabEntry> {
    const response = await fetchApi<any>(`/crontab/${server}/${index}/toggle`, {
      method: 'PATCH',
    })
    return response.entry
  },

  // Server CRUD
  async createServer(data: { key: string; displayName: string; alias: string; ip?: string; port?: number; user?: string }): Promise<any> {
    return fetchApi<any>('/servers', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  async updateServer(key: string, data: { displayName?: string; alias?: string; ip?: string; port?: number; user?: string }): Promise<any> {
    return fetchApi<any>(`/servers/${key}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  },

  async deleteServer(key: string): Promise<void> {
    await fetchApi<any>(`/servers/${key}`, {
      method: 'DELETE',
    })
  },

  async testServerConnection(key: string): Promise<{ success: boolean; output?: string; error?: string }> {
    return fetchApi<any>(`/servers/${key}/test`, {
      method: 'POST',
    })
  },

  // PostgreSQL endpoints
  async getPostgresBasic(server: ServerAlias): Promise<PgBasicResponse> {
    return fetchApi<PgBasicResponse>(`/postgres/${server}`)
  },

  async getPostgresDetailed(server: ServerAlias, container: string, db?: string): Promise<PgDetailedResponse> {
    const params = new URLSearchParams({ container })
    if (db) params.set('db', db)
    return fetchApi<PgDetailedResponse>(`/postgres/${server}/detailed?${params}`)
  },

  // Health check
  async healthCheck(): Promise<ApiResponse<{ status: string }>> {
    try {
      const result = await fetchApi<any>('/health')
      return {
        success: true,
        data: { status: result.status },
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Health check failed',
      }
    }
  },
}

export { ApiError }
