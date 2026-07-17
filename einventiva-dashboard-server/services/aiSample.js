// Builds the compact fleet snapshot the AI analysis runs on. Everything
// comes from the local DB and the status cache — no SSH in the path, so
// sampling is fast and side-effect free. Values are pre-aggregated and
// rounded to keep the prompt small (~3-4k tokens). Raw script outputs
// are deliberately excluded: they can contain sensitive data.

const db = require('../db');
const { getCached } = require('./cache');
const { computeProjections } = require('./projections');
const { parseCpuPercent } = require('./metrics');

const r1 = (n) => (n == null || Number.isNaN(n) ? null : Math.round(n * 10) / 10);

// Pure: shape one server's live status into the sample entry
function formatServerStatus(key, s) {
  if (!s || s.status !== 'connected') {
    return { server: key, online: false, error: s?.error || 'unreachable' };
  }
  const m = s.metrics || {};
  const mem = m.memory || {};
  return {
    server: key,
    name: s.name,
    online: true,
    cpuPct: r1(parseCpuPercent(m.cpu)),
    memPct: mem.total ? r1((mem.used / mem.total) * 100) : null,
    diskPct: parseInt((m.disk?.percentUsed || '0').replace('%', '')) || 0,
    swapPct: mem.swapTotal ? r1((mem.swapUsed / mem.swapTotal) * 100) : null,
    inodesPct: parseInt((m.inodes?.percentUsed || '0').replace('%', '')) || null,
    sshLatencyMs: s.latencyMs ?? null,
    containers: Array.isArray(m.dockerStats) ? m.dockerStats.length : null,
    rebootRequired: !!m.rebootRequired,
    failedUnits: m.failedUnits || [],
  };
}

// Pure: compress a rollup series to [{t, cpu, mem, disk}] with rounding
function compressRollup(entries) {
  return (entries || []).map(e => ({
    t: e.timestamp,
    cpu: r1(e.cpu), mem: r1(e.memory), disk: r1(e.disk),
  }));
}

function formatAlert(a) {
  return {
    server: a.server, type: a.type, severity: a.severity,
    message: (a.message || '').slice(0, 160),
    startedAt: a.started_at, resolvedAt: a.resolved_at,
  };
}

function buildSample(getServers) {
  const SERVERS = getServers();
  const serverKeys = Object.keys(SERVERS);
  const now = Date.now();
  const iso = (msAgo) => new Date(now - msAgo).toISOString();

  const status = getCached('status') || {};
  const servers = serverKeys.map(k => formatServerStatus(k, status[k]));

  const alerts = db.getAlerts({ limit: 60 });
  const active = alerts.filter(a => !a.resolved_at).map(formatAlert);
  const recentResolved = alerts
    .filter(a => a.resolved_at && new Date(a.resolved_at).getTime() > now - 48 * 3600e3)
    .slice(0, 15).map(formatAlert);

  const trends = {};
  for (const k of serverKeys) {
    trends[k] = {
      last24h: compressRollup(db.getRollup(k, iso(24 * 3600e3), 4 * 3600)),
      last7d: compressRollup(db.getRollup(k, iso(7 * 86400e3), 24 * 3600)),
    };
  }

  let projections = {};
  try {
    const proj = computeProjections(serverKeys);
    for (const [k, p] of Object.entries(proj)) {
      projections[k] = {
        diskEtaDays: p.disk?.etaDays != null ? Math.round(p.disk.etaDays) : null,
        diskSlopePerDay: p.disk?.slopePerDay ?? null,
        memSlopePerHour: p.memory?.slopePerHour ?? null,
        memTrendingUp: !!p.memory?.trendingUp,
      };
    }
  } catch (_) { /* projections need >=24h of data */ }

  const pg = db.getLatestPgAggregates(iso(2 * 3600e3)).map(p => ({
    server: p.server, container: p.container,
    connections: p.connections, maxConnections: p.max_connections,
    sizeMB: p.size_bytes != null ? Math.round(p.size_bytes / 1048576) : null,
    replicationLagMB: p.replication_lag_bytes != null ? Math.round(p.replication_lag_bytes / 1048576) : null,
  }));

  const scheduled = db.getScripts().filter(s => s.schedule).map(s => ({ id: s.id, schedule: s.schedule, servers: s.schedule_servers }));
  const lastScheduledRuns = db.getLastScheduledExecutions().map(r => ({
    server: r.server, script: r.script_id, exitCode: r.exit_code, at: r.started_at,
  }));

  const failedExecutions = db.getExecutions(null, 30)
    .filter(e => e.exit_code !== 0 && new Date(e.started_at).getTime() > now - 48 * 3600e3)
    .map(e => ({ server: e.server, script: e.script_id, exitCode: e.exit_code, at: e.started_at, by: e.triggered_by }));

  return {
    generatedAt: new Date(now).toISOString(),
    servers,
    alerts: { active, recentResolved },
    trends,
    projections,
    postgres: pg,
    scheduledScripts: { configured: scheduled, lastRuns: lastScheduledRuns },
    failedExecutionsLast48h: failedExecutions,
  };
}

module.exports = { buildSample, formatServerStatus, compressRollup };
