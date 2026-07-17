// Minimal ANSI SGR parser: turns terminal color/style escape sequences
// into styled segments so script output (lynis, apt, docker…) renders
// with its real colors instead of leaking `[1;32m` garbage. Non-SGR
// CSI sequences (cursor movement, erase) are stripped.

export interface AnsiState {
  color?: string
  bgColor?: string
  bold?: boolean
  dim?: boolean
}

export interface AnsiSegment extends AnsiState {
  text: string
}

// Terminal palette tuned for the dashboard's dark background
const FG: Record<number, string> = {
  30: '#52525b', 31: '#f87171', 32: '#4ade80', 33: '#facc15',
  34: '#60a5fa', 35: '#c084fc', 36: '#22d3ee', 37: '#e4e4e7',
  90: '#71717a', 91: '#fca5a5', 92: '#86efac', 93: '#fde047',
  94: '#93c5fd', 95: '#d8b4fe', 96: '#67e8f9', 97: '#fafafa',
}
const BG: Record<number, string> = {
  40: '#18181b', 41: '#7f1d1d', 42: '#14532d', 43: '#713f12',
  44: '#1e3a8a', 45: '#581c87', 46: '#155e75', 47: '#d4d4d8',
  100: '#3f3f46', 101: '#991b1b', 102: '#166534', 103: '#854d0e',
  104: '#1e40af', 105: '#6b21a8', 106: '#0e7490', 107: '#e4e4e7',
}

function applySgr(state: AnsiState, params: string): AnsiState {
  const next = { ...state }
  const codes = params === '' ? [0] : params.split(';').map(n => parseInt(n, 10))
  for (const code of codes) {
    if (code === 0) { delete next.color; delete next.bgColor; next.bold = false; next.dim = false }
    else if (code === 1) next.bold = true
    else if (code === 2) next.dim = true
    else if (code === 22) { next.bold = false; next.dim = false }
    else if (code === 39) delete next.color
    else if (code === 49) delete next.bgColor
    else if (FG[code]) next.color = FG[code]
    else if (BG[code]) next.bgColor = BG[code]
    // 38/48 (256/truecolor) and unknown codes are ignored
  }
  return next
}

// Matches SGR (`ESC[…m`) and any other CSI sequence (stripped).
// Also tolerates a literal ␛ shown as  only.
const CSI = /\x1b\[([0-9;]*)([A-Za-z])/g

// Parse one chunk. `initialState` carries styles across streamed
// chunks (a color opened in one chunk continues in the next); the
// returned `endState` feeds the next call.
export function parseAnsi(input: string, initialState: AnsiState = {}): { segments: AnsiSegment[]; endState: AnsiState } {
  const segments: AnsiSegment[] = []
  let state = { ...initialState }
  let last = 0

  CSI.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = CSI.exec(input)) !== null) {
    if (m.index > last) {
      segments.push({ text: input.slice(last, m.index), ...state })
    }
    if (m[2] === 'm') state = applySgr(state, m[1])
    // other CSI finals (cursor moves, erases) are dropped
    last = CSI.lastIndex
  }
  if (last < input.length) {
    segments.push({ text: input.slice(last), ...state })
  }
  return { segments, endState: state }
}

export function stripAnsi(input: string): string {
  return input.replace(CSI, '')
}
