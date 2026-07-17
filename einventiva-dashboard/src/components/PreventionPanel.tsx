import { useState, useEffect, useCallback } from 'react'
import type { AiAnalysis, AiConfig, AiFinding, ServerInfo } from '@/types'
import { api } from '@/lib/api'
import { formatRelativeTime, formatDuration } from '@/lib/formatters'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Sparkles,
  AlertCircle,
  AlertTriangle,
  Info,
  Loader,
  Wrench,
  ChevronRight,
  ChevronDown,
  CheckCircle,
} from 'lucide-react'

interface PreventionPanelProps {
  servers: Record<string, ServerInfo>
  onOpenScript?: (script: string, server: string) => void
}

const SEVERITY_STYLE: Record<AiFinding['severity'], { icon: typeof Info; color: string; badge: string }> = {
  critical: { icon: AlertCircle, color: 'text-red-500', badge: 'bg-red-900/40 text-red-300 border-red-800' },
  warning: { icon: AlertTriangle, color: 'text-amber-500', badge: 'bg-amber-900/30 text-amber-300 border-amber-800/60' },
  info: { icon: Info, color: 'text-blue-400', badge: 'bg-blue-900/30 text-blue-300 border-blue-800/60' },
}

function FindingRow({ finding, serverName, onOpenScript }: {
  finding: AiFinding
  serverName: string
  onOpenScript?: (script: string, server: string) => void
}) {
  const style = SEVERITY_STYLE[finding.severity]
  const Icon = style.icon
  return (
    <div className="flex gap-3 px-4 py-3 border-b border-zinc-800/70 last:border-b-0">
      <Icon className={`w-4 h-4 flex-shrink-0 mt-0.5 ${style.color}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-zinc-200">{finding.title}</span>
          <Badge variant="outline" className={`border text-[10px] ${style.badge}`}>{finding.severity}</Badge>
          <Badge variant="outline" className="border-zinc-700 text-zinc-400 font-mono text-[10px]">{serverName}</Badge>
        </div>
        {finding.detail && <p className="text-xs text-zinc-400 mt-1">{finding.detail}</p>}
        {finding.action && (
          <p className="text-xs text-zinc-300 mt-1.5">
            <span className="text-zinc-500 uppercase tracking-wider text-[10px] font-semibold mr-1.5">Acción</span>
            {finding.action}
          </p>
        )}
        {finding.script && onOpenScript && (
          <button
            onClick={() => onOpenScript(finding.script!, finding.server)}
            className="flex items-center gap-1 mt-2 text-[11px] px-1.5 py-0.5 rounded border font-mono border-zinc-700 text-blue-400 hover:bg-blue-900/20 hover:border-blue-800 transition-colors"
            title={`Abrir ${finding.script} apuntando a ${serverName}`}
          >
            <Wrench className="w-3 h-3" />
            {finding.script}
          </button>
        )}
      </div>
    </div>
  )
}

export function PreventionPanel({ servers, onOpenScript }: PreventionPanelProps) {
  const [config, setConfig] = useState<AiConfig | null>(null)
  const [analyses, setAnalyses] = useState<AiAnalysis[]>([])
  const [selected, setSelected] = useState<AiAnalysis | null>(null)
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)

  const refetch = useCallback(async () => {
    try {
      const [cfg, list] = await Promise.all([api.getAiConfig(), api.getAiAnalyses(20)])
      setConfig(cfg)
      setAnalyses(list)
      setSelected(prev => prev ?? list[0] ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load AI analyses')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refetch() }, [refetch])

  const handleAnalyze = async () => {
    setAnalyzing(true)
    setError(null)
    try {
      const record = await api.runAiAnalysis()
      setAnalyses(prev => [record, ...prev])
      setSelected(record)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed')
    } finally {
      setAnalyzing(false)
    }
  }

  const serverName = (key: string) => servers[key]?.displayName || key

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40 text-zinc-500 text-sm gap-2">
        <Loader className="w-4 h-4 animate-spin" /> Cargando análisis...
      </div>
    )
  }

  if (config && !config.configured) {
    return (
      <Card className="border-zinc-700 bg-zinc-900/50 p-8 max-w-2xl">
        <div className="flex items-center gap-2 mb-4">
          <Sparkles className="w-5 h-5 text-purple-400" />
          <h3 className="text-sm font-semibold text-zinc-200">Análisis con IA — sin configurar</h3>
        </div>
        <p className="text-sm text-zinc-400 mb-4">
          Configura un proveedor LLM en el <code className="text-zinc-300">.env</code> del backend y reinícialo.
          Funciona con cualquier endpoint OpenAI-compatible (LiteLLM, OpenAI, xAI/Grok, Ollama local) o con la API nativa de Anthropic.
        </p>
        <pre className="bg-black rounded border border-zinc-800 p-4 text-xs font-mono text-green-400 whitespace-pre-wrap">
{`# OpenAI-compatible (LiteLLM / Ollama / OpenAI / xAI ...)
AI_PROVIDER=openai
AI_BASE_URL=http://localhost:4000/v1
AI_API_KEY=sk-...
AI_MODEL=gpt-4o-mini

# ... o Anthropic nativo
AI_PROVIDER=anthropic
AI_API_KEY=sk-ant-...
AI_MODEL=claude-sonnet-5`}
        </pre>
        <p className="text-xs text-zinc-500 mt-3">
          Los secretos nunca pasan por la UI. La muestra que se envía al modelo es un resumen pre-agregado
          (estado, alertas, tendencias, proyecciones) — sin outputs crudos de scripts.
        </p>
      </Card>
    )
  }

  const latest = selected
  const findingCount = latest?.findings?.length ?? 0

  return (
    <div className="space-y-4">
      {/* Header: model + analyze button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-zinc-400">
          <Sparkles className="w-4 h-4 text-purple-400" />
          <span>
            Analista: <span className="text-zinc-200 font-mono">{config?.model}</span>
            <span className="text-zinc-600"> vía {config?.provider}</span>
          </span>
        </div>
        <Button
          onClick={handleAnalyze}
          disabled={analyzing}
          className="bg-purple-700 hover:bg-purple-600 text-white"
        >
          {analyzing ? (
            <><Loader className="w-4 h-4 mr-2 animate-spin" /> Analizando (puede tardar ~30s)...</>
          ) : (
            <><Sparkles className="w-4 h-4 mr-2" /> Analizar ahora</>
          )}
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-900/20 border border-red-800 rounded text-red-200 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {!latest ? (
        <Card className="border-zinc-700 bg-zinc-900/50 p-10 text-center text-zinc-500 text-sm">
          Aún no hay análisis. Ejecuta el primero con "Analizar ahora".
        </Card>
      ) : latest.error ? (
        <Card className="border-red-900/60 bg-zinc-900/50 p-5">
          <p className="text-sm text-red-300 font-semibold mb-1">El análisis de {formatRelativeTime(latest.timestamp)} falló</p>
          <p className="text-xs text-zinc-400 font-mono">{latest.error}</p>
        </Card>
      ) : (
        <>
          {/* Summary */}
          <Card className="border-zinc-700 bg-zinc-900/50 p-5">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Resumen ejecutivo</h3>
              <span className="text-xs text-zinc-500" title={new Date(latest.timestamp).toLocaleString()}>
                {formatRelativeTime(latest.timestamp)}
                {latest.durationMs != null && ` · ${formatDuration(latest.durationMs)}`}
                {latest.tokensIn != null && ` · ${latest.tokensIn}+${latest.tokensOut ?? 0} tokens`}
              </span>
            </div>
            <p className="text-sm text-zinc-200">{latest.summary || '(sin resumen)'}</p>
          </Card>

          {/* Findings */}
          <Card className="border-zinc-700 bg-zinc-900/50 overflow-hidden">
            <div className="bg-zinc-900 border-b border-zinc-700 px-4 py-3 flex items-center gap-2">
              <span className="text-xs font-semibold text-zinc-300">Hallazgos ({findingCount})</span>
            </div>
            {findingCount === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-zinc-500 gap-2">
                <CheckCircle className="w-6 h-6 text-green-600" />
                <p className="text-sm">Sin hallazgos — la flota se ve sana.</p>
              </div>
            ) : (
              latest.findings!.map((f, i) => (
                <FindingRow key={i} finding={f} serverName={serverName(f.server)} onOpenScript={onOpenScript} />
              ))
            )}
          </Card>
        </>
      )}

      {/* History */}
      {analyses.length > 1 && (
        <Card className="border-zinc-700 bg-zinc-900/50 overflow-hidden">
          <button
            className="w-full bg-zinc-900 border-b border-zinc-700 px-4 py-3 flex items-center gap-2 text-left hover:bg-zinc-800/70 transition-colors"
            onClick={() => setHistoryOpen(o => !o)}
          >
            {historyOpen ? <ChevronDown className="w-3.5 h-3.5 text-zinc-500" /> : <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />}
            <span className="text-xs font-semibold text-zinc-300">Historial ({analyses.length})</span>
          </button>
          {historyOpen && analyses.map(a => (
            <button
              key={a.id}
              onClick={() => setSelected(a)}
              className={`w-full px-4 py-2.5 flex items-center gap-3 text-left border-b border-zinc-800/60 last:border-b-0 hover:bg-zinc-800/50 transition-colors ${selected?.id === a.id ? 'bg-zinc-800/40' : ''}`}
            >
              {a.error
                ? <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
                : (a.findings?.some(f => f.severity === 'critical')
                  ? <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                  : a.findings?.length
                    ? <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                    : <CheckCircle className="w-3.5 h-3.5 text-green-600 flex-shrink-0" />)}
              <span className="text-xs text-zinc-300 flex-1 truncate">
                {a.error ? 'Error' : `${a.findings?.length ?? 0} hallazgo(s)`}
                {a.summary && <span className="text-zinc-500"> — {a.summary.slice(0, 80)}</span>}
              </span>
              <span className="text-xs text-zinc-500 flex-shrink-0" title={new Date(a.timestamp).toLocaleString()}>
                {formatRelativeTime(a.timestamp)}
              </span>
            </button>
          ))}
        </Card>
      )}

      <p className="text-xs text-zinc-600">
        La IA recomienda, tú ejecutas: los hallazgos nunca disparan scripts automáticamente.
        La muestra enviada al modelo es un resumen pre-agregado sin outputs crudos.
      </p>
    </div>
  )
}
