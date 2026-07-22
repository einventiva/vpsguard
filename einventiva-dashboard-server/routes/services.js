const express = require('express');
const db = require('../db');
const { log, handleError } = require('../services/logger');
const { KINDS, SERVER_ONLY_KINDS, runCheck, uptimePct } = require('../services/serviceChecks');

const SEVERITIES = ['warning', 'critical'];
// A check that probes faster than this hammers the target more than it
// informs; one that probes slower than a day is not monitoring
const MIN_INTERVAL_SEC = 10;
const MAX_INTERVAL_SEC = 86400;

function validateCheck(body, getServers, { partial = false } = {}) {
  const has = (f) => body[f] !== undefined;
  const need = (f) => partial ? has(f) : true;

  if (need('name') && !String(body.name || '').trim()) return 'name is required';
  if (need('kind') && !KINDS.includes(body.kind)) return `kind must be one of: ${KINDS.join(', ')}`;
  if (need('target') && !String(body.target || '').trim()) return 'target is required';

  const kind = body.kind;
  // On create, an omitted runFrom means 'dashboard' — resolve it here so
  // a `command` check with no vantage point is rejected rather than
  // silently created against a vantage point that cannot run it
  const runFrom = partial ? body.runFrom : (body.runFrom ?? 'dashboard');
  if (runFrom !== undefined && runFrom !== 'dashboard' && !getServers()[runFrom]) {
    return `runFrom must be 'dashboard' or a registered server key`;
  }
  // Only meaningful when both are known — on a partial update the other
  // half comes from the stored row and is checked by the caller
  if (kind && runFrom && SERVER_ONLY_KINDS.includes(kind) && runFrom === 'dashboard') {
    return `kind '${kind}' must run from a server, not from the dashboard`;
  }

  if (has('intervalSec')) {
    const n = Number(body.intervalSec);
    if (!Number.isInteger(n) || n < MIN_INTERVAL_SEC || n > MAX_INTERVAL_SEC) {
      return `intervalSec must be between ${MIN_INTERVAL_SEC} and ${MAX_INTERVAL_SEC}`;
    }
  }
  if (has('timeoutMs')) {
    const n = Number(body.timeoutMs);
    if (!Number.isInteger(n) || n < 500 || n > 120000) return 'timeoutMs must be between 500 and 120000';
  }
  for (const f of ['failuresToOpen', 'successesToResolve']) {
    if (has(f)) {
      const n = Number(body[f]);
      if (!Number.isInteger(n) || n < 1 || n > 10) return `${f} must be between 1 and 10`;
    }
  }
  if (has('severity') && !SEVERITIES.includes(body.severity)) {
    return `severity must be one of: ${SEVERITIES.join(', ')}`;
  }
  if (has('config') && (typeof body.config !== 'object' || Array.isArray(body.config) || body.config === null)) {
    return 'config must be an object';
  }
  return null;
}

function createRouter(getServers) {
  const router = express.Router();

  // List checks, each with its latest result and 24h availability
  router.get('/services', (req, res) => {
    try {
      const since = new Date(Date.now() - 24 * 3600e3).toISOString();
      const latest = new Map(db.getLatestCheckResults().map(r => [r.check_id, r]));
      const uptime = new Map(db.getCheckUptime(since).map(u => [u.check_id, u]));

      const items = db.getServiceChecks().map(c => {
        const last = latest.get(c.id);
        const u = uptime.get(c.id);
        return {
          ...c,
          // A check that has never run is unknown, not down — the same
          // rule the AI sample learned the hard way
          lastResult: last
            ? { ok: !!last.ok, latencyMs: last.latency_ms, statusCode: last.status_code, error: last.error, timestamp: last.timestamp }
            : null,
          uptime24hPct: uptimePct(u),
          avgLatencyMs24h: u && u.avg_latency != null ? Math.round(u.avg_latency) : null,
        };
      });
      res.json({ items, count: items.length });
    } catch (error) {
      handleError(res, error, 'Failed to list service checks');
    }
  });

  router.post('/services', (req, res) => {
    try {
      const { id } = req.body;
      if (!id || !/^[a-z0-9][a-z0-9-]*$/.test(id)) {
        return res.status(400).json({ error: 'id is required and must be lowercase alphanumeric with dashes' });
      }
      if (db.getServiceCheck(id)) {
        return res.status(409).json({ error: `Service check '${id}' already exists` });
      }
      const error = validateCheck(req.body, getServers);
      if (error) return res.status(400).json({ error });

      const check = db.createServiceCheck(req.body);
      log('Service check created', { id, kind: check.kind, runFrom: check.run_from });
      res.status(201).json(check);
    } catch (error) {
      handleError(res, error, 'Failed to create service check');
    }
  });

  router.put('/services/:id', (req, res) => {
    try {
      const { id } = req.params;
      const existing = db.getServiceCheck(id);
      if (!existing) return res.status(404).json({ error: `Service check '${id}' not found` });

      const error = validateCheck(req.body, getServers, { partial: true });
      if (error) return res.status(400).json({ error });

      // Re-check the pairing against the merged result: switching only
      // the kind, or only the vantage point, can still land on the
      // invalid combination
      const kind = req.body.kind ?? existing.kind;
      const runFrom = req.body.runFrom ?? existing.run_from;
      if (SERVER_ONLY_KINDS.includes(kind) && runFrom === 'dashboard') {
        return res.status(400).json({ error: `kind '${kind}' must run from a server, not from the dashboard` });
      }

      const check = db.updateServiceCheck(id, req.body);
      log('Service check updated', { id });
      res.json(check);
    } catch (error) {
      handleError(res, error, `Failed to update service check '${req.params.id}'`);
    }
  });

  router.delete('/services/:id', (req, res) => {
    try {
      const { id } = req.params;
      if (!db.getServiceCheck(id)) {
        return res.status(404).json({ error: `Service check '${id}' not found` });
      }
      db.deleteServiceCheck(id);
      log('Service check deleted', { id });
      res.json({ success: true, id });
    } catch (error) {
      handleError(res, error, `Failed to delete service check '${req.params.id}'`);
    }
  });

  // Run once, right now, without touching alert state or history —
  // this backs the "Test" button while composing a check
  router.post('/services/:id/run', async (req, res) => {
    try {
      const check = db.getServiceCheck(req.params.id);
      if (!check) return res.status(404).json({ error: `Service check '${req.params.id}' not found` });
      const result = await runCheck(check, { getServers });
      res.json(result);
    } catch (error) {
      handleError(res, error, `Failed to run service check '${req.params.id}'`);
    }
  });

  router.get('/services/:id/history', (req, res) => {
    try {
      if (!db.getServiceCheck(req.params.id)) {
        return res.status(404).json({ error: `Service check '${req.params.id}' not found` });
      }
      const limit = Math.min(parseInt(req.query.limit) || 100, 500);
      res.json({ results: db.getCheckResults(req.params.id, limit) });
    } catch (error) {
      handleError(res, error, `Failed to load history for '${req.params.id}'`);
    }
  });

  return router;
}

module.exports = createRouter;
