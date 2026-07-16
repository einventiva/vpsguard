const express = require('express');
const db = require('../db');
const { log, handleError } = require('../services/logger');
const { resolveThresholds, METRICS } = require('../services/thresholds');
const { ALERT_THRESHOLDS } = require('../config');

// Body values: number 1-100 sets an override, null/undefined clears it (inherit)
function parseBody(body) {
  const out = {};
  for (const m of METRICS) {
    const v = body[m];
    if (v === null || v === undefined || v === '') {
      out[m] = null;
    } else {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 1 || n > 100) {
        throw new Error(`Invalid ${m} threshold: must be a number between 1 and 100`);
      }
      out[m] = n;
    }
  }
  return out;
}

function createRouter(getServers) {
  const router = express.Router();

  router.get('/thresholds', (req, res) => {
    try {
      const SERVERS = getServers();
      const rows = db.getAllThresholds();
      const overrides = {};
      let global = { cpu: null, memory: null, disk: null };
      for (const row of rows) {
        const { server, ...values } = row;
        if (server === 'default') global = values;
        else overrides[server] = values;
      }
      const effective = {};
      for (const key of Object.keys(SERVERS)) {
        effective[key] = resolveThresholds(key);
      }
      res.json({ builtin: ALERT_THRESHOLDS, global, overrides, effective });
    } catch (error) {
      handleError(res, error, 'Failed to retrieve thresholds');
    }
  });

  router.put('/thresholds/global', (req, res) => {
    try {
      const values = parseBody(req.body);
      const row = db.setThreshold('default', values);
      log('Global thresholds updated', values);
      res.json(row);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.put('/thresholds/:server', (req, res) => {
    try {
      const { server } = req.params;
      const SERVERS = getServers();
      if (!SERVERS[server]) {
        return res.status(404).json({ error: `Server '${server}' not found` });
      }
      const values = parseBody(req.body);
      const row = db.setThreshold(server, values);
      log('Server thresholds updated', { server, ...values });
      res.json(row);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.delete('/thresholds/:server', (req, res) => {
    try {
      const server = req.params.server === 'global' ? 'default' : req.params.server;
      db.deleteThreshold(server);
      log('Thresholds override removed', { server });
      res.json({ success: true, server });
    } catch (error) {
      handleError(res, error, 'Failed to delete thresholds');
    }
  });

  return router;
}

module.exports = createRouter;
