import type { ServerStatus, ServerAlias } from '@/types'

export function parseUptimeRaw(raw: string): number {
  if (!raw) return 0
  let seconds = 0
  const daysMatch = raw.match(/up\s+(\d+)\s+days?/)
  if (daysMatch) seconds += parseInt(daysMatch[1]) * 86400
  const hoursMinMatch = raw.match(/up\s+(?:\d+\s+days?,\s*)?(\d+):(\d+)/)
  if (hoursMinMatch) {
    seconds += parseInt(hoursMinMatch[1]) * 3600
    seconds += parseInt(hoursMinMatch[2]) * 60
  }
  const minMatch = raw.match(/up\s+(\d+)\s+min/)
  if (minMatch) seconds += parseInt(minMatch[1]) * 60
  return seconds
}

export function parseLoadAvg(raw: string): number[] {
  if (!raw) return []
  const match = raw.match(/load average:\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)/)
  if (!match) return []
  return [parseFloat(match[1]), parseFloat(match[2]), parseFloat(match[3])]
}

export function parseDiskPercent(percentStr: string): number {
  if (!percentStr) return 0
  const match = percentStr.match(/(\d+)/)
  return match ? parseInt(match[1], 10) : 0
}

export function parseDiskSize(sizeStr: string): number {
  if (!sizeStr) return 0
  const units: { [key: string]: number } = {
    'K': 1024,
    'M': 1024 * 1024,
    'G': 1024 * 1024 * 1024,
    'T': 1024 * 1024 * 1024 * 1024,
  }
  const match = sizeStr.match(/^([\d.]+)([KMGT])/)
  if (!match) return parseInt(sizeStr) || 0
  return Math.floor(parseFloat(match[1]) * units[match[2]])
}

export function transformServerStatus(serverData: any, alias: ServerAlias): ServerStatus {
  const metrics = serverData.metrics || {}
  const cpu = metrics.cpu || {}
  const memory = metrics.memory || {}
  const disk = metrics.disk || {}
  const uptime = metrics.uptime || {}
  const docker = metrics.docker || []

  let cpuPercent = 0
  if (cpu.raw) {
    const idleMatch = cpu.raw.match(/([\d.]+)\s*id/)
    if (idleMatch) cpuPercent = 100 - parseFloat(idleMatch[1])
  }

  return {
    hostname: serverData.name || alias,
    ip: serverData.alias || '',
    online: serverData.status === 'connected',
    cpu_percent: cpuPercent,
    cpu_cores: metrics.cpuCores || 0,
    memory_percent: memory.total ? ((memory.used / memory.total) * 100) : 0,
    memory_used: memory.used || 0,
    memory_total: memory.total || 0,
    disk_percent: parseDiskPercent(disk.percentUsed),
    disk_used: parseDiskSize(disk.used),
    disk_total: parseDiskSize(disk.size),
    uptime_seconds: parseUptimeRaw(uptime.raw),
    load_avg: parseLoadAvg(uptime.raw),
    container_count: Array.isArray(docker) ? docker.length : 0,
  }
}
