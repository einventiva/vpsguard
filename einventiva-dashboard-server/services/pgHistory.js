const { executeSSHCommand, filterWarnings } = require('./ssh');
const { detectPgUser, psqlViaB64, discoverPgContainers } = require('./pg');
const { log } = require('./logger');

// One query to the postgres db returns everything as a single JSON
// object — no per-database round-trips. pg_stat_replication is empty
// (lag 0) on non-primaries and without replication.
const SAMPLE_SQL = `SELECT json_build_object(
  'max_connections', (SELECT setting::int FROM pg_settings WHERE name = 'max_connections'),
  'total_connections', (SELECT count(*) FROM pg_stat_activity),
  'replication_lag_bytes', (SELECT COALESCE(max(pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn))::bigint, 0) FROM pg_stat_replication),
  'databases', (SELECT COALESCE(json_agg(json_build_object(
      'datname', datname,
      'size_bytes', pg_database_size(datname),
      'connections', numbackends,
      'blks_hit', blks_hit,
      'blks_read', blks_read
    )), '[]'::json) FROM pg_stat_database WHERE datname IS NOT NULL AND datname NOT LIKE 'template%')
);`;

// Parse the sampler's JSON into pg_history rows: one per database plus
// one container-level aggregate (datname='').
function parsePgSample(raw, { server, container, timestamp }) {
  const output = filterWarnings(raw).trim();
  const jsonLine = output.split('\n').find(l => l.trim().startsWith('{'));
  if (!jsonLine) return null;

  let data;
  try {
    data = JSON.parse(jsonLine);
  } catch (_) {
    return null;
  }

  const rows = [];
  let totalSize = 0, totalHit = 0, totalRead = 0;

  for (const d of data.databases || []) {
    const hit = Number(d.blks_hit) || 0;
    const read = Number(d.blks_read) || 0;
    totalSize += Number(d.size_bytes) || 0;
    totalHit += hit;
    totalRead += read;
    rows.push({
      server, container, timestamp,
      datname: d.datname,
      sizeBytes: Number(d.size_bytes) || 0,
      connections: Number(d.connections) || 0,
      cacheHitRatio: hit + read > 0 ? Math.round((hit / (hit + read)) * 10000) / 100 : null,
    });
  }

  rows.push({
    server, container, timestamp,
    datname: '',
    sizeBytes: totalSize,
    connections: Number(data.total_connections) || 0,
    maxConnections: Number(data.max_connections) || null,
    cacheHitRatio: totalHit + totalRead > 0 ? Math.round((totalHit / (totalHit + totalRead)) * 10000) / 100 : null,
    replicationLagBytes: Number(data.replication_lag_bytes) || 0,
  });

  return rows;
}

// Sample every postgres container on a server. Returns rows for
// pg_history plus per-container connection saturation for alerting.
async function samplePgServer(serverKey, alias) {
  const containers = await discoverPgContainers(alias);
  const timestamp = new Date().toISOString();
  const rows = [];
  const saturation = [];

  for (const c of containers) {
    try {
      const pgUser = await detectPgUser(alias, c.name);
      const raw = await executeSSHCommand(alias, psqlViaB64(c.name, pgUser, SAMPLE_SQL), 15000);
      const parsed = parsePgSample(raw, { server: serverKey, container: c.name, timestamp });
      if (!parsed) {
        log('PG sample parse failed', { server: serverKey, container: c.name });
        continue;
      }
      rows.push(...parsed);
      const agg = parsed[parsed.length - 1];
      if (agg.maxConnections) {
        saturation.push({
          container: c.name,
          connections: agg.connections,
          maxConnections: agg.maxConnections,
          pct: Math.round((agg.connections / agg.maxConnections) * 100),
        });
      }
    } catch (e) {
      log('PG sample failed', { server: serverKey, container: c.name, error: e.message?.substring(0, 200) });
    }
  }

  return { rows, saturation };
}

module.exports = { parsePgSample, samplePgServer, SAMPLE_SQL };
