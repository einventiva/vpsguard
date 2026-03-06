const express = require('express');
const db = require('../db');
const { handleError } = require('../services/logger');

function createRouter(getServers) {
  const router = express.Router();

  // Metrics history
  router.get('/history/:server', (req, res) => {
    const { server: serverKey } = req.params;
    const SERVERS = getServers();

    if (!SERVERS[serverKey]) {
      return res.status(404).json({ error: `Server '${serverKey}' not found` });
    }

    const since = req.query.since || null;
    const entries = db.getMetrics(serverKey, since);
    res.json({
      server: serverKey,
      count: entries.length,
      entries: entries.map(e => ({
        ...e,
        online: !!e.online,
      })),
    });
  });

  // Metric detail (drill-down)
  router.get('/history/:server/detail', (req, res) => {
    const { server: serverKey } = req.params;
    const { ts } = req.query;
    const SERVERS = getServers();

    if (!SERVERS[serverKey]) {
      return res.status(404).json({ error: `Server '${serverKey}' not found` });
    }
    if (!ts) {
      return res.status(400).json({ error: 'Query parameter "ts" (timestamp) is required' });
    }

    const details = db.getMetricDetails(serverKey, ts);
    const processes = details.filter(d => d.type === 'process');
    const containers = details.filter(d => d.type === 'container');

    res.json({
      server: serverKey,
      timestamp: ts,
      processes,
      containers,
    });
  });

  // Script executions history
  router.get('/executions', (req, res) => {
    const { server, limit } = req.query;
    const executions = db.getExecutions(server || null, parseInt(limit) || 50);
    res.json({ executions });
  });

  return router;
}

module.exports = createRouter;
