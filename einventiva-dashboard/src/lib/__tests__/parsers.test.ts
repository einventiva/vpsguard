import { describe, it, expect } from 'vitest'
import { parseUptimeRaw, parseLoadAvg, parseDiskPercent, parseDiskSize, transformServerStatus } from '../parsers'

describe('parseUptimeRaw', () => {
  it('parses days + hours:minutes', () => {
    expect(parseUptimeRaw('up 5 days, 3:42')).toBe(5 * 86400 + 3 * 3600 + 42 * 60)
  })

  it('parses single day', () => {
    expect(parseUptimeRaw('up 1 day, 0:05')).toBe(86400 + 5 * 60)
  })

  it('parses hours:minutes without days', () => {
    expect(parseUptimeRaw('up 2:30')).toBe(2 * 3600 + 30 * 60)
  })

  it('parses minutes only', () => {
    expect(parseUptimeRaw('up 45 min')).toBe(45 * 60)
  })

  it('returns 0 for empty string', () => {
    expect(parseUptimeRaw('')).toBe(0)
  })

  it('returns 0 for unrecognized format', () => {
    expect(parseUptimeRaw('something else')).toBe(0)
  })
})

describe('parseLoadAvg', () => {
  it('parses standard load average line', () => {
    expect(parseLoadAvg('load average: 0.15, 0.30, 0.45')).toEqual([0.15, 0.30, 0.45])
  })

  it('parses full uptime output', () => {
    expect(parseLoadAvg('10:30:01 up 5 days,  3:42,  2 users,  load average: 1.20, 0.80, 0.60'))
      .toEqual([1.20, 0.80, 0.60])
  })

  it('returns empty array for empty string', () => {
    expect(parseLoadAvg('')).toEqual([])
  })

  it('returns empty array for no match', () => {
    expect(parseLoadAvg('no load here')).toEqual([])
  })
})

describe('parseDiskPercent', () => {
  it('parses "45%"', () => {
    expect(parseDiskPercent('45%')).toBe(45)
  })

  it('parses "100%"', () => {
    expect(parseDiskPercent('100%')).toBe(100)
  })

  it('returns 0 for empty', () => {
    expect(parseDiskPercent('')).toBe(0)
  })

  it('returns 0 for non-numeric', () => {
    expect(parseDiskPercent('abc')).toBe(0)
  })
})

describe('parseDiskSize', () => {
  it('parses gigabytes', () => {
    expect(parseDiskSize('50G')).toBe(50 * 1024 * 1024 * 1024)
  })

  it('parses megabytes', () => {
    expect(parseDiskSize('512M')).toBe(512 * 1024 * 1024)
  })

  it('parses terabytes', () => {
    expect(parseDiskSize('2T')).toBe(2 * 1024 * 1024 * 1024 * 1024)
  })

  it('parses kilobytes', () => {
    expect(parseDiskSize('100K')).toBe(100 * 1024)
  })

  it('parses decimal values', () => {
    expect(parseDiskSize('1.5G')).toBe(Math.floor(1.5 * 1024 * 1024 * 1024))
  })

  it('returns 0 for empty', () => {
    expect(parseDiskSize('')).toBe(0)
  })

  it('falls back to parseInt for plain numbers', () => {
    expect(parseDiskSize('1024')).toBe(1024)
  })
})

describe('transformServerStatus', () => {
  it('transforms connected server data', () => {
    const data = {
      name: 'Production',
      alias: 'prod',
      status: 'connected',
      metrics: {
        cpu: { raw: '%Cpu(s):  5.3 us,  2.1 sy,  0.0 ni, 92.0 id,  0.6 wa' },
        memory: { total: 8000, used: 4000 },
        disk: { percentUsed: '50%', used: '25G', size: '50G' },
        uptime: { raw: 'up 10 days, 5:30' },
        docker: [{ Name: 'nginx' }, { Name: 'redis' }],
        cpuCores: 4,
      },
    }

    const result = transformServerStatus(data, 'prod')

    expect(result.hostname).toBe('Production')
    expect(result.online).toBe(true)
    expect(result.cpu_percent).toBeCloseTo(8, 0)
    expect(result.cpu_cores).toBe(4)
    expect(result.memory_percent).toBe(50)
    expect(result.memory_used).toBe(4000)
    expect(result.memory_total).toBe(8000)
    expect(result.disk_percent).toBe(50)
    expect(result.container_count).toBe(2)
    expect(result.uptime_seconds).toBe(10 * 86400 + 5 * 3600 + 30 * 60)
  })

  it('handles error/disconnected server', () => {
    const data = { status: 'error', metrics: {} }
    const result = transformServerStatus(data, 'down')

    expect(result.online).toBe(false)
    expect(result.cpu_percent).toBe(0)
    expect(result.memory_percent).toBe(0)
    expect(result.container_count).toBe(0)
  })

  it('handles missing metrics gracefully', () => {
    const data = { name: 'Test', status: 'connected' }
    const result = transformServerStatus(data, 'test')

    expect(result.hostname).toBe('Test')
    expect(result.online).toBe(true)
    expect(result.cpu_percent).toBe(0)
  })

  it('falls back hostname to alias when name is missing', () => {
    const data = { status: 'connected', metrics: {} }
    const result = transformServerStatus(data, 'my-alias')
    expect(result.hostname).toBe('my-alias')
  })

  it('sets ip from serverData.alias', () => {
    const data = { alias: 'ssh-alias', status: 'connected', metrics: {} }
    const result = transformServerStatus(data, 'key')
    expect(result.ip).toBe('ssh-alias')
  })

  it('handles memory_percent 0 when total is 0', () => {
    const data = {
      status: 'connected',
      metrics: { memory: { total: 0, used: 0 } },
    }
    const result = transformServerStatus(data, 'test')
    expect(result.memory_percent).toBe(0)
  })

  it('handles docker not being an array', () => {
    const data = {
      status: 'connected',
      metrics: { docker: 'not-an-array' },
    }
    const result = transformServerStatus(data, 'test')
    expect(result.container_count).toBe(0)
  })

  it('handles cpu.raw with no id match', () => {
    const data = {
      status: 'connected',
      metrics: { cpu: { raw: 'garbled cpu output' } },
    }
    const result = transformServerStatus(data, 'test')
    expect(result.cpu_percent).toBe(0)
  })
})
