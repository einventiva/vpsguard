const db = require('./db');
const { log } = require('./services/logger');

const PORT = process.env.PORT || 3847;

const API_TOKEN = process.env.API_TOKEN;
if (!API_TOKEN) {
  console.error('FATAL: API_TOKEN environment variable is required. Set it in .env');
  process.exit(1);
}

const COMMAND_TIMEOUT = 30000;
const SCRIPT_TIMEOUT = 60000;

const CORS_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:4173').split(',').map(s => s.trim());

const ALERT_THRESHOLDS = {
  cpu: 80,
  memory: 85,
  disk: 90
};

const METRICS_INTERVAL = 15000;
const PRUNE_INTERVAL = 24 * 60 * 60 * 1000;
const PRUNE_KEEP_DAYS = 30;

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
  METRICS_INTERVAL,
  PRUNE_INTERVAL,
  PRUNE_KEEP_DAYS,
  parseServersFromEnv,
  loadServersFromDB,
  seedServersFromEnv,
};
