require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server: SocketIOServer } = require('socket.io');
const db = require('./db');
const { PORT, CORS_ORIGINS, loadServersFromDB, seedServersFromEnv } = require('./config');
const { log } = require('./services/logger');
const { handleError } = require('./services/logger');
const { httpAuth, socketAuth } = require('./middleware/auth');
const { registerHandlers } = require('./websocket/handlers');
const { startMetricsLoop, startPruneLoop } = require('./services/backgroundJobs');

// ─── Express + HTTP Server ──────────────────────────────────────────
const app = express();
const server = http.createServer(app);

app.use(cors({ origin: CORS_ORIGINS, credentials: true }));
app.use(express.json());
app.use('/api', httpAuth);

// ─── Shared state ───────────────────────────────────────────────────
let SERVERS = {};
const getServers = () => SERVERS;
const setServers = (s) => { SERVERS = s; };

// ─── Socket.IO ──────────────────────────────────────────────────────
const io = new SocketIOServer(server, {
  cors: { origin: CORS_ORIGINS, credentials: true }
});
io.use(socketAuth);
registerHandlers(io, getServers);

// ─── Routes ─────────────────────────────────────────────────────────
app.use('/api', require('./routes/health')(getServers));
app.use('/api', require('./routes/status')(getServers));
app.use('/api', require('./routes/docker')(getServers));
app.use('/api', require('./routes/scripts')(getServers));
app.use('/api', require('./routes/servers')(getServers, setServers));
app.use('/api', require('./routes/crontab')(getServers));
app.use('/api', require('./routes/history')(getServers));

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    path: req.path,
    method: req.method,
    availableEndpoints: {
      'GET /api/health': 'Health check',
      'GET /api/status': 'System metrics for all servers',
      'GET /api/docker/:server': 'Docker containers for a server',
      'GET /api/docker/:server/:container/logs': 'Logs for a container',
      'POST /api/execute/:server': 'Execute a predefined script',
      'GET /api/scripts': 'List scripts',
      'POST /api/scripts': 'Create script',
      'PUT /api/scripts/:id': 'Update script',
      'DELETE /api/scripts/:id': 'Delete script',
      'GET /api/history/:server': 'Metrics history for a server',
      'GET /api/history/:server/detail?ts=TIMESTAMP': 'Metric detail (drill-down)',
      'GET /api/executions': 'Script execution history',
      'GET /api/crontab/:server': 'List cron jobs',
      'POST /api/crontab/:server': 'Add cron job',
      'PUT /api/crontab/:server/:index': 'Edit cron job',
      'DELETE /api/crontab/:server/:index': 'Delete cron job',
      'PATCH /api/crontab/:server/:index/toggle': 'Toggle cron job',
      'GET /api/servers': 'List servers',
      'POST /api/servers': 'Create server',
      'PUT /api/servers/:key': 'Update server',
      'DELETE /api/servers/:key': 'Delete server',
      'POST /api/servers/:key/test': 'Test SSH connection'
    }
  });
});

// Global error handler
app.use((err, req, res, next) => {
  log('Global error handler triggered', { error: err.message });
  handleError(res, err, 'Internal server error', 500);
});

// ─── Start ──────────────────────────────────────────────────────────
db.initDB();

const dbServers = loadServersFromDB();
if (dbServers) {
  SERVERS = dbServers;
  log(`Loaded ${Object.keys(SERVERS).length} servers from DB`);
} else {
  SERVERS = seedServersFromEnv();
  log(`Seeded servers from env vars, total: ${Object.keys(SERVERS).length}`);
}

startMetricsLoop(io, getServers);
startPruneLoop();

server.listen(PORT, () => {
  log(`Server started on http://localhost:${PORT}`);
  log(`CORS origins:`, { origins: CORS_ORIGINS });
  log(`Available servers:`, { servers: Object.keys(SERVERS).map(k => `${k}: ${SERVERS[k].displayName}`) });
  log(`Scripts from SQLite:`, { count: db.getScripts().length });
  log(`WebSocket enabled`);
  log(`Auth required (Bearer token)`);
});

// Graceful shutdown
function shutdown(signal) {
  log(`${signal} received, shutting down`);
  db.closeDB();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = { app, server };
