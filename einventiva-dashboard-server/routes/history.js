const express = require('express');
const db = require('../db');
const { handleError } = require('../services/logger');

// Named ranges keep chart payloads bounded (~150-400 points):
// short ranges serve raw 15s samples, medium ranges average raw into
// buckets, long ranges read the hourly rollup table (raw is pruned
// at PRUNE_KEEP_DAYS but rollups keep ~a year).
const RANGES = {
  '1h':  { ms: 3600e3,          source: 'raw' },
  '6h':  { ms: 6 * 3600e3,      source: 'bucketed', bucket: 120 },
  '24h': { ms: 24 * 3600e3,     source: 'bucketed', bucket: 300 },
  '7d':  { ms: 7 * 86400e3,     source: 'bucketed', bucket: 3600 },
  '30d': { ms: 30 * 86400e3,    source: 'rollup', bucket: 4 * 3600 },
  '90d': { ms: 90 * 86400e3,    source: 'rollup', bucket: 12 * 3600 },
  '1y':  { ms: 365 * 86400e3,   source: 'rollup', bucket: 24 * 3600 },
};

function createRouter(getServers) {
  const router = express.Router();

  // Metrics history
  router.get('/history/:server', (req, res) => {
    try {
      const { server: serverKey } = req.params;
      const SERVERS = getServers();

      if (!SERVERS[serverKey]) {
        return res.status(404).json({ error: `Server '${serverKey}' not found` });
      }

      const { range, since } = req.query;

      if (range) {
        const spec = RANGES[range];
        if (!spec) {
          return res.status(400).json({ error: `Invalid range. Valid: ${Object.keys(RANGES).join(', ')}` });
        }
        const sinceIso = new Date(Date.now() - spec.ms).toISOString();
        let entries;
        if (spec.source === 'raw') {
          entries = db.getMetrics(serverKey, sinceIso);
        } else if (spec.source === 'bucketed') {
          entries = db.getMetricsBucketed(serverKey, sinceIso, spec.bucket);
        } else {
          entries = db.getRollup(serverKey, sinceIso, spec.bucket);
        }
        return res.json({
          server: serverKey,
          range,
          granularity: spec.source === 'raw' ? 'raw' : `${spec.bucket}s`,
          bucketSeconds: spec.source === 'raw' ? 15 : spec.bucket,
          count: entries.length,
          entries: entries.map(e => ({ ...e, online: !!e.online })),
        });
      }

      const entries = db.getMetrics(serverKey, since || null);
      res.json({
        server: serverKey,
        count: entries.length,
        entries: entries.map(e => ({
          ...e,
          online: !!e.online,
        })),
      });
    } catch (error) {
      handleError(res, error, 'Failed to retrieve history');
    }
  });

  // Metric detail (drill-down). Optional `window` (seconds): if no
  // detail exists at the exact ts (bucketed/rolled-up charts), return
  // the nearest detail within [ts, ts+window].
  router.get('/history/:server/detail', (req, res) => {
    try {
      const { server: serverKey } = req.params;
      const { ts, window: windowParam } = req.query;
      const SERVERS = getServers();

      if (!SERVERS[serverKey]) {
        return res.status(404).json({ error: `Server '${serverKey}' not found` });
      }
      if (!ts) {
        return res.status(400).json({ error: 'Query parameter "ts" (timestamp) is required' });
      }

      let effectiveTs = ts;
      let details = db.getMetricDetails(serverKey, ts);

      if (details.length === 0 && windowParam) {
        const windowSeconds = Math.min(parseInt(windowParam) || 0, 24 * 3600);
        if (windowSeconds > 0) {
          const nearest = db.findDetailTimestamp(serverKey, ts, windowSeconds);
          if (nearest) {
            effectiveTs = nearest;
            details = db.getMetricDetails(serverKey, nearest);
          }
        }
      }

      const processes = details.filter(d => d.type === 'process');
      const containers = details.filter(d => d.type === 'container');

      res.json({
        server: serverKey,
        timestamp: effectiveTs,
        requestedTimestamp: ts,
        processes,
        containers,
      });
    } catch (error) {
      handleError(res, error, 'Failed to retrieve metric detail');
    }
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
