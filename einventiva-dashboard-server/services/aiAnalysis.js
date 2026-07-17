// AI analysis orchestration: sample → prompt → LLM → parsed findings +
// action plan → persisted record. The model recommends; it never
// executes anything. A3 adds: evolution memory (previous analysis fed
// back in), maintenance context (planned reboots aren't incidents),
// a consolidated action plan, and a per-run/persisted model override.

const db = require('../db');
const { log } = require('./logger');
const { buildSample } = require('./aiSample');
const { callLLM } = require('./aiProviders');
const {
  AI_PROVIDER, AI_BASE_URL, AI_API_KEY, AI_MODEL, AI_MAX_TOKENS, AI_TIMEOUT_MS, AI_KEEP_ANALYSES,
  AI_ANALYSIS_SCHEDULE, AI_OPEN_ALERTS,
} = require('../config');
const { isValidCron } = require('./scheduler');

const MODEL_SETTING_KEY = 'ai_model_override';

const SYSTEM_PROMPT = `You are a preventive SRE analyst for a small fleet of Linux servers running Docker workloads, monitored by a dashboard that collects the JSON snapshot you receive.

Analyze the snapshot looking for: resource trends that will become problems (disk filling, memory creep, swap growth), anomalies across signals (latency + load, restarts + memory), risks the rule-based alerts miss, recurring patterns in resolved alerts, failing scheduled scripts, PostgreSQL saturation or replication lag, and postponed maintenance (pending reboots, failed units).

Do NOT repeat every active alert back — the operator already sees them. Add value: correlate, prioritize, catch what rules can't.

IMPORTANT context handling:
- The snapshot includes "maintenanceWindows": servers that were recently rebooted on purpose (safe-reboot runs, or very low uptime). Do NOT report those reboots or their brief offline blips as critical incidents — treat them as planned maintenance and at most note them as informational.
- You also receive "previousAnalysis" (the summary and finding titles from the last run). Report EVOLUTION, not repetition: say if something got worse, improved, was resolved, or has persisted unaddressed since then. Do not just restate prior findings verbatim.
- Old failed script executions (exit 255) from before a timeout fix may appear; weight recurring/recent failures over stale one-offs.

Respond with ONLY a JSON object, no markdown fences, in this exact shape:
{
  "summary": "2-3 sentence executive summary in Spanish, mentioning evolution vs the previous analysis when relevant",
  "findings": [
    {
      "severity": "critical" | "warning" | "info",
      "server": "<server key or 'fleet'>",
      "title": "short title in Spanish",
      "detail": "what you observed and why it matters, in Spanish (2-3 sentences max)",
      "action": "concrete recommended action in Spanish",
      "script": "<script id from the dashboard if one clearly applies, else null>",
      "trend": "worse" | "improved" | "new" | "persisting" | null
    }
  ],
  "actionPlan": [
    {
      "horizon": "now" | "week" | "watch",
      "step": "concrete action in Spanish, imperative",
      "server": "<server key or 'fleet'>",
      "script": "<script id if one applies, else null>",
      "dependsOn": "<what to check/do first, in Spanish, or null>"
    }
  ]
}

The actionPlan is a prioritized, deduplicated to-do list derived from the findings: "now" = urgent today, "week" = this week, "watch" = just monitor. Order actionPlan by horizon (now first). Keep it short and actionable — one step per real action, with dependencies when a step should follow another.

Available script ids you may reference: SCRIPT_IDS.
Order findings by severity (critical first). If everything is healthy, return empty arrays and say so in the summary. Never invent data not present in the snapshot.`;

const VALID_SEVERITIES = new Set(['critical', 'warning', 'info']);
const VALID_TRENDS = new Set(['worse', 'improved', 'new', 'persisting']);
const VALID_HORIZONS = new Set(['now', 'week', 'watch']);

// Robust extraction: models sometimes wrap JSON in fences or prose
function parseAnalysis(text) {
  let raw = String(text || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) raw = fenced[1].trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('No JSON object in model response');
  const obj = JSON.parse(raw.slice(start, end + 1));

  const findings = (Array.isArray(obj.findings) ? obj.findings : [])
    .filter(f => f && typeof f.title === 'string')
    .map(f => ({
      severity: VALID_SEVERITIES.has(f.severity) ? f.severity : 'info',
      server: typeof f.server === 'string' ? f.server : 'fleet',
      title: f.title.slice(0, 200),
      detail: typeof f.detail === 'string' ? f.detail.slice(0, 1000) : '',
      action: typeof f.action === 'string' ? f.action.slice(0, 500) : '',
      script: typeof f.script === 'string' && f.script ? f.script : null,
      trend: VALID_TRENDS.has(f.trend) ? f.trend : null,
    }));
  const order = { critical: 0, warning: 1, info: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);

  const horizonOrder = { now: 0, week: 1, watch: 2 };
  const actionPlan = (Array.isArray(obj.actionPlan) ? obj.actionPlan : [])
    .filter(s => s && typeof s.step === 'string')
    .map(s => ({
      horizon: VALID_HORIZONS.has(s.horizon) ? s.horizon : 'watch',
      step: s.step.slice(0, 400),
      server: typeof s.server === 'string' ? s.server : 'fleet',
      script: typeof s.script === 'string' && s.script ? s.script : null,
      dependsOn: typeof s.dependsOn === 'string' && s.dependsOn ? s.dependsOn.slice(0, 300) : null,
    }))
    .sort((a, b) => horizonOrder[a.horizon] - horizonOrder[b.horizon]);

  return {
    summary: typeof obj.summary === 'string' ? obj.summary.slice(0, 1500) : '',
    findings,
    actionPlan,
  };
}

