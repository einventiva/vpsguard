import type {
  ServerStatus,
  DockerContainer,
  ScriptResult,
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

  async createScript(data: { id: string; name: string; description: string; command: string }): Promise<ScriptItem> {
    return fetchApi<ScriptItem>('/scripts', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  async updateScript(id: string, data: { name?: string; description?: string; command?: string }): Promise<ScriptItem> {
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

  async getScriptHistory(
    server: ServerAlias,
    limit: number = 10
  ): Promise<ScriptResult[]> {
    return []
  },

  // History endpoints
  async getHistory(server: ServerAlias, since?: string): Promise<HistoryResponse> {
    const params = since ? `?since=${encodeURIComponent(since)}` : ''
    return fetchApi<HistoryResponse>(`/history/${server}${params}`)
  },

  // Metric detail (drill-down)
  async getMetricDetail(server: ServerAlias, timestamp: string): Promise<MetricDetailResponse> {
    return fetchApi<MetricDetailResponse>(`/history/${server}/detail?ts=${encodeURIComponent(timestamp)}`)
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
