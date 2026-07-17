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
const { fetchCertificates } = require('./sslCheck');
const { fetchRestartCounts, computeRestartDeltas, toSnapshot } = require('./containerWatch');
const { dueScripts, resolveTargetServers, parseCron, cronMatches, isValidCron } = require('./scheduler');
const { runAnalysis, isConfigured: aiConfigured, toClientShape, groupFindingsForAlerts } = require('./aiAnalysis');
const { sendCustomNotification } = require('./alerts');
const { sendWebhook } = require('./notify');
const { setCache } = require('./cache');
const {
  METRICS_INTERVAL, DETAIL_EVERY_CYCLES, PRUNE_INTERVAL, PRUNE_STARTUP_DELAY, PRUNE_KEEP_DAYS, DETAIL_KEEP_DAYS,
  ROLLUP_INTERVAL, ROLLUP_STARTUP_DELAY, ROLLUP_KEEP_DAYS,
  SLOW_CHECK_INTERVAL, SLOW_CHECK_STARTUP_DELAY, DISK_ETA_ALERT_DAYS, SSL_ALERT_DAYS,
  PG_SAMPLE_INTERVAL, PG_SAMPLE_STARTUP_DELAY, PG_KEEP_DAYS, PG_CONN_ALERT_PCT, PG_REPL_LAG_ALERT_MB,
  ALERT_SAMPLES_TO_OPEN, ALERT_SAMPLES_TO_RESOLVE, SCRIPT_TIMEOUT,
  AI_ANALYSIS_SCHEDULE, AI_OPEN_ALERTS,
} = require('../config');

