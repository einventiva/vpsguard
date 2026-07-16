import { useState, useEffect } from 'react'
import type { ServerInfo, ThresholdOverride } from '@/types'
import type { UseThresholdsReturn } from '@/hooks/useThresholds'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Settings2, Loader } from 'lucide-react'

interface ThresholdsEditorProps {
  thresholdsApi: UseThresholdsReturn
  servers: Record<string, ServerInfo>
}

const METRICS = ['cpu', 'memory', 'disk'] as const

type Draft = Record<string, { cpu: string; memory: string; disk: string }>

function overrideToDraft(o: ThresholdOverride | undefined) {
  return {
    cpu: o?.cpu != null ? String(o.cpu) : '',
    memory: o?.memory != null ? String(o.memory) : '',
    disk: o?.disk != null ? String(o.disk) : '',
  }
}

function draftToOverride(d: { cpu: string; memory: string; disk: string }): ThresholdOverride {
  return {
    cpu: d.cpu === '' ? null : Number(d.cpu),
    memory: d.memory === '' ? null : Number(d.memory),
    disk: d.disk === '' ? null : Number(d.disk),
  }
}

export function ThresholdsEditor({ thresholdsApi, servers }: ThresholdsEditorProps) {
  const { data, loading, saveGlobal, saveServer } = thresholdsApi
  const [draft, setDraft] = useState<Draft>({})
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    if (!data) return
    const next: Draft = { global: overrideToDraft(data.global) }
    for (const key of Object.keys(servers)) {
      next[key] = overrideToDraft(data.overrides[key])
    }
    setDraft(next)
  }, [data, servers])

  if (loading || !data) {
    return (
      <Card className="border-zinc-700 bg-zinc-900/50 p-4">
        <div className="flex items-center gap-2 text-zinc-500 text-sm">
          <Loader className="w-4 h-4 animate-spin" /> Loading thresholds...
        </div>
      </Card>
    )
  }

  const setValue = (row: string, metric: string, value: string) => {
    if (value !== '' && !/^\d{0,3}(\.\d{0,1})?$/.test(value)) return
    setDraft(prev => ({ ...prev, [row]: { ...prev[row], [metric]: value } }))
  }

  const save = async (row: string) => {
    setSaving(row)
    try {
      const values = draftToOverride(draft[row])
      if (row === 'global') await saveGlobal(values)
      else await saveServer(row, values)
    } finally {
      setSaving(null)
    }
  }

  const rows: Array<{ key: string; label: string; placeholderFrom: 'builtin' | 'cascade' }> = [
    { key: 'global', label: 'Global (all servers)', placeholderFrom: 'builtin' },
    ...Object.keys(servers).map(key => ({
      key,
      label: servers[key]?.displayName || key,
      placeholderFrom: 'cascade' as const,
    })),
  ]

  return (
    <Card className="border-zinc-700 bg-zinc-900/50 p-4">
      <div className="flex items-center gap-2 mb-1">
        <Settings2 className="w-4 h-4 text-zinc-400" />
        <h4 className="text-sm font-semibold text-zinc-300">Alert Thresholds (%)</h4>
      </div>
      <p className="text-xs text-zinc-500 mb-4">
        Empty fields inherit: server → global → defaults (CPU {data.builtin.cpu} / MEM {data.builtin.memory} / DISK {data.builtin.disk}). Changes apply on the next sample, no restart needed.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-zinc-500 border-b border-zinc-800">
              <th className="text-left py-2 pr-4 font-medium">Scope</th>
              {METRICS.map(m => (
                <th key={m} className="text-left py-2 pr-4 font-medium uppercase">{m}</th>
              ))}
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ key, label }) => {
              const rowDraft = draft[key] ?? { cpu: '', memory: '', disk: '' }
              const effective = key === 'global' ? data.builtin : data.effective[key]
              return (
                <tr key={key} className="border-b border-zinc-800/60 last:border-b-0">
                  <td className="py-2 pr-4 text-zinc-300">{label}</td>
                  {METRICS.map(m => (
                    <td key={m} className="py-2 pr-4">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={rowDraft[m]}
                        onChange={e => setValue(key, m, e.target.value)}
                        placeholder={effective ? String(effective[m]) : ''}
                        className="w-16 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-xs font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
                      />
                    </td>
                  ))}
                  <td className="py-2 text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => save(key)}
                      disabled={saving === key}
                      className="h-7 px-3 border-zinc-700 text-zinc-300 hover:bg-zinc-800 text-xs"
                    >
                      {saving === key ? <Loader className="w-3 h-3 animate-spin" /> : 'Save'}
                    </Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
