const db = require('../db');
const { log } = require('./logger');
const { executeSSHCommand } = require('./ssh');
const { METRICS_COMMAND, parseSystemMetrics, parseCpuPercent } = require('./metrics');
const { checkAlerts, sendNativeNotification } = require('./alerts');
const { setCache } = require('./cache');
const { METRICS_INTERVAL, PRUNE_INTERVAL, PRUNE_KEEP_DAYS } = require('../config');

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
  setInterval(async () => {
    try {
      const statusData = await fetchAllServerStatus(getServers);
      setCache('status', statusData, 10000);

      const SERVERS = getServers();
      const allAlerts = [];

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

        // Check alerts
        const serverDisplayName = SERVERS[key]?.displayName || key;
        const alerts = checkAlerts(key, serverDisplayName, data);
        allAlerts.push(...alerts);
      }

      // Emit via WebSocket
      io.emit('metrics:update', statusData);

      if (allAlerts.length > 0) {
        io.emit('alerts', allAlerts);
        allAlerts.forEach(a => sendNativeNotification(a));
      }
    } catch (e) {
      log('Background metrics loop error', { error: e.message });
    }
  }, METRICS_INTERVAL);
}

function startPruneLoop() {
  setInterval(() => {
    const result = db.pruneOldMetrics(PRUNE_KEEP_DAYS);
    log('Pruned old metrics', result);
  }, PRUNE_INTERVAL);
}

module.exports = { fetchAllServerStatus, startMetricsLoop, startPruneLoop };
