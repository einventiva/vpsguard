import { describe, it, expect } from 'vitest'
import { formatUptime, getStatusColor, formatRelativeTime, formatDuration } from '../formatters'
import type { ServerStatus } from '@/types'

describe('formatUptime', () => {
  it('formats days and hours', () => {
    expect(formatUptime(5 * 86400 + 3 * 3600)).toBe('5d 3h')
  })

  it('formats hours and minutes', () => {
    expect(formatUptime(2 * 3600 + 15 * 60)).toBe('2h 15m')
  })

  it('formats minutes only', () => {
    expect(formatUptime(45 * 60)).toBe('45m')
  })

  it('formats 0 seconds', () => {
    expect(formatUptime(0)).toBe('0m')
  })

  it('days take priority over showing minutes', () => {
    expect(formatUptime(2 * 86400 + 0 * 3600 + 30 * 60)).toBe('2d 0h')
  })
})

describe('formatRelativeTime', () => {
  const now = new Date('2026-07-16T12:00:00Z')

  it('says just now under a minute', () => {
    expect(formatRelativeTime('2026-07-16T11:59:30Z', now)).toBe('just now')
  })

  it('formats minutes', () => {
    expect(formatRelativeTime('2026-07-16T11:55:00Z', now)).toBe('5m ago')
  })

  it('formats hours', () => {
    expect(formatRelativeTime('2026-07-16T09:00:00Z', now)).toBe('3h ago')
  })

  it('formats days', () => {
    expect(formatRelativeTime('2026-07-14T12:00:00Z', now)).toBe('2d ago')
  })
})

describe('formatDuration', () => {
  it('formats sub-second durations in ms', () => {
    expect(formatDuration(850)).toBe('850ms')
  })

  it('formats seconds with one decimal', () => {
    expect(formatDuration(2500)).toBe('2.5s')
  })

  it('formats minutes and seconds', () => {
    expect(formatDuration(72000)).toBe('1m 12s')
  })
})

describe('getStatusColor', () => {
  const makeServer = (overrides: Partial<ServerStatus> = {}): ServerStatus => ({
    hostname: 'test',
    ip: '1.2.3.4',
    online: true,
    cpu_percent: 20,
    cpu_cores: 4,
    memory_percent: 30,
    memory_used: 2000,
    memory_total: 8000,
    disk_percent: 40,
    disk_used: 20 * 1024 * 1024 * 1024,
    disk_total: 50 * 1024 * 1024 * 1024,
    uptime_seconds: 86400,
    load_avg: [0.5, 0.3, 0.2],
    container_count: 3,
    swap_percent: 0,
    inodes_percent: 10,
    failed_units: [],
    reboot_required: false,
    ssh_latency_ms: 100,
    ...overrides,
  })

  it('returns red for offline server', () => {
    expect(getStatusColor(makeServer({ online: false }))).toBe('bg-red-600')
  })

  it('returns red for null server', () => {
    expect(getStatusColor(null)).toBe('bg-red-600')
  })

  it('returns green for healthy server', () => {
    expect(getStatusColor(makeServer())).toBe('bg-green-500')
  })

  it('returns amber for moderate CPU', () => {
    expect(getStatusColor(makeServer({ cpu_percent: 65 }))).toBe('bg-amber-500')
  })

  it('returns red for high CPU', () => {
    expect(getStatusColor(makeServer({ cpu_percent: 85 }))).toBe('bg-red-600')
  })

  it('returns amber for moderate memory', () => {
    expect(getStatusColor(makeServer({ memory_percent: 75 }))).toBe('bg-amber-500')
  })

  it('returns red for high memory', () => {
    expect(getStatusColor(makeServer({ memory_percent: 90 }))).toBe('bg-red-600')
  })

  // Boundary tests — warning starts above 80% of the threshold (cpu: 64),
  // critical above the threshold itself; both use > not >=
  it('returns green at exactly cpu=64 (warning boundary)', () => {
    expect(getStatusColor(makeServer({ cpu_percent: 64 }))).toBe('bg-green-500')
  })

  it('returns amber at cpu=65 (just above warning boundary)', () => {
    expect(getStatusColor(makeServer({ cpu_percent: 65 }))).toBe('bg-amber-500')
  })

  it('returns amber at exactly cpu=80 (boundary)', () => {
    expect(getStatusColor(makeServer({ cpu_percent: 80 }))).toBe('bg-amber-500')
  })

  it('returns red at cpu=81 (just above boundary)', () => {
    expect(getStatusColor(makeServer({ cpu_percent: 81 }))).toBe('bg-red-600')
  })

  it('returns green at exactly memory=68 (warning boundary, 80% of 85)', () => {
    expect(getStatusColor(makeServer({ memory_percent: 68 }))).toBe('bg-green-500')
  })

  it('returns amber at memory=69 (just above warning boundary)', () => {
    expect(getStatusColor(makeServer({ memory_percent: 69 }))).toBe('bg-amber-500')
  })

  it('uses custom thresholds when provided', () => {
    const custom = { cpu: 50, memory: 85, disk: 90 }
    expect(getStatusColor(makeServer({ cpu_percent: 55 }), custom)).toBe('bg-red-600')
    expect(getStatusColor(makeServer({ cpu_percent: 45 }), custom)).toBe('bg-amber-500')
    expect(getStatusColor(makeServer({ cpu_percent: 30 }), custom)).toBe('bg-green-500')
  })

  it('returns amber at exactly memory=85 (boundary)', () => {
    expect(getStatusColor(makeServer({ memory_percent: 85 }))).toBe('bg-amber-500')
  })

  it('returns red at memory=86 (just above boundary)', () => {
    expect(getStatusColor(makeServer({ memory_percent: 86 }))).toBe('bg-red-600')
  })
})
