const express = require('express');
const db = require('../db');
const { handleError } = require('../services/logger');
const { runAnalysis, publicConfig, toClientShape } = require('../services/aiAnalysis');
const { afterAiAnalysis } = require('../services/backgroundJobs');

function createRouter(getServers, io) {
  const router = express.Router();

  router.get('/ai/config', (req, res) => {
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
      const record = await runAnalysis(getServers);
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

  router.get('/ai/analyses', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    res.json({ analyses: db.getAiAnalyses(limit).map(r => toClientShape(r)) });
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
