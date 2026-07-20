import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import type { AiAnalysis, AiActionStep, AiConfig, AiFinding, AiStepStatus, AiStepState, ServerInfo } from '@/types'
import { api } from '@/lib/api'
import { getSharedSocket, releaseSharedSocket } from '@/lib/socket'
import { formatRelativeTime, formatDuration } from '@/lib/formatters'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
  CalendarClock,
  ListChecks,
  Flame,
  Eye,
  TrendingUp,
  TrendingDown,
  ArrowRightCircle,
  RotateCcw,
  Check,
  X,
} from 'lucide-react'

// Where a script was launched from, so the interpretation can close that step's loop
export type ScriptOrigin = { analysisId: number; stepIndex: number }
export type OpenScript = (script: string, server: string, context?: string, origin?: ScriptOrigin) => void

interface PreventionPanelProps {
  servers: Record<string, ServerInfo>
  onOpenScript?: OpenScript
}

const TREND_STYLE: Record<NonNullable<AiFinding['trend']>, { label: string; icon: typeof TrendingUp; className: string }> = {
  worse: { label: 'empeoró', icon: TrendingUp, className: 'text-red-400 border-red-900/60 bg-red-900/20' },
  improved: { label: 'mejoró', icon: TrendingDown, className: 'text-green-400 border-green-900/50 bg-green-900/20' },
  new: { label: 'nuevo', icon: Sparkles, className: 'text-purple-300 border-purple-900/50 bg-purple-900/20' },
  persisting: { label: 'persiste', icon: ArrowRightCircle, className: 'text-amber-400 border-amber-900/50 bg-amber-900/20' },
}

const HORIZON_STYLE: Record<AiActionStep['horizon'], { label: string; icon: typeof Flame; className: string }> = {
  now: { label: 'Ahora', icon: Flame, className: 'text-red-400' },
  week: { label: 'Esta semana', icon: CalendarClock, className: 'text-amber-400' },
  watch: { label: 'Monitorear', icon: Eye, className: 'text-blue-400' },
}

const SEVERITY_STYLE: Record<AiFinding['severity'], { icon: typeof Info; color: string; badge: string }> = {
  critical: { icon: AlertCircle, color: 'text-red-500', badge: 'bg-red-900/40 text-red-300 border-red-800' },
  warning: { icon: AlertTriangle, color: 'text-amber-500', badge: 'bg-amber-900/30 text-amber-300 border-amber-800/60' },
  info: { icon: Info, color: 'text-blue-400', badge: 'bg-blue-900/30 text-blue-300 border-blue-800/60' },
}

