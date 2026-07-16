const db = require('../db');
const { log } = require('./logger');
const { executeSSHCommand } = require('./ssh');
const { METRICS_COMMAND, parseSystemMetrics, parseCpuPercent } = require('./metrics');
const { sendNativeNotification } = require('./alerts');
const { createAlertEngine } = require('./alertEngine');
const { resolveThresholds } = require('./thresholds');
const { computeProjections } = require('./projections');
const { getCronStatus } = require('./cronWatch');
const { samplePgServer } = require('./pgHistory');
const { sendWebhook } = require('./notify');
const { setCache } = require('./cache');
const {
  METRICS_INTERVAL, PRUNE_INTERVAL, PRUNE_STARTUP_DELAY, PRUNE_KEEP_DAYS, DETAIL_KEEP_DAYS,
  ROLLUP_INTERVAL, ROLLUP_STARTUP_DELAY, ROLLUP_KEEP_DAYS,
  SLOW_CHECK_INTERVAL, SLOW_CHECK_STARTUP_DELAY, DISK_ETA_ALERT_DAYS,
  PG_SAMPLE_INTERVAL, PG_SAMPLE_STARTUP_DELAY, PG_KEEP_DAYS, PG_CONN_ALERT_PCT,
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
      const pg = db.prunePgHistory(PG_KEEP_DAYS);
      log('Pruned old metrics', { ...result, pgDeleted: pg.changes });
    } catch (e) {
      log('Prune failed', { error: e.message });
    }
  };
  // Run shortly after startup too — with interval-only scheduling,
  // frequently-restarted servers never prune
  setTimeout(prune, PRUNE_STARTUP_DELAY);
  setInterval(prune, PRUNE_INTERVAL);
}

// Open/resolve an alert managed outside the per-sample engine (hourly
// checks need no hysteresis — the condition is already smoothed)
function transitionAlert(io, { server, type, active, severity, message, value, threshold }) {
  const open = db.getOpenAlert(server, type);
  if (active && !open) {
    const row = db.openAlert({ server, type, severity, message, value, threshold });
    log('Alert opened', { server, type, value });
    io.emit('alert:opened', row);
    sendNativeNotification(row, 'opened');
    sendWebhook('opened', row);
  } else if (!active && open) {
    const row = db.resolveAlert(open.id);
    log('Alert resolved', { server, type, id: open.id });
    io.emit('alert:resolved', row);
    sendNativeNotification(row, 'resolved');
    sendWebhook('resolved', row);
  }
}

const shortCmd = (cmd) => (cmd.length > 40 ? `${cmd.slice(0, 40)}…` : cmd);

async function runSlowChecks(io, getServers) {
  const SERVERS = getServers();
  for (const [key, svr] of Object.entries(SERVERS)) {
    // Disk-full projection alert
    try {
      const proj = computeProjections([key])[key];
      const eta = proj.disk.etaDays;
      const active = eta != null && eta <= DISK_ETA_ALERT_DAYS;
      transitionAlert(io, {
        server: key,
        type: 'disk-eta',
        active,
        severity: active && eta <= 7 ? 'critical' : 'warning',
        message: active
          ? `${svr.displayName} disk projected full in ~${Math.round(eta)}d (+${proj.disk.slopePerDay}%/day)`
          : '',
        value: eta,
        threshold: DISK_ETA_ALERT_DAYS,
      });
    } catch (e) {
      log('Disk ETA check failed', { server: key, error: e.message });
    }

    // Overdue cron alert
    try {
      const { entries } = await getCronStatus(key, getServers);
      const overdue = entries.filter(en => en.overdue);
      transitionAlert(io, {
        server: key,
        type: 'cron',
        active: overdue.length > 0,
        severity: 'warning',
        message: `${svr.displayName}: ${overdue.length} cron job(s) overdue: ${overdue.map(o => shortCmd(o.command)).join(' | ')}`,
        value: overdue.length,
        threshold: null,
      });
    } catch (e) {
      log('Cron watch check failed', { server: key, error: e.message });
    }
  }
}

async function runPgSampling(io, getServers) {
  const SERVERS = getServers();
  for (const [key, svr] of Object.entries(SERVERS)) {
    try {
      const { rows, saturation } = await samplePgServer(key, svr.alias);
      if (rows.length > 0) db.appendPgMetrics(rows);

      // Connection saturation alert — sampled every 5 min, already smooth
      const over = saturation.filter(s => s.pct >= PG_CONN_ALERT_PCT);
      transitionAlert(io, {
        server: key,
        type: 'pg-connections',
        active: over.length > 0,
        severity: over.some(s => s.pct >= 95) ? 'critical' : 'warning',
        message: `${svr.displayName}: PostgreSQL connections at ${over.map(s => `${s.container} ${s.connections}/${s.maxConnections} (${s.pct}%)`).join(', ')}`,
        value: over.length > 0 ? Math.max(...over.map(s => s.pct)) : null,
        threshold: PG_CONN_ALERT_PCT,
      });
    } catch (e) {
      log('PG sampling failed', { server: key, error: e.message });
    }
  }
}

function startPgSampleLoop(io, getServers) {
  const run = () => runPgSampling(io, getServers).catch(e => log('PG sampling loop error', { error: e.message }));
  setTimeout(run, PG_SAMPLE_STARTUP_DELAY);
  setInterval(run, PG_SAMPLE_INTERVAL);
}

function startSlowCheckLoop(io, getServers) {
  const run = () => runSlowChecks(io, getServers).catch(e => log('Slow checks failed', { error: e.message }));
  setTimeout(run, SLOW_CHECK_STARTUP_DELAY);
  setInterval(run, SLOW_CHECK_INTERVAL);
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

module.exports = { fetchAllServerStatus, startMetricsLoop, startPruneLoop, startRollupLoop, startSlowCheckLoop, startPgSampleLoop, runSlowChecks, runPgSampling };
