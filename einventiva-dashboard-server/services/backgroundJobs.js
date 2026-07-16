const db = require('../db');
const { log } = require('./logger');
const { executeSSHCommand } = require('./ssh');
const { METRICS_COMMAND, parseSystemMetrics, parseCpuPercent } = require('./metrics');
const { sendNativeNotification } = require('./alerts');
const { createAlertEngine } = require('./alertEngine');
const { resolveThresholds } = require('./thresholds');
const { sendWebhook } = require('./notify');
const { setCache } = require('./cache');
const {
  METRICS_INTERVAL, PRUNE_INTERVAL, PRUNE_STARTUP_DELAY, PRUNE_KEEP_DAYS, DETAIL_KEEP_DAYS,
  ROLLUP_INTERVAL, ROLLUP_STARTUP_DELAY, ROLLUP_KEEP_DAYS,
  ALERT_SAMPLES_TO_OPEN, ALERT_SAMPLES_TO_RESOLVE,
} = require('../config');

async function fetchAllServerStatus(getServers) {
  const SERVERS = getServers();
  const statusData = {};

  // Parallel execution: all servers at once
  const entries = Object.entries(SERVERS);
  const results = await Promise.allSettled(
    entries.map(async ([key, svr]) => {
      try {
        const output = await executeSSHCommand(svr.alias, METRICS_COMMAND);
        return {
          key,
          data: {
            name: svr.displayName,
            alias: svr.alias,
            status: 'connected',
            timestamp: new Date().toISOString(),
            metrics: parseSystemMetrics(output)
          }
        };
      } catch (error) {
        log(`Failed to get status for ${key}`, { error: error.message });
        return {
          key,
          data: {
            name: svr.displayName,
            alias: svr.alias,
            status: 'error',
            error: error.message,
            timestamp: new Date().toISOString()
          }
        };
      }
    })
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      statusData[result.value.key] = result.value.data;
    }
  }

  return statusData;
}

function startMetricsLoop(io, getServers) {
  const alertEngine = createAlertEngine({
    store: db,
    thresholds: resolveThresholds,
    samplesToOpen: ALERT_SAMPLES_TO_OPEN,
    samplesToResolve: ALERT_SAMPLES_TO_RESOLVE,
  });

  setInterval(async () => {
    try {
      const statusData = await fetchAllServerStatus(getServers);
      setCache('status', statusData, 10000);

      const SERVERS = getServers();

      for (const [key, data] of Object.entries(statusData)) {
        const parsed = data.metrics || {};
        const cpuPercent = parseCpuPercent(parsed.cpu);
        const mem = parsed.memory || {};
        const memPercent = mem.total ? (mem.used / mem.total) * 100 : 0;
        const diskPercent = parseInt((parsed.disk?.percentUsed || '0').replace('%', ''));

        const entry = {
          timestamp: data.timestamp,
          cpu: cpuPercent,
          memory: memPercent,
          disk: diskPercent,
          online: data.status === 'connected'
        };

        db.appendMetric(key, entry);

        // Store detail
        const details = [];

        if (Array.isArray(parsed.topProcesses)) {
          for (const p of parsed.topProcesses) {
            details.push({
              type: 'process',
              name: p.command || 'unknown',
              cpu: p.cpu,
              memory: p.mem,
              extra: { user: p.user, pid: p.pid },
            });
          }
        }

        if (Array.isArray(parsed.dockerStats)) {
          for (const c of parsed.dockerStats) {
            details.push({
              type: 'container',
              name: c.Name || c.name || 'unknown',
              cpu: parseFloat((c.CPUPerc || '0').replace('%', '')) || 0,
              memory: parseFloat((c.MemPerc || '0').replace('%', '')) || 0,
              extra: { memUsage: c.MemUsage, netIO: c.NetIO, blockIO: c.BlockIO },
            });
          }
        }

        if (details.length > 0) {
          db.appendMetricDetails(key, data.timestamp, details);
        }

        // Alert lifecycle (open/resolve with hysteresis)
        const serverDisplayName = SERVERS[key]?.displayName || key;
        const events = alertEngine.processServerSample(key, serverDisplayName, data);

        for (const alert of events.opened) {
          log('Alert opened', { server: alert.server, type: alert.type, value: alert.value });
          io.emit('alert:opened', alert);
          sendNativeNotification(alert, 'opened');
          sendWebhook('opened', alert);
        }
        for (const alert of events.resolved) {
          log('Alert resolved', { server: alert.server, type: alert.type, id: alert.id });
          io.emit('alert:resolved', alert);
          sendNativeNotification(alert, 'resolved');
          sendWebhook('resolved', alert);
        }
      }

      // Emit via WebSocket
      io.emit('metrics:update', statusData);
    } catch (e) {
      log('Background metrics loop error', { error: e.message });
    }
  }, METRICS_INTERVAL);
}

function startPruneLoop() {
  const prune = () => {
    try {
      const result = db.pruneOldMetrics(PRUNE_KEEP_DAYS, DETAIL_KEEP_DAYS);
      log('Pruned old metrics', result);
    } catch (e) {
      log('Prune failed', { error: e.message });
    }
  };
  // Run shortly after startup too — with interval-only scheduling,
  // frequently-restarted servers never prune
  setTimeout(prune, PRUNE_STARTUP_DELAY);
  setInterval(prune, PRUNE_INTERVAL);
}

function startRollupLoop() {
  const rollup = () => {
    try {
      const result = db.rollupHourly();
      const pruned = db.pruneRollup(ROLLUP_KEEP_DAYS);
      log('Hourly rollup done', { upserted: result.upserted, pruned: pruned.changes });
    } catch (e) {
      log('Rollup failed', { error: e.message });
    }
  };
  setTimeout(rollup, ROLLUP_STARTUP_DELAY);
  setInterval(rollup, ROLLUP_INTERVAL);
}

module.exports = { fetchAllServerStatus, startMetricsLoop, startPruneLoop, startRollupLoop };
