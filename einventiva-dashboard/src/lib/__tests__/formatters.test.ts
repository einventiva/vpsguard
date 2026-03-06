import { describe, it, expect } from 'vitest'
import { formatUptime, getStatusColor } from '../formatters'
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

  // Boundary tests — thresholds use > not >=
  it('returns green at exactly cpu=60 (boundary)', () => {
    expect(getStatusColor(makeServer({ cpu_percent: 60 }))).toBe('bg-green-500')
  })

  it('returns amber at cpu=61 (just above boundary)', () => {
    expect(getStatusColor(makeServer({ cpu_percent: 61 }))).toBe('bg-amber-500')
  })

  it('returns amber at exactly cpu=80 (boundary)', () => {
    expect(getStatusColor(makeServer({ cpu_percent: 80 }))).toBe('bg-amber-500')
  })

  it('returns red at cpu=81 (just above boundary)', () => {
    expect(getStatusColor(makeServer({ cpu_percent: 81 }))).toBe('bg-red-600')
  })

  it('returns green at exactly memory=70 (boundary)', () => {
    expect(getStatusColor(makeServer({ memory_percent: 70 }))).toBe('bg-green-500')
  })

  it('returns amber at memory=71 (just above boundary)', () => {
    expect(getStatusColor(makeServer({ memory_percent: 71 }))).toBe('bg-amber-500')
  })

  it('returns amber at exactly memory=85 (boundary)', () => {
    expect(getStatusColor(makeServer({ memory_percent: 85 }))).toBe('bg-amber-500')
  })

  it('returns red at memory=86 (just above boundary)', () => {
    expect(getStatusColor(makeServer({ memory_percent: 86 }))).toBe('bg-red-600')
  })
})