function FindingRow({ finding, serverName, onOpenScript }: {
  finding: AiFinding
  serverName: string
  onOpenScript?: OpenScript
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
          {finding.trend && (() => {
            const t = TREND_STYLE[finding.trend]
            const TIcon = t.icon
            return (
              <span className={`flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded border ${t.className}`} title="Comparado con el análisis anterior">
                <TIcon className="w-2.5 h-2.5" /> {t.label}
              </span>
            )
          })()}
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
            onClick={() => onOpenScript(finding.script!, finding.server, `Este script se sugirió para el hallazgo "${finding.title}"${finding.action ? ` — acción recomendada: ${finding.action}` : ''}.`)}
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

const VERDICT_STYLE: Record<'yes' | 'no' | 'unclear', { label: string; className: string }> = {
  yes: { label: 'resuelto', className: 'text-green-400 border-green-900/50 bg-green-900/20' },
  no: { label: 'sigue pendiente', className: 'text-amber-400 border-amber-900/50 bg-amber-900/20' },
  unclear: { label: 'inconclusivo', className: 'text-zinc-400 border-zinc-700 bg-zinc-800/40' },
}

// Only an explicit outcome closes a step. `applied` means "the script ran but
// nothing confirmed it settled the concern", so it stays on the active list
// carrying the AI's take — you close it yourself, or the AI verifies it.
function isClosed(st?: AiStepStatus): boolean {
  return st?.status === 'verified' || st?.status === 'dismissed'
}

function StepRow({ step, index, status, analysisId, serverName, onOpenScript, onSetStatus, busy }: {
  step: AiActionStep
  index: number
  status?: AiStepStatus
  analysisId: number
  serverName: (key: string) => string
  onOpenScript?: OpenScript
  onSetStatus: (index: number, status: AiStepState) => void
  busy: boolean
}) {
  const closed = isClosed(status)
  const verdict = status?.verdict
  return (
    <li className="flex gap-2.5 text-sm group">
      <span className="text-zinc-600 font-mono text-xs mt-0.5 flex-shrink-0">{index + 1}.</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-2 flex-wrap">
          <span className={closed ? 'text-zinc-500 line-through' : 'text-zinc-200'}>{step.step}</span>
          {step.server && step.server !== 'fleet' && (
            <span className="text-[10px] font-mono text-zinc-500">[{serverName(step.server)}]</span>
          )}
          {status && status.status !== 'pending' && (
            <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-zinc-700 text-zinc-400 bg-zinc-800/40">
              {status.status === 'dismissed' ? 'descartado' : status.status === 'verified' ? 'verificado' : 'aplicado'}
            </span>
          )}
          {verdict && (
            <span
              className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${VERDICT_STYLE[verdict.resolved].className}`}
              title={verdict.summary}
            >
              <Sparkles className="w-2.5 h-2.5" /> IA: {VERDICT_STYLE[verdict.resolved].label}
            </span>
          )}
        </div>
        {step.dependsOn && !closed && (
          <p className="text-xs text-zinc-500 mt-0.5">↳ primero: {step.dependsOn}</p>
        )}
        {verdict && (
          <p className="text-xs text-zinc-400 mt-1 border-l-2 border-zinc-700 pl-2">{verdict.summary}</p>
        )}
        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
          {step.script && onOpenScript && !closed && (
            <button
              onClick={() => onOpenScript(
                step.script!,
                step.server,
                `Este script corresponde al paso del plan de acción: "${step.step}"${step.dependsOn ? ` (primero: ${step.dependsOn})` : ''}.`,
                { analysisId, stepIndex: index },
              )}
              className="flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border font-mono border-zinc-700 text-blue-400 hover:bg-blue-900/20 hover:border-blue-800 transition-colors"
              title={`Abrir ${step.script}`}
            >
              <Wrench className="w-3 h-3" /> {step.script}
            </button>
          )}
          {closed ? (
            <button
              onClick={() => onSetStatus(index, 'pending')}
              disabled={busy}
              className="flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700 transition-colors disabled:opacity-50"
            >
              <RotateCcw className="w-3 h-3" /> reabrir
            </button>
          ) : (
            <>
              <button
                onClick={() => onSetStatus(index, 'verified')}
                disabled={busy}
                className="flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border border-zinc-700 text-green-400 hover:bg-green-900/20 hover:border-green-800 transition-colors disabled:opacity-50"
                title="Ya lo hice y quedó resuelto (por ejemplo, a mano por SSH)"
              >
                <Check className="w-3 h-3" /> hecho
              </button>
              <button
                onClick={() => onSetStatus(index, 'dismissed')}
                disabled={busy}
                className="flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700 transition-colors disabled:opacity-50"
                title="No aplica / no lo voy a hacer"
              >
                <X className="w-3 h-3" /> descartar
              </button>
            </>
          )}
        </div>
      </div>
    </li>
  )
}

function ActionPlan({ steps, statuses, analysisId, serverName, onOpenScript, onSetStatus, busy }: {
  steps: AiActionStep[]
  statuses: Map<number, AiStepStatus>
  analysisId: number
  serverName: (key: string) => string
  onOpenScript?: OpenScript
  onSetStatus: (index: number, status: AiStepState) => void
  busy: boolean
}) {
  const [doneOpen, setDoneOpen] = useState(false)
  const horizons: AiActionStep['horizon'][] = ['now', 'week', 'watch']

  // Keep the original index — it is the key the step state is stored under
  const indexed = steps.map((step, index) => ({ step, index, status: statuses.get(index) }))
  const active = indexed.filter(s => !isClosed(s.status))
  const done = indexed.filter(s => isClosed(s.status))

  return (
    <Card className="border-zinc-700 bg-zinc-900/50 overflow-hidden">
      <div className="bg-zinc-900 border-b border-zinc-700 px-4 py-3 flex items-center gap-2">
        <ListChecks className="w-4 h-4 text-purple-400" />
        <span className="text-xs font-semibold text-zinc-300">
          Plan de acción — {active.length} pendiente{active.length === 1 ? '' : 's'}
          {done.length > 0 && <span className="text-zinc-500"> de {steps.length}</span>}
        </span>
      </div>
      <div className="p-4 space-y-4">
        {active.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-zinc-500 gap-2">
            <CheckCircle className="w-6 h-6 text-green-600" />
            <p className="text-sm">Plan completado — nada pendiente.</p>
          </div>
        ) : (
          horizons.map(h => {
            const group = active.filter(s => s.step.horizon === h)
            if (group.length === 0) return null
            const hs = HORIZON_STYLE[h]
            const HIcon = hs.icon
            return (
              <div key={h}>
                <div className={`flex items-center gap-1.5 mb-2 text-xs font-semibold uppercase tracking-wider ${hs.className}`}>
                  <HIcon className="w-3.5 h-3.5" /> {hs.label}
                </div>
                <ol className="space-y-2.5">
                  {group.map(({ step, index, status }) => (
                    <StepRow
                      key={index}
                      step={step}
                      index={index}
                      status={status}
                      analysisId={analysisId}
                      serverName={serverName}
                      onOpenScript={onOpenScript}
                      onSetStatus={onSetStatus}
                      busy={busy}
                    />
                  ))}
                </ol>
              </div>
            )
          })
        )}

        {done.length > 0 && (
          <div className="border-t border-zinc-800 pt-3">
            <button
              onClick={() => setDoneOpen(o => !o)}
              className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              {doneOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              Completado ({done.length})
            </button>
            {doneOpen && (
              <ol className="space-y-2.5 mt-2.5">
                {done.map(({ step, index, status }) => (
                  <StepRow
                    key={index}
                    step={step}
                    index={index}
                    status={status}
                    analysisId={analysisId}
                    serverName={serverName}
                    onOpenScript={onOpenScript}
                    onSetStatus={onSetStatus}
                    busy={busy}
                  />
                ))}
              </ol>
            )}
          </div>
        )}
      </div>
    </Card>
  )
}

export function PreventionPanel({ servers, onOpenScript }: PreventionPanelProps) {
  const [config, setConfig] = useState<AiConfig | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [savingModel, setSavingModel] = useState(false)
  const [analyses, setAnalyses] = useState<AiAnalysis[]>([])
  const [selected, setSelected] = useState<AiAnalysis | null>(null)
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [savingStep, setSavingStep] = useState(false)

  // Replace an analysis in both the list and the selection (they share ids)
  const replaceAnalysis = useCallback((updated: AiAnalysis) => {
    setAnalyses(prev => prev.map(a => (a.id === updated.id ? { ...a, ...updated } : a)))
    setSelected(prev => (prev && prev.id === updated.id ? { ...prev, ...updated } : prev))
  }, [])

  const handleSetStepStatus = useCallback(async (analysisId: number, stepIndex: number, status: AiStepState) => {
    setSavingStep(true)
    try {
      replaceAnalysis(await api.setAiStepStatus(analysisId, stepIndex, status))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo actualizar el paso')
    } finally {
      setSavingStep(false)
    }
  }, [replaceAnalysis])

  const refetch = useCallback(async () => {
    try {
      const [cfg, list] = await Promise.all([api.getAiConfig(), api.getAiAnalyses(20)])
      setConfig(cfg)
      setAnalyses(list)
      setSelected(prev => prev ?? list[0] ?? null)
      if (cfg.configured) {
        api.getAiModels().then(setModels).catch(() => { /* selector stays with current only */ })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load AI analyses')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refetch() }, [refetch])

  const handleModelChange = async (model: string) => {
    setSavingModel(true)
    try {
      const cfg = await api.setAiModel(model)
      setConfig(cfg)
      toast.success(`Modelo cambiado a ${model}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo cambiar el modelo')
    } finally {
      setSavingModel(false)
    }
  }

  // Scheduled analyses land via socket — prepend and notify
  useEffect(() => {
    const socket = getSharedSocket()
    const onAnalysis = (record: AiAnalysis) => {
      setAnalyses(prev => (prev.some(a => a.id === record.id) ? prev : [record, ...prev]))
      setSelected(prev => (prev && prev.id === record.id ? prev : record))
      const n = record.findings?.length ?? 0
      if (record.error) toast.error('Análisis IA falló', { description: record.error.slice(0, 120) })
      else if (n > 0) toast.info(`Análisis IA: ${n} hallazgo(s)`, { description: record.summary?.slice(0, 120) })
    }
    socket.on('ai:analysis', onAnalysis)
    return () => {
      socket.off('ai:analysis', onAnalysis)
      releaseSharedSocket()
    }
  }, [])

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
        <div className="flex items-center gap-2 text-sm text-zinc-400 flex-wrap">
          <Sparkles className="w-4 h-4 text-purple-400" />
          <span className="text-zinc-500">Analista:</span>
          {models.length > 1 ? (
            <Select value={config?.model || ''} onValueChange={handleModelChange} disabled={savingModel}>
              <SelectTrigger className="h-7 w-auto min-w-[150px] border-zinc-700 bg-zinc-900 text-zinc-200 font-mono text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-zinc-700 bg-zinc-900">
                {models.map(m => (
                  <SelectItem key={m} value={m} className="font-mono text-xs">{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="text-zinc-200 font-mono">{config?.model}</span>
          )}
          <span className="text-zinc-600">vía {config?.provider}</span>
          {config?.modelOverride && config?.defaultModel && config.modelOverride !== config.defaultModel && (
            <button
              onClick={() => handleModelChange('')}
              className="text-[10px] text-zinc-500 hover:text-zinc-300 underline"
              title={`Volver al default del backend (${config.defaultModel})`}
            >
              usar default
            </button>
          )}
          {config?.schedule ? (
            <span className="flex items-center gap-1 text-xs text-blue-400/90 bg-blue-900/20 border border-blue-900/50 px-2 py-0.5 rounded" title="Análisis programado (cron)">
              <CalendarClock className="w-3 h-3" />
              <span className="font-mono">{config.schedule}</span>
            </span>
          ) : (
            <span className="text-xs text-zinc-600">· solo manual (configura AI_ANALYSIS_SCHEDULE para programarlo)</span>
          )}
          {config?.openAlerts && (
            <span className="text-xs text-amber-400/80 border border-amber-900/50 bg-amber-900/20 px-2 py-0.5 rounded" title="Los hallazgos warning/critical abren alertas tipo ai">
              abre alertas
            </span>
          )}
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

          {/* Action plan */}
          {latest.actionPlan && latest.actionPlan.length > 0 && (
            <ActionPlan
              steps={latest.actionPlan}
              statuses={new Map((latest.stepStatuses ?? []).map(s => [s.stepIndex, s]))}
              analysisId={latest.id}
              serverName={serverName}
              onOpenScript={onOpenScript}
              onSetStatus={(index, status) => handleSetStepStatus(latest.id, index, status)}
              busy={savingStep}
            />
          )}

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
