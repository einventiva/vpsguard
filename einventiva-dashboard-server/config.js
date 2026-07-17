const db = require('./db');
const { log } = require('./services/logger');

const PORT = process.env.PORT || 3847;

const API_TOKEN = process.env.API_TOKEN;
if (!API_TOKEN) {
  console.error('FATAL: API_TOKEN environment variable is required. Set it in .env');
  process.exit(1);
}

const COMMAND_TIMEOUT = 30000;
// Scripts (updates, prunes, audits) routinely run for minutes; when the
// timeout hits, the local ssh is killed but the remote command keeps going
const SCRIPT_TIMEOUT = parseInt(process.env.SCRIPT_TIMEOUT_MS, 10) || 600000;

const CORS_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:5174,http://localhost:4173').split(',').map(s => s.trim());

const ALERT_THRESHOLDS = {
  cpu: 80,
  memory: 85,
  disk: 90
};

// Hysteresis: consecutive samples over threshold to open an alert /
// clean samples to resolve it (at METRICS_INTERVAL=15s: 30s / 1min)
const ALERT_SAMPLES_TO_OPEN = parseInt(process.env.ALERT_SAMPLES_TO_OPEN || '2');
const ALERT_SAMPLES_TO_RESOLVE = parseInt(process.env.ALERT_SAMPLES_TO_RESOLVE || '4');

// Optional: POST { event, alert, sentAt } here on open/resolve
const ALERT_WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL || '';

const METRICS_INTERVAL = 15000;
// Per-process/container detail is stored every Nth metrics cycle
// (~60s): nobody diagnoses at 15s granularity and it grows ~35x
// faster than the main series
const DETAIL_EVERY_CYCLES = Math.max(1, Math.round(60000 / METRICS_INTERVAL));
const PRUNE_INTERVAL = 24 * 60 * 60 * 1000;
const PRUNE_STARTUP_DELAY = 60 * 1000;
const ROLLUP_INTERVAL = 60 * 60 * 1000;
const ROLLUP_STARTUP_DELAY = 90 * 1000;
// Hourly aggregates are tiny (~26k rows/server/year) — keep a year of trends
const ROLLUP_KEEP_DAYS = parseInt(process.env.ROLLUP_KEEP_DAYS || '365');

// PostgreSQL sampling: one query per container per interval.
// ~288 samples/day per container; 90 days ≈ 26k container rows.
const PG_SAMPLE_INTERVAL = parseInt(process.env.PG_SAMPLE_INTERVAL_MIN || '5') * 60 * 1000;
const PG_SAMPLE_STARTUP_DELAY = 2 * 60 * 1000;
const PG_KEEP_DAYS = parseInt(process.env.PG_KEEP_DAYS || '90');
// Alert when connections exceed this fraction of max_connections
const PG_CONN_ALERT_PCT = parseInt(process.env.PG_CONN_ALERT_PCT || '80');
// Alert when a standby's replication lag exceeds this (critical at 4x)
const PG_REPL_LAG_ALERT_MB = parseInt(process.env.PG_REPL_LAG_ALERT_MB || '100');

// Explicit container -> role mapping for cases auto-detection can't
// guess (e.g. a role name that doesn't match the container name).
// JSON: {"pg-replica-foo": "foo_legacy_user"}
let PG_USER_OVERRIDES = {};
try {
  PG_USER_OVERRIDES = JSON.parse(process.env.PG_USER_OVERRIDES || '{}');
} catch (e) {
  console.error('Invalid PG_USER_OVERRIDES JSON, ignoring:', e.message);
}

// Slow checks (hourly): disk-full ETA alert and overdue-cron alert.
// Delayed past the first rollup so projections have data to work with.
const SLOW_CHECK_INTERVAL = 60 * 60 * 1000;
const SLOW_CHECK_STARTUP_DELAY = 3 * 60 * 1000;
const DISK_ETA_ALERT_DAYS = parseInt(process.env.DISK_ETA_ALERT_DAYS || '14');
// Open an ssl alert when a certificate expires within this many days
const SSL_ALERT_DAYS = parseInt(process.env.SSL_ALERT_DAYS || '14');
const PRUNE_KEEP_DAYS = parseInt(process.env.PRUNE_KEEP_DAYS || '30');
// Per-process/container detail is only useful for recent diagnosis and
// grows ~35x faster than metrics_history — keep it short
const DETAIL_KEEP_DAYS = parseInt(process.env.DETAIL_KEEP_DAYS || '3');

// ─── Server parsing ─────────────────────────────────────────────────

function parseServersFromEnv() {
  if (process.env.SERVERS_JSON) {
    try {
      return JSON.parse(process.env.SERVERS_JSON);
    } catch (e) {
      return {};
    }
  }
  const keys = (process.env.SERVER_KEYS || '').split(',').map(k => k.trim()).filter(Boolean);
  if (keys.length === 0) return {};
  const servers = {};
  for (const key of keys) {
    const prefix = `SERVER_${key.toUpperCase()}_`;
    servers[key] = {
      alias: process.env[`${prefix}ALIAS`] || key,
      ip: process.env[`${prefix}IP`] || '',
      port: parseInt(process.env[`${prefix}PORT`] || '22'),
      user: process.env[`${prefix}USER`] || '',
      displayName: process.env[`${prefix}DISPLAY_NAME`] || key,
    };
  }
  return servers;
}

function loadServersFromDB() {
  const rows = db.getServers();
  if (rows.length > 0) {
    const obj = {};
    for (const r of rows) {
      obj[r.key] = {
        alias: r.alias,
        ip: r.ip,
        port: r.port,
        user: r.user,
        displayName: r.display_name,
      };
    }
    return obj;
  }
  return null;
}

function seedServersFromEnv() {
  const envServers = parseServersFromEnv();
  for (const [key, svr] of Object.entries(envServers)) {
    db.createServer({
      key,
      displayName: svr.displayName,
      alias: svr.alias,
      ip: svr.ip,
      port: svr.port,
      user: svr.user,
    });
  }
  if (Object.keys(envServers).length > 0) {
    log(`Seeded ${Object.keys(envServers).length} servers from env vars into DB`);
  }
  return envServers;
}

module.exports = {
  PORT,
  API_TOKEN,
  COMMAND_TIMEOUT,
  SCRIPT_TIMEOUT,
  CORS_ORIGINS,
  ALERT_THRESHOLDS,
  ALERT_SAMPLES_TO_OPEN,
  ALERT_SAMPLES_TO_RESOLVE,
  ALERT_WEBHOOK_URL,
  METRICS_INTERVAL,
  DETAIL_EVERY_CYCLES,
  PRUNE_INTERVAL,
  PRUNE_STARTUP_DELAY,
  PRUNE_KEEP_DAYS,
  DETAIL_KEEP_DAYS,
  ROLLUP_INTERVAL,
  ROLLUP_STARTUP_DELAY,
  ROLLUP_KEEP_DAYS,
  SLOW_CHECK_INTERVAL,
  SLOW_CHECK_STARTUP_DELAY,
  DISK_ETA_ALERT_DAYS,
  SSL_ALERT_DAYS,
  PG_SAMPLE_INTERVAL,
  PG_SAMPLE_STARTUP_DELAY,
  PG_KEEP_DAYS,
  PG_CONN_ALERT_PCT,
  PG_REPL_LAG_ALERT_MB,
  PG_USER_OVERRIDES,
  parseServersFromEnv,
  loadServersFromDB,
  seedServersFromEnv,
};