// Backwards-compatible alias (older callers/tests)
const parseFindings = parseAnalysis;

// Effective model: persisted override (settings) wins over env default
function resolveModel(override) {
  if (override && typeof override === 'string') return override;
  const saved = db.getSetting(MODEL_SETTING_KEY);
  return saved || AI_MODEL;
}

function isConfigured() {
  if (!AI_PROVIDER) return false;
  if (AI_PROVIDER === 'anthropic') return !!(AI_API_KEY && resolveModel());
  return !!(AI_BASE_URL && resolveModel());
}

function publicConfig() {
  const saved = db.getSetting(MODEL_SETTING_KEY);
  return {
    configured: isConfigured(),
    provider: AI_PROVIDER || null,
    model: resolveModel(),        // effective model
    defaultModel: AI_MODEL || null, // env default
    modelOverride: saved || null,   // persisted UI choice, if any
    schedule: AI_ANALYSIS_SCHEDULE && isValidCron(AI_ANALYSIS_SCHEDULE) ? AI_ANALYSIS_SCHEDULE : null,
    openAlerts: AI_OPEN_ALERTS,
    // never expose AI_API_KEY or full base URL (may embed credentials)
  };
}

// A stored row as clients consume it: findings/actionPlan parsed, sample optional
function toClientShape(row, { includeSample = false } = {}) {
  if (!row) return row;
  const safeParse = (s) => { try { return s ? JSON.parse(s) : null; } catch (_) { return null; } };
  const out = {
    id: row.id,
    timestamp: row.timestamp,
    provider: row.provider,
    model: row.model,
    summary: row.summary,
    findings: safeParse(row.findings),
    actionPlan: safeParse(row.action_plan),
    tokensIn: row.tokens_in,
    tokensOut: row.tokens_out,
    durationMs: row.duration_ms,
    error: row.error,
  };
  if (includeSample) out.sample = safeParse(row.sample);
  return out;
}

// Group warning/critical findings by server for the optional `ai`
// alert: { server: { severity, count, titles } }. Info findings never
// open alerts.
function groupFindingsForAlerts(findings) {
  const groups = {};
  for (const f of findings || []) {
    if (f.severity !== 'critical' && f.severity !== 'warning') continue;
    const key = f.server || 'fleet';
    if (!groups[key]) groups[key] = { severity: 'warning', count: 0, titles: [] };
    groups[key].count++;
    if (groups[key].titles.length < 3) groups[key].titles.push(f.title);
    if (f.severity === 'critical') groups[key].severity = 'critical';
  }
  return groups;
}

// Compact digest of the previous analysis for evolution memory
function previousAnalysisDigest() {
  const prev = db.getLastSuccessfulAnalysis();
  if (!prev) return null;
  let findings = [];
  try { findings = JSON.parse(prev.findings || '[]'); } catch (_) { /* ignore */ }
  return {
    at: prev.timestamp,
    summary: prev.summary,
    findingTitles: findings.map(f => `[${f.severity}] ${f.server}: ${f.title}`).slice(0, 12),
  };
}

let running = false;

async function runAnalysis(getServers, { model: modelOverride } = {}) {
  const model = resolveModel(modelOverride);
  if (!isConfigured()) throw new Error('AI module not configured (set AI_PROVIDER, AI_MODEL and AI_BASE_URL or AI_API_KEY)');
  if (running) throw new Error('An analysis is already running');
  running = true;
  const startedAt = Date.now();
  const timestamp = new Date(startedAt).toISOString();

  try {
    const sample = buildSample(getServers);
    // Feed the previous analysis back in for evolution reporting
    const previousAnalysis = previousAnalysisDigest();
    const userPayload = JSON.stringify({ ...sample, previousAnalysis });
    const sampleJson = JSON.stringify(sample); // persist the raw sample only
    const scriptIds = db.getScripts().map(s => s.id).join(', ');
    const system = SYSTEM_PROMPT.replace('SCRIPT_IDS', scriptIds || '(none)');

    let record;
    try {
      const { text, tokensIn, tokensOut } = await callLLM({
        provider: AI_PROVIDER, baseUrl: AI_BASE_URL, apiKey: AI_API_KEY,
        model, maxTokens: AI_MAX_TOKENS, timeoutMs: AI_TIMEOUT_MS,
        system, user: userPayload,
      });
      const { summary, findings, actionPlan } = parseAnalysis(text);
      record = db.insertAiAnalysis({
        timestamp, provider: AI_PROVIDER, model,
        sample: sampleJson, findings: JSON.stringify(findings), summary,
        actionPlan: JSON.stringify(actionPlan),
        tokensIn, tokensOut, durationMs: Date.now() - startedAt, error: null,
      });
      log('AI analysis done', { model, findings: findings.length, planSteps: actionPlan.length, tokensIn, tokensOut, durationMs: record.duration_ms });
    } catch (err) {
      record = db.insertAiAnalysis({
        timestamp, provider: AI_PROVIDER, model,
        sample: sampleJson, findings: null, summary: null, actionPlan: null,
        tokensIn: null, tokensOut: null, durationMs: Date.now() - startedAt,
        error: err.message.slice(0, 500),
      });
      log('AI analysis failed', { model, error: err.message });
    }

    db.pruneAiAnalyses(AI_KEEP_ANALYSES);
    return record;
  } finally {
    running = false;
  }
}

module.exports = {
  runAnalysis, parseAnalysis, parseFindings, isConfigured, publicConfig, toClientShape,
  groupFindingsForAlerts, resolveModel, previousAnalysisDigest,
  MODEL_SETTING_KEY, SYSTEM_PROMPT,
};
