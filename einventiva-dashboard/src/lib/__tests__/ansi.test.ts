import { describe, it, expect } from 'vitest'
import { parseAnsi, stripAnsi } from '../ansi'

const ESC = '\x1b'

describe('parseAnsi', () => {
  it('passes plain text through as one unstyled segment', () => {
    const { segments } = parseAnsi('hello world')
    expect(segments).toEqual([{ text: 'hello world' }])
  })

  it('parses color + bold and reset (lynis-style output)', () => {
    const { segments } = parseAnsi(`ok [${ESC}[1;32mV${ESC}[0m]`)
    expect(segments).toHaveLength(3)
    expect(segments[0]).toEqual({ text: 'ok [' })
    expect(segments[1]).toMatchObject({ text: 'V', bold: true, color: '#4ade80' })
    expect(segments[2]).toMatchObject({ text: ']', bold: false })
    expect(segments[2].color).toBeUndefined()
  })

  it('supports background colors (lynis [TIP] banner)', () => {
    const { segments } = parseAnsi(`${ESC}[0;44m[TIP]${ESC}[0m rest`)
    expect(segments[0]).toMatchObject({ text: '[TIP]', bgColor: '#1e3a8a' })
    expect(segments[1].bgColor).toBeUndefined()
  })

  it('carries style state across chunk boundaries', () => {
    const first = parseAnsi(`${ESC}[31mred starts`)
    expect(first.endState.color).toBe('#f87171')
    const second = parseAnsi('still red', first.endState)
    expect(second.segments[0]).toMatchObject({ text: 'still red', color: '#f87171' })
  })

  it('strips non-SGR CSI sequences (cursor movement)', () => {
    const { segments } = parseAnsi(`a${ESC}[2Kb${ESC}[1Ac`)
    expect(segments.map(s => s.text).join('')).toBe('abc')
  })

  it('treats empty SGR as reset', () => {
    const { segments } = parseAnsi(`${ESC}[31mred${ESC}[mplain`)
    expect(segments[1].color).toBeUndefined()
  })

  it('ignores unknown codes without breaking', () => {
    const { segments } = parseAnsi(`${ESC}[38;5;208mx${ESC}[0m`)
    expect(segments[0].text).toBe('x')
  })
})

describe('stripAnsi', () => {
  it('removes all escape sequences', () => {
    expect(stripAnsi(`${ESC}[1;32mV${ESC}[0m plain ${ESC}[2K`)).toBe('V plain ')
  })
})