async function fetchAllServerStatus(getServers) {
  const SERVERS = getServers();
  const statusData = {};

  // Parallel execution: all servers at once
  const entries = Object.entries(SERVERS);
  const results = await Promise.allSettled(
    entries.map(async ([key, svr]) => {
      try {
        // Round-trip time of the metrics command doubles as an SSH
        // latency signal — network/load degradation shows here first
        const t0 = Date.now();
        const output = await executeSSHCommand(svr.alias, METRICS_COMMAND);
        const latencyMs = Date.now() - t0;
        return {
          key,
          data: {
            name: svr.displayName,
            alias: svr.alias,
            status: 'connected',
            timestamp: new Date().toISOString(),
            latencyMs,
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

  let cycle = 0;
  setInterval(async () => {
    try {
      cycle++;
      // Detail (top processes/containers) is stored every Nth cycle
      // (~60s) — the drill-down finds the nearest sample via window=
      const storeDetail = cycle % DETAIL_EVERY_CYCLES === 0;
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

        if (storeDetail && Array.isArray(parsed.topProcesses)) {
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

        if (storeDetail && Array.isArray(parsed.dockerStats)) {
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

// Previous restart-count snapshot per server; first pass after a
// dashboard restart is a baseline and never alerts
const restartSnapshots = new Map(); // serverKey -> Map(container -> count)

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

    // Container flapping: restart counts growing between hourly passes
    try {
      const containers = await fetchRestartCounts(svr.alias);
      const prev = restartSnapshots.get(key);
      if (prev) {
        const deltas = computeRestartDeltas(prev, containers);
        transitionAlert(io, {
          server: key,
          type: 'flapping',
          active: deltas.length > 0,
          severity: deltas.some(d => d.oomKilled) ? 'critical' : 'warning',
          message: `${svr.displayName}: container restarts increasing: ${deltas.map(d => `${d.name} (+${d.delta}, total ${d.total}${d.oomKilled ? ', OOM' : ''})`).join(', ')}`,
          value: deltas.reduce((sum, d) => sum + d.delta, 0) || null,
          threshold: null,
        });
      }
      restartSnapshots.set(key, toSnapshot(containers));
    } catch (e) {
      log('Container flapping check failed', { server: key, error: e.message });
    }

    // SSL certificate expiry alert (unknown = no certs found or no
    // passwordless sudo — stays silent)
    try {
      const certs = await fetchCertificates(svr.alias);
      const expiring = certs.filter(c => c.daysLeft <= SSL_ALERT_DAYS);
      transitionAlert(io, {
        server: key,
        type: 'ssl',
        active: expiring.length > 0,
        severity: expiring.some(c => c.daysLeft <= 7) ? 'critical' : 'warning',
        message: `${svr.displayName}: SSL certificate(s) expiring: ${expiring.map(c => `${c.name} (${c.daysLeft}d)`).join(', ')}`,
        value: expiring.length > 0 ? Math.min(...expiring.map(c => c.daysLeft)) : null,
        threshold: SSL_ALERT_DAYS,
      });
    } catch (e) {
      log('SSL check failed', { server: key, error: e.message });
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
      const { rows, saturation, replication } = await samplePgServer(key, svr.alias);
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

      // Replication lag alert — a standby falling behind its primary
      const lagLimit = PG_REPL_LAG_ALERT_MB * 1048576;
      const lagging = replication.filter(r => r.lagBytes >= lagLimit);
      transitionAlert(io, {
        server: key,
        type: 'pg-replication',
        active: lagging.length > 0,
        severity: lagging.some(r => r.lagBytes >= lagLimit * 4) ? 'critical' : 'warning',
        message: `${svr.displayName}: replication lag: ${lagging.map(r => `${r.container} ${(r.lagBytes / 1048576).toFixed(0)}MB`).join(', ')}`,
        value: lagging.length > 0 ? Math.round(Math.max(...lagging.map(r => r.lagBytes)) / 1048576) : null,
        threshold: PG_REPL_LAG_ALERT_MB,
      });
    } catch (e) {
      log('PG sampling failed', { server: key, error: e.message });
    }
  }
}

// Scheduled scripts: run due scripts on their target servers, persist
// the executions like manual runs, and keep a per-server `script`
// alert reflecting whether any scheduled script's last run failed.
async function runScheduledScripts(io, getServers, now = new Date()) {
  const SERVERS = getServers();
  const serverKeys = Object.keys(SERVERS);
  const scheduled = db.getScripts().filter(s => s.schedule);
  const due = dueScripts(scheduled, now);

  const jobs = [];
  for (const script of due) {
    for (const key of resolveTargetServers(script, serverKeys)) {
      jobs.push({ script, key });
    }
  }
  if (jobs.length > 0) {
    log('Running scheduled scripts', { scripts: [...new Set(jobs.map(j => j.script.id))], targets: jobs.length });
  }

  await Promise.allSettled(jobs.map(async ({ script, key }) => {
    const startTime = Date.now();
    let exitCode = 0;
    try {
      const output = await executeSSHCommand(SERVERS[key].alias, script.command, SCRIPT_TIMEOUT);
      db.logExecution({
        scriptId: script.id, server: key, exitCode: 0,
        startedAt: new Date(startTime).toISOString(), durationMs: Date.now() - startTime,
        output, triggeredBy: 'schedule',
      });
    } catch (err) {
      exitCode = typeof err.code === 'number' ? err.code : 1;
      db.logExecution({
        scriptId: script.id, server: key, exitCode,
        startedAt: new Date(startTime).toISOString(), durationMs: Date.now() - startTime,
        output: [
          err.stdout, err.stderr,
          err.killed ? `\n[dashboard] Timed out after ${Math.round(SCRIPT_TIMEOUT / 1000)}s — the remote command may still be running on the server.\n` : '',
        ].filter(Boolean).join('') || err.message,
        triggeredBy: 'schedule',
      });
      log('Scheduled script failed', { script: script.id, server: key, exitCode, error: err.message });
    }
    // Open panels refresh their history/badges on this
    io.emit('execution:finished', { script: script.id, server: key, exitCode, triggeredBy: 'schedule' });
  }));

  // Alert on every tick (not just after runs) so removing a schedule
  // or a passing rerun resolves within a minute
  const lastRuns = new Map(db.getLastScheduledExecutions().map(r => [`${r.server}|${r.script_id}`, r]));
  for (const key of serverKeys) {
    const failing = [];
    for (const script of scheduled) {
      if (!resolveTargetServers(script, serverKeys).includes(key)) continue;
      const last = lastRuns.get(`${key}|${script.id}`);
      if (last && last.exit_code !== 0) failing.push(`${script.id} (exit ${last.exit_code})`);
    }
    transitionAlert(io, {
      server: key,
      type: 'script',
      active: failing.length > 0,
      severity: 'warning',
      message: `${SERVERS[key].displayName}: scheduled script(s) failing: ${failing.join(', ')}`,
      value: failing.length || null,
      threshold: null,
    });
  }
}

// Post-analysis side effects, shared by scheduled and manual runs:
// socket event for open panels, desktop notification, and (opt-in)
// per-server `ai` alerts through the standard transition pipeline.
function afterAiAnalysis(io, record, getServers) {
  const client = toClientShape(record);
  io.emit('ai:analysis', client);

  const findings = client.findings || [];
  if (client.error) {
    sendCustomNotification('VPSGuard — Análisis IA', `El análisis falló: ${client.error.slice(0, 120)}`, 'Basso');
  } else if (findings.length > 0) {
    const criticals = findings.filter(f => f.severity === 'critical').length;
    sendCustomNotification(
      'VPSGuard — Análisis IA',
      `${findings.length} hallazgo(s)${criticals ? ` (${criticals} critical)` : ''} — revisa la pestaña Prevención`,
      criticals ? 'Basso' : 'Ping'
    );
  }

  if (AI_OPEN_ALERTS && !client.error) {
    const SERVERS = getServers();
    const groups = groupFindingsForAlerts(findings);
    // Evaluate every server (plus 'fleet') so alerts also resolve when
    // a later analysis comes back clean for that server
    for (const key of [...Object.keys(SERVERS), 'fleet']) {
      const g = groups[key];
      transitionAlert(io, {
        server: key,
        type: 'ai',
        active: !!g,
        severity: g?.severity || 'warning',
        message: g ? `AI: ${g.titles.join(' | ')}${g.count > g.titles.length ? ` (+${g.count - g.titles.length} más)` : ''}` : '',
        value: g?.count ?? null,
        threshold: null,
      });
    }
  }
}

// Scheduled AI analyses: fire when AI_ANALYSIS_SCHEDULE matches the
// current minute (same cron dialect as scheduled scripts)
function startAiAnalysisLoop(io, getServers) {
  if (!AI_ANALYSIS_SCHEDULE) return;
  if (!isValidCron(AI_ANALYSIS_SCHEDULE)) {
    log('AI_ANALYSIS_SCHEDULE is not a valid cron expression — scheduled analyses disabled', { schedule: AI_ANALYSIS_SCHEDULE });
    return;
  }
  const parsed = parseCron(AI_ANALYSIS_SCHEDULE);
  const tick = async () => {
    try {
      if (!aiConfigured() || !cronMatches(parsed, new Date())) return;
      log('Scheduled AI analysis starting');
      const record = await runAnalysis(getServers);
      afterAiAnalysis(io, record, getServers);
    } catch (e) {
      log('Scheduled AI analysis error', { error: e.message });
    }
  };
  const msToNextMinute = 60000 - (Date.now() % 60000);
  setTimeout(() => { tick(); setInterval(tick, 60000); }, msToNextMinute + 750);
}

function startSchedulerLoop(io, getServers) {
  const tick = () => runScheduledScripts(io, getServers).catch(e => log('Scheduler loop error', { error: e.message }));
  // Align ticks to minute boundaries so cron minute matching holds
  const msToNextMinute = 60000 - (Date.now() % 60000);
  setTimeout(() => { tick(); setInterval(tick, 60000); }, msToNextMinute + 500);
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

module.exports = { fetchAllServerStatus, startMetricsLoop, startPruneLoop, startRollupLoop, startSlowCheckLoop, startPgSampleLoop, startSchedulerLoop, startAiAnalysisLoop, afterAiAnalysis, runSlowChecks, runPgSampling, runScheduledScripts };
