const express = require('express');
const db = require('../db');
const { handleError } = require('../services/logger');
const { runAnalysis, publicConfig, toClientShape, interpretOutput, MODEL_SETTING_KEY } = require('../services/aiAnalysis');
const { afterAiAnalysis } = require('../services/backgroundJobs');
const { listModels } = require('../services/aiProviders');
const { AI_PROVIDER, AI_BASE_URL, AI_API_KEY, AI_TIMEOUT_MS } = require('../config');

// Anthropic has no discovery endpoint; offer a small static list
const ANTHROPIC_MODELS = ['claude-sonnet-5', 'claude-opus-4-8', 'claude-haiku-4-5-20251001'];

function createRouter(getServers, io) {
  const router = express.Router();

  router.get('/ai/config', (req, res) => {
    res.json(publicConfig());
  });

  // Available models to choose from (LiteLLM virtual key returns only
  // its allowed groups). Cached briefly so the selector is snappy.
  let modelsCache = { at: 0, models: [] };
  router.get('/ai/models', async (req, res) => {
    try {
      if (AI_PROVIDER === 'anthropic') return res.json({ models: ANTHROPIC_MODELS });
      if (!AI_BASE_URL) return res.json({ models: [] });
      if (Date.now() - modelsCache.at < 60000) return res.json({ models: modelsCache.models });
      const models = await listModels({ baseUrl: AI_BASE_URL, apiKey: AI_API_KEY, timeoutMs: AI_TIMEOUT_MS });
      modelsCache = { at: Date.now(), models };
      res.json({ models });
    } catch (error) {
      handleError(res, error, 'Failed to list AI models');
    }
  });

  // Persist the UI's model choice (empty/null clears back to env default)
  router.put('/ai/model', (req, res) => {
    const { model } = req.body || {};
    if (model !== null && model !== undefined && typeof model !== 'string') {
      return res.status(400).json({ error: 'model must be a string or null' });
    }
    db.setSetting(MODEL_SETTING_KEY, model || null);
    res.json(publicConfig());
  });

  // Manual "Analizar ahora". Rate limited: one run per minute.
  let lastRunAt = 0;
  router.post('/ai/analyze', async (req, res) => {
    try {
      if (Date.now() - lastRunAt < 60000) {
        return res.status(429).json({ error: 'Analysis rate limited — wait a minute between runs' });
      }
      lastRunAt = Date.now();
      // Optional one-off model for this run (doesn't change the default)
      const model = typeof req.body?.model === 'string' && req.body.model ? req.body.model : undefined;
      const record = await runAnalysis(getServers, { model });
      afterAiAnalysis(io, record, getServers);
      res.json(toClientShape(record));
    } catch (error) {
      if (/not configured/.test(error.message)) {
        return res.status(400).json({ error: error.message });
      }
      if (/already running/.test(error.message)) {
        return res.status(409).json({ error: error.message });
      }
      handleError(res, error, 'AI analysis failed');
    }
  });

  // Interpret a script's output into an actionable verdict. Accepts an
  // execution id (server-side output, no client round-trip) or inline
  // { script, server, output }.
  let lastInterpretAt = 0;
  router.post('/ai/interpret', async (req, res) => {
    try {
      if (Date.now() - lastInterpretAt < 5000) {
        return res.status(429).json({ error: 'Rate limited — wait a few seconds between interpretations' });
      }
      let { script, server, output, context, executionId, analysisId, stepIndex } = req.body || {};
      if (executionId != null) {
        const exec = db.getExecution(parseInt(executionId));
        if (!exec) return res.status(404).json({ error: `Execution '${executionId}' not found` });
        script = script || exec.script_id;
        server = server || exec.server;
        output = exec.output;
      }
      if (!output || !String(output).trim()) {
        return res.status(400).json({ error: 'No output to interpret' });
      }
      lastInterpretAt = Date.now();
      const result = await interpretOutput({ script, server, output, context });

      // Came from an action-plan step? Attach the verdict and close the loop.
      // A verdict of "no" keeps the step open — it was applied but not settled.
      if (analysisId != null && stepIndex != null) {
        const aid = parseInt(analysisId);
        const idx = parseInt(stepIndex);
        if (Number.isInteger(aid) && Number.isInteger(idx) && db.getAiAnalysis(aid)) {
          db.setActionStatus({
            analysisId: aid,
            stepIndex: idx,
            status: result.resolved === 'yes' ? 'verified' : 'applied',
            executionId: executionId != null ? parseInt(executionId) : undefined,
            verdict: JSON.stringify({
              summary: result.summary,
              severity: result.severity,
              resolved: result.resolved,
              at: new Date().toISOString(),
            }),
          });
        }
      }
      res.json(result);
    } catch (error) {
      if (/not configured/.test(error.message)) {
        return res.status(400).json({ error: error.message });
      }
      handleError(res, error, 'AI interpretation failed');
    }
  });

  router.get('/ai/analyses', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const rows = db.getAiAnalyses(limit);
    const byAnalysis = db.getActionStatusesFor(rows.map(r => r.id));
    res.json({ analyses: rows.map(r => toClientShape(r, { statusRows: byAnalysis[r.id] || [] })) });
  });

  // Manual step lifecycle: mark applied / dismissed / back to pending.
  router.put('/ai/analyses/:id/steps/:index', (req, res) => {
    const id = parseInt(req.params.id);
    const index = parseInt(req.params.index);
    if (!Number.isInteger(id) || !Number.isInteger(index) || index < 0) {
      return res.status(400).json({ error: 'Invalid analysis id or step index' });
    }
    const row = db.getAiAnalysis(id);
    if (!row) return res.status(404).json({ error: `Analysis '${req.params.id}' not found` });

    const plan = (() => { try { return JSON.parse(row.action_plan) || []; } catch (_) { return []; } })();
    if (index >= plan.length) {
      return res.status(404).json({ error: `Step ${index} not found in analysis ${id}` });
    }

    const { status, note } = req.body || {};
    if (!['pending', 'applied', 'verified', 'dismissed'].includes(status)) {
      return res.status(400).json({ error: 'status must be one of: pending, applied, verified, dismissed' });
    }
    try {
      db.setActionStatus({ analysisId: id, stepIndex: index, status, note });
      res.json(toClientShape(db.getAiAnalysis(id)));
    } catch (error) {
      handleError(res, error, 'Failed to update step status');
    }
  });

  router.get('/ai/analyses/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const row = Number.isInteger(id) ? db.getAiAnalysis(id) : undefined;
    if (!row) return res.status(404).json({ error: `Analysis '${req.params.id}' not found` });
    res.json(toClientShape(row, { includeSample: true }));
  });

  return router;
}

module.exports = createRouter;
