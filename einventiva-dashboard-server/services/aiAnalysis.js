// AI analysis orchestration: sample → prompt → LLM → parsed findings →
// persisted record. The model recommends; it never executes anything.

const db = require('../db');
const { log } = require('./logger');
const { buildSample } = require('./aiSample');
const { callLLM } = require('./aiProviders');
const {
  AI_PROVIDER, AI_BASE_URL, AI_API_KEY, AI_MODEL, AI_MAX_TOKENS, AI_TIMEOUT_MS, AI_KEEP_ANALYSES,
} = require('../config');

const SYSTEM_PROMPT = `You are a preventive SRE analyst for a small fleet of Linux servers running Docker workloads, monitored by a dashboard that collects the JSON snapshot you receive.

Analyze the snapshot looking for: resource trends that will become problems (disk filling, memory creep, swap growth), anomalies across signals (latency + load, restarts + memory), risks the rule-based alerts miss, recurring patterns in resolved alerts, failing scheduled scripts, PostgreSQL saturation or replication lag, and postponed maintenance (pending reboots, failed units).

Do NOT repeat every active alert back — the operator already sees them. Add value: correlate, prioritize, catch what rules can't.

Respond with ONLY a JSON object, no markdown fences, in this exact shape:
{
  "summary": "2-3 sentence executive summary in Spanish",
  "findings": [
    {
      "severity": "critical" | "warning" | "info",
      "server": "<server key or 'fleet'>",
      "title": "short title in Spanish",
      "detail": "what you observed and why it matters, in Spanish (2-3 sentences max)",
      "action": "concrete recommended action in Spanish",
      "script": "<script id from the dashboard if one clearly applies, else null>"
    }
  ]
}

Available script ids you may reference: SCRIPT_IDS.
Order findings by severity (critical first). If everything is healthy, return an empty findings array and say so in the summary. Never invent data not present in the snapshot.`;

const VALID_SEVERITIES = new Set(['critical', 'warning', 'info']);

// Robust extraction: models sometimes wrap JSON in fences or prose
function parseFindings(text) {
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
    }));
  const order = { critical: 0, warning: 1, info: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);

  return {
    summary: typeof obj.summary === 'string' ? obj.summary.slice(0, 1500) : '',
    findings,
  };
}

function isConfigured() {
  if (!AI_PROVIDER) return false;
  if (AI_PROVIDER === 'anthropic') return !!(AI_API_KEY && AI_MODEL);
  return !!(AI_BASE_URL && AI_MODEL);
}

function publicConfig() {
  return {
    configured: isConfigured(),
    provider: AI_PROVIDER || null,
    model: AI_MODEL || null,
    // never expose AI_API_KEY or full base URL (may embed credentials)
  };
}

let running = false;

async function runAnalysis(getServers) {
  if (!isConfigured()) throw new Error('AI module not configured (set AI_PROVIDER, AI_MODEL and AI_BASE_URL or AI_API_KEY)');
  if (running) throw new Error('An analysis is already running');
  running = true;
  const startedAt = Date.now();
  const timestamp = new Date(startedAt).toISOString();

  try {
    const sample = buildSample(getServers);
    const sampleJson = JSON.stringify(sample);
    const scriptIds = db.getScripts().map(s => s.id).join(', ');
    const system = SYSTEM_PROMPT.replace('SCRIPT_IDS', scriptIds || '(none)');

    let record;
    try {
      const { text, tokensIn, tokensOut } = await callLLM({
        provider: AI_PROVIDER, baseUrl: AI_BASE_URL, apiKey: AI_API_KEY,
        model: AI_MODEL, maxTokens: AI_MAX_TOKENS, timeoutMs: AI_TIMEOUT_MS,
        system, user: sampleJson,
      });
      const { summary, findings } = parseFindings(text);
      record = db.insertAiAnalysis({
        timestamp, provider: AI_PROVIDER, model: AI_MODEL,
        sample: sampleJson, findings: JSON.stringify(findings), summary,
        tokensIn, tokensOut, durationMs: Date.now() - startedAt, error: null,
      });
      log('AI analysis done', { findings: findings.length, tokensIn, tokensOut, durationMs: record.duration_ms });
    } catch (err) {
      record = db.insertAiAnalysis({
        timestamp, provider: AI_PROVIDER, model: AI_MODEL,
        sample: sampleJson, findings: null, summary: null,
        tokensIn: null, tokensOut: null, durationMs: Date.now() - startedAt,
        error: err.message.slice(0, 500),
      });
      log('AI analysis failed', { error: err.message });
    }

    db.pruneAiAnalyses(AI_KEEP_ANALYSES);
    return record;
  } finally {
    running = false;
  }
}

module.exports = { runAnalysis, parseFindings, isConfigured, publicConfig, SYSTEM_PROMPT };
