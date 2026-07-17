const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'monitor.db');
const HISTORY_FILE = path.join(DATA_DIR, 'metrics-history.json');

let db;

// ─── Default scripts (seed data) ────────────────────────────────────
const DEFAULT_SCRIPTS = [
  { id: 'docker-prune', name: 'Docker Prune', description: 'Remove unused Docker images and containers', command: 'docker system prune -af --volumes', destructive: 1, alertTypes: 'disk,disk-eta' },
  { id: 'clean-logs', name: 'Clean Logs', description: 'Clean up old log files and journal entries', command: "sudo find /var/log -name '*.gz' -delete && sudo journalctl --vacuum-time=7d", alertTypes: 'disk,disk-eta' },
  { id: 'security-scan', name: 'Security Scan', description: 'Run Lynis security audit', command: 'sudo lynis audit system --quick 2>&1 | tail -30' },
  { id: 'disk-usage', name: 'Disk Usage', description: 'Show disk usage summary, top directories, and Docker disk usage', command: 'echo "=== Disk Usage Summary ==="; df -h / | tail -1; echo; echo "=== Top 20 directories by size (/) ==="; sudo du -sh /* 2>/dev/null | sort -rh | head -20; echo; echo "=== Docker disk usage ==="; docker system df 2>/dev/null', alertTypes: 'disk,disk-eta,inodes' },
  { id: 'restart-nginx', name: 'Restart Nginx', description: 'Restart nginx web server', command: 'sudo systemctl restart nginx && sudo systemctl status nginx --no-pager' },
  { id: 'certbot-renew', name: 'Certbot Renew', description: 'Test certificate renewal', command: 'sudo certbot renew --dry-run', alertTypes: 'ssl' },
  { id: 'fail2ban-status', name: 'Fail2ban Status', description: 'Check fail2ban security status', command: 'sudo fail2ban-client status' },
  { id: 'docker-stats', name: 'Docker Stats', description: 'Show Docker container statistics', command: "docker stats --no-stream --format '{{json .}}'", alertTypes: 'cpu,memory,flapping' },
  { id: 'backup-db', name: 'Backup DB', description: 'Create database backup (edit command to match your setup)', command: 'echo "Configure your backup command in the dashboard"' },
  { id: 'check-updates', name: 'Check Updates', description: 'Check for available system updates', command: 'apt list --upgradable 2>/dev/null' },
  { id: 'apply-updates', name: 'Apply Updates', description: 'Apply all pending security and system updates (requires sudo)', command: 'sudo apt update && sudo apt upgrade -y && echo "---" && echo "Updates applied successfully" && if [ -f /var/run/reboot-required ]; then echo "*** REBOOT REQUIRED ***"; else echo "No reboot required"; fi', destructive: 1 },
  { id: 'safe-reboot', name: 'Safe Reboot', description: 'Sanity reboot: shows pre-reboot checklist then schedules reboot in 1 minute (requires sudo)', command: 'echo "=== Pre-reboot checklist ==="; echo; echo "Uptime:"; uptime; echo; echo "Running containers:"; docker ps --format "table {{.Names}}\\t{{.Status}}" 2>/dev/null; echo; echo "Pending updates requiring reboot:"; cat /var/run/reboot-required 2>/dev/null || echo "None"; cat /var/run/reboot-required.pkgs 2>/dev/null; echo; echo "=== Scheduling reboot in 1 minute ==="; sudo shutdown -r +1 "Scheduled reboot from dashboard" && echo "Reboot scheduled. Run: sudo shutdown -c to cancel."', destructive: 1 },
];

// Executions keep the tail of the output (errors usually print last)
const MAX_EXECUTION_OUTPUT = 50 * 1024;

function truncateOutput(output) {
  if (output == null) return null;
  const text = String(output);
  if (text.length <= MAX_EXECUTION_OUTPUT) return text;
  return `…[truncated, showing last ${MAX_EXECUTION_OUTPUT} chars]…\n` + text.slice(-MAX_EXECUTION_OUTPUT);
}

// ─── Init ────────────────────────────────────────────────────────────
function initDB() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Incremental auto_vacuum lets pruning return pages to the OS.
  // Enabling it on an existing DB requires a one-time full VACUUM.
  const autoVacuum = db.pragma('auto_vacuum', { simple: true });
  if (autoVacuum !== 2) {
    db.pragma('auto_vacuum = INCREMENTAL');
    console.log('[db] Enabling incremental auto_vacuum — running one-time VACUUM, this may take a while on a large DB...');
    const before = fs.statSync(DB_PATH).size;
    db.exec('VACUUM');
    const after = fs.statSync(DB_PATH).size;
    console.log(`[db] VACUUM done: ${(before / 1048576).toFixed(0)}MB -> ${(after / 1048576).toFixed(0)}MB`);
  }

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS scripts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      command TEXT NOT NULL,
      destructive INTEGER DEFAULT 0,
      schedule TEXT,
      schedule_servers TEXT DEFAULT '*',
      alert_types TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS metrics_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      cpu REAL DEFAULT 0,
      memory REAL DEFAULT 0,
      disk REAL DEFAULT 0,
      online INTEGER DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_metrics_server_ts ON metrics_history(server, timestamp);

    CREATE TABLE IF NOT EXISTS metrics_detail (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      cpu REAL DEFAULT 0,
      memory REAL DEFAULT 0,
      extra TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_detail_server_ts ON metrics_detail(server, timestamp);

    CREATE TABLE IF NOT EXISTS script_executions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      script_id TEXT,
      server TEXT NOT NULL,
      exit_code INTEGER,
      started_at TEXT DEFAULT (datetime('now')),
      duration_ms INTEGER,
      output TEXT,
      triggered_by TEXT DEFAULT 'manual'
    );
    CREATE INDEX IF NOT EXISTS idx_exec_server_ts ON script_executions(server, started_at);

    CREATE TABLE IF NOT EXISTS servers (
      key TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      alias TEXT NOT NULL,
      ip TEXT DEFAULT '',
      port INTEGER DEFAULT 22,
      user TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server TEXT NOT NULL,
      type TEXT NOT NULL,
      severity TEXT NOT NULL,
      message TEXT NOT NULL,
      value REAL,
      threshold REAL,
      started_at TEXT NOT NULL,
      resolved_at TEXT,
      acknowledged_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_alerts_started ON alerts(started_at);
    CREATE INDEX IF NOT EXISTS idx_alerts_open ON alerts(server, type) WHERE resolved_at IS NULL;

    CREATE TABLE IF NOT EXISTS thresholds (
      server TEXT PRIMARY KEY,
      cpu REAL,
      memory REAL,
      disk REAL,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pg_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server TEXT NOT NULL,
      container TEXT NOT NULL,
      datname TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      size_bytes INTEGER,
      connections INTEGER,
      max_connections INTEGER,
      cache_hit_ratio REAL,
      replication_lag_bytes INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_pg_history ON pg_history(server, container, datname, timestamp);

    CREATE TABLE IF NOT EXISTS metrics_rollup (
      server TEXT NOT NULL,
      bucket_start TEXT NOT NULL,
      cpu_avg REAL, cpu_max REAL,
      memory_avg REAL, memory_max REAL,
      disk_avg REAL, disk_max REAL,
      samples INTEGER DEFAULT 0,
      online_samples INTEGER DEFAULT 0,
      PRIMARY KEY (server, bucket_start)
    );
  `);

  // Column migrations for DBs created before these features existed
  const hasColumn = (table, col) =>
    db.prepare(`SELECT COUNT(*) AS c FROM pragma_table_info(?) WHERE name = ?`).get(table, col).c > 0;
  if (!hasColumn('script_executions', 'output')) {
    db.exec('ALTER TABLE script_executions ADD COLUMN output TEXT');
    console.log('[db] Migrated script_executions: added output column');
  }
  if (!hasColumn('scripts', 'destructive')) {
    db.exec('ALTER TABLE scripts ADD COLUMN destructive INTEGER DEFAULT 0');
    const seeded = DEFAULT_SCRIPTS.filter(s => s.destructive).map(s => s.id);
    db.prepare(
      `UPDATE scripts SET destructive = 1 WHERE id IN (${seeded.map(() => '?').join(',')})`
    ).run(...seeded);
    console.log('[db] Migrated scripts: added destructive column');
  }
  if (!hasColumn('scripts', 'schedule')) {
    db.exec("ALTER TABLE scripts ADD COLUMN schedule TEXT");
    db.exec("ALTER TABLE scripts ADD COLUMN schedule_servers TEXT DEFAULT '*'");
    console.log('[db] Migrated scripts: added schedule columns');
  }
  if (!hasColumn('scripts', 'alert_types')) {
    db.exec("ALTER TABLE scripts ADD COLUMN alert_types TEXT DEFAULT ''");
    const tagged = DEFAULT_SCRIPTS.filter(sc => sc.alertTypes);
    const upd = db.prepare('UPDATE scripts SET alert_types = ? WHERE id = ? AND command = ?');
    // Backfill only untouched seed scripts (same command as shipped)
    for (const sc of tagged) upd.run(sc.alertTypes, sc.id, sc.command);
    console.log('[db] Migrated scripts: added alert_types column');
  }
  if (!hasColumn('script_executions', 'triggered_by')) {
    db.exec("ALTER TABLE script_executions ADD COLUMN triggered_by TEXT DEFAULT 'manual'");
    console.log('[db] Migrated script_executions: added triggered_by column');
  }

  // Seed scripts if table is empty
  const count = db.prepare('SELECT COUNT(*) as c FROM scripts').get();
  if (count.c === 0) {
    const insert = db.prepare('INSERT INTO scripts (id, name, description, command, destructive, alert_types) VALUES (?, ?, ?, ?, ?, ?)');
    const insertMany = db.transaction((scripts) => {
      for (const s of scripts) {
        insert.run(s.id, s.name, s.description, s.command, s.destructive || 0, s.alertTypes || '');
      }
    });
    insertMany(DEFAULT_SCRIPTS);
    console.log(`[db] Seeded ${DEFAULT_SCRIPTS.length} default scripts`);
  }

  // Migrate JSON history if exists
  migrateJsonHistory();

  console.log(`[db] Database initialized at ${DB_PATH}`);
  return db;
}

function migrateJsonHistory() {
  if (!fs.existsSync(HISTORY_FILE)) return;

  try {
    const raw = fs.readFileSync(HISTORY_FILE, 'utf8');
    const history = JSON.parse(raw);
    let totalMigrated = 0;

    const insert = db.prepare(
      'INSERT INTO metrics_history (server, timestamp, cpu, memory, disk, online) VALUES (?, ?, ?, ?, ?, ?)'
    );

    const migrate = db.transaction(() => {
      for (const [server, entries] of Object.entries(history)) {
        if (!Array.isArray(entries)) continue;
        for (const e of entries) {
          insert.run(server, e.timestamp, e.cpu || 0, e.memory || 0, e.disk || 0, e.online ? 1 : 0);
          totalMigrated++;
        }
      }
    });

    migrate();
    console.log(`[db] Migrated ${totalMigrated} metric entries from JSON`);

    // Rename old file
    const bakPath = HISTORY_FILE + '.bak';
    fs.renameSync(HISTORY_FILE, bakPath);
    console.log(`[db] Renamed metrics-history.json to .bak`);
  } catch (e) {
    console.log(`[db] JSON migration failed: ${e.message}`);
  }
}

// ─── Scripts CRUD ────────────────────────────────────────────────────
function getScripts() {
  return db.prepare('SELECT * FROM scripts ORDER BY created_at').all();
}

function getScript(id) {
  return db.prepare('SELECT * FROM scripts WHERE id = ?').get(id);
}

function createScript({ id, name, description, command, destructive, schedule, scheduleServers, alertTypes }) {
  db.prepare(
    'INSERT INTO scripts (id, name, description, command, destructive, schedule, schedule_servers, alert_types) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, name, description || '', command, destructive ? 1 : 0, schedule || null, scheduleServers || '*', alertTypes || '');
  return getScript(id);
}

function updateScript(id, { name, description, command, destructive, schedule, scheduleServers, alertTypes }) {
  const fields = [];
  const values = [];
  if (name !== undefined) { fields.push('name = ?'); values.push(name); }
  if (description !== undefined) { fields.push('description = ?'); values.push(description); }
  if (command !== undefined) { fields.push('command = ?'); values.push(command); }
  if (destructive !== undefined) { fields.push('destructive = ?'); values.push(destructive ? 1 : 0); }
  if (schedule !== undefined) { fields.push('schedule = ?'); values.push(schedule || null); }
  if (scheduleServers !== undefined) { fields.push('schedule_servers = ?'); values.push(scheduleServers || '*'); }
  if (alertTypes !== undefined) { fields.push('alert_types = ?'); values.push(alertTypes || ''); }
  if (fields.length === 0) return getScript(id);

  fields.push("updated_at = datetime('now')");
  values.push(id);

  db.prepare(`UPDATE scripts SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getScript(id);
}

function deleteScript(id) {
  return db.prepare('DELETE FROM scripts WHERE id = ?').run(id);
}

// ─── Metrics ─────────────────────────────────────────────────────────
function appendMetric(server, entry) {
  db.prepare(
    'INSERT INTO metrics_history (server, timestamp, cpu, memory, disk, online) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(server, entry.timestamp, entry.cpu || 0, entry.memory || 0, entry.disk || 0, entry.online ? 1 : 0);
}

function getMetrics(server, since) {
  if (since) {
    return db.prepare(
      'SELECT timestamp, cpu, memory, disk, online FROM metrics_history WHERE server = ? AND timestamp >= ? ORDER BY timestamp'
    ).all(server, since);
  }
  return db.prepare(
    'SELECT timestamp, cpu, memory, disk, online FROM metrics_history WHERE server = ? ORDER BY timestamp'
  ).all(server);
}

// Raw samples averaged into N-second buckets — keeps chart payloads
// bounded regardless of range. Excludes offline (all-zero) samples from
// averages via the online flag on cpu/memory.
function getMetricsBucketed(server, since, bucketSeconds) {
  // CAST the bound param: better-sqlite3 binds JS numbers as REAL and
  // INTEGER / REAL would skip the floor that creates the buckets
  return db.prepare(`
    SELECT
      strftime('%Y-%m-%dT%H:%M:%SZ', (CAST(strftime('%s', timestamp) AS INTEGER) / CAST(? AS INTEGER)) * CAST(? AS INTEGER), 'unixepoch') AS timestamp,
      round(avg(cpu), 2) AS cpu,
      round(avg(memory), 2) AS memory,
      round(avg(disk), 2) AS disk,
      CASE WHEN avg(online) >= 0.5 THEN 1 ELSE 0 END AS online
    FROM metrics_history
    WHERE server = ? AND timestamp >= ?
    GROUP BY 1
    ORDER BY 1
  `).all(bucketSeconds, bucketSeconds, server, since);
}

// ─── PostgreSQL history ──────────────────────────────────────────────
// Rows with datname='' are container-level aggregates (total
// connections, max_connections, replication lag); per-db rows carry
// size and connections for that database.
function appendPgMetrics(rows) {
  const insert = db.prepare(`
    INSERT INTO pg_history (server, container, datname, timestamp, size_bytes, connections, max_connections, cache_hit_ratio, replication_lag_bytes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMany = db.transaction((items) => {
    for (const r of items) {
      insert.run(r.server, r.container, r.datname ?? '', r.timestamp,
        r.sizeBytes ?? null, r.connections ?? null, r.maxConnections ?? null,
        r.cacheHitRatio ?? null, r.replicationLagBytes ?? null);
    }
  });
  insertMany(rows);
}

// Container-level series; bucketSeconds averages samples for long ranges
function getPgHistory(server, container, since, bucketSeconds = null) {
  if (bucketSeconds) {
    return db.prepare(`
      SELECT
        strftime('%Y-%m-%dT%H:%M:%SZ', (CAST(strftime('%s', timestamp) AS INTEGER) / CAST(? AS INTEGER)) * CAST(? AS INTEGER), 'unixepoch') AS timestamp,
        CAST(round(avg(connections)) AS INTEGER) AS connections,
        max(max_connections) AS max_connections,
        CAST(round(avg(size_bytes)) AS INTEGER) AS size_bytes,
        round(avg(cache_hit_ratio), 2) AS cache_hit_ratio,
        CAST(round(avg(replication_lag_bytes)) AS INTEGER) AS replication_lag_bytes
      FROM pg_history
      WHERE server = ? AND container = ? AND datname = '' AND timestamp >= ?
      GROUP BY 1
      ORDER BY 1
    `).all(bucketSeconds, bucketSeconds, server, container, since);
  }
  return db.prepare(`
    SELECT timestamp, connections, max_connections, size_bytes, cache_hit_ratio, replication_lag_bytes
    FROM pg_history
    WHERE server = ? AND container = ? AND datname = '' AND timestamp >= ?
    ORDER BY timestamp
  `).all(server, container, since);
}

function prunePgHistory(keepDays) {
  const cutoff = new Date(Date.now() - keepDays * 24 * 60 * 60 * 1000).toISOString();
  return db.prepare('DELETE FROM pg_history WHERE timestamp < ?').run(cutoff);
}

// ─── Hourly rollups ─────────────────────────────────────────────────
// Idempotent: re-aggregates every hour present in raw history and
// upserts, so it can run at any cadence and backfills automatically.
function rollupHourly() {
  const result = db.prepare(`
    INSERT INTO metrics_rollup (server, bucket_start, cpu_avg, cpu_max, memory_avg, memory_max, disk_avg, disk_max, samples, online_samples)
    SELECT
      server,
      strftime('%Y-%m-%dT%H:00:00Z', timestamp) AS bucket_start,
      round(avg(cpu), 2), round(max(cpu), 2),
      round(avg(memory), 2), round(max(memory), 2),
      round(avg(disk), 2), round(max(disk), 2),
      count(*), sum(online)
    FROM metrics_history
    GROUP BY server, bucket_start
    ON CONFLICT(server, bucket_start) DO UPDATE SET
      cpu_avg = excluded.cpu_avg, cpu_max = excluded.cpu_max,
      memory_avg = excluded.memory_avg, memory_max = excluded.memory_max,
      disk_avg = excluded.disk_avg, disk_max = excluded.disk_max,
      samples = excluded.samples, online_samples = excluded.online_samples
  `).run();
  return { upserted: result.changes };
}

function getRollup(server, since, bucketSeconds = 3600) {
  return db.prepare(`
    SELECT
      strftime('%Y-%m-%dT%H:%M:%SZ', (CAST(strftime('%s', bucket_start) AS INTEGER) / CAST(? AS INTEGER)) * CAST(? AS INTEGER), 'unixepoch') AS timestamp,
      round(avg(cpu_avg), 2) AS cpu,
      round(avg(memory_avg), 2) AS memory,
      round(avg(disk_avg), 2) AS disk,
      CASE WHEN sum(online_samples) * 2 >= sum(samples) THEN 1 ELSE 0 END AS online
    FROM metrics_rollup
    WHERE server = ? AND bucket_start >= ?
    GROUP BY 1
    ORDER BY 1
  `).all(bucketSeconds, bucketSeconds, server, since);
}

function pruneRollup(keepDays) {
  const cutoff = new Date(Date.now() - keepDays * 24 * 60 * 60 * 1000).toISOString();
  return db.prepare('DELETE FROM metrics_rollup WHERE bucket_start < ?').run(cutoff);
}

function pruneOldMetrics(keepDays, detailKeepDays = keepDays) {
  const cutoff = new Date(Date.now() - keepDays * 24 * 60 * 60 * 1000).toISOString();
  const detailCutoff = new Date(Date.now() - detailKeepDays * 24 * 60 * 60 * 1000).toISOString();
  const metricsResult = db.prepare('DELETE FROM metrics_history WHERE timestamp < ?').run(cutoff);
  const detailResult = db.prepare('DELETE FROM metrics_detail WHERE timestamp < ?').run(detailCutoff);
  // Return freed pages to the OS (no-op if nothing was deleted)
  db.pragma('incremental_vacuum');
  return { metricsDeleted: metricsResult.changes, detailsDeleted: detailResult.changes };
}

// ─── Metrics Detail ──────────────────────────────────────────────────
function appendMetricDetails(server, timestamp, details) {
  const insert = db.prepare(
    'INSERT INTO metrics_detail (server, timestamp, type, name, cpu, memory, extra) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const insertMany = db.transaction((items) => {
    for (const d of items) {
      insert.run(server, timestamp, d.type, d.name, d.cpu || 0, d.memory || 0, d.extra ? JSON.stringify(d.extra) : null);
    }
  });
  insertMany(details);
}

// Nearest detail timestamp at or after ts, within windowSeconds — lets
// the drill-down work when the chart shows bucketed/rolled-up points
function findDetailTimestamp(server, timestamp, windowSeconds) {
  const end = new Date(new Date(timestamp).getTime() + windowSeconds * 1000).toISOString();
  const row = db.prepare(
    'SELECT timestamp FROM metrics_detail WHERE server = ? AND timestamp >= ? AND timestamp <= ? ORDER BY timestamp LIMIT 1'
  ).get(server, timestamp, end);
  return row ? row.timestamp : null;
}

function getMetricDetails(server, timestamp) {
  return db.prepare(
    'SELECT type, name, cpu, memory, extra FROM metrics_detail WHERE server = ? AND timestamp = ?'
  ).all(server, timestamp).map(row => ({
    ...row,
    extra: row.extra ? JSON.parse(row.extra) : null,
  }));
}

// ─── Script Executions ───────────────────────────────────────────────
function logExecution({ scriptId, server, exitCode, startedAt, durationMs, output, triggeredBy }) {
  db.prepare(
    'INSERT INTO script_executions (script_id, server, exit_code, started_at, duration_ms, output, triggered_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(scriptId, server, exitCode, startedAt || new Date().toISOString(), durationMs || 0, truncateOutput(output), triggeredBy || 'manual');
}

// Listing omits the (potentially large) output; fetch it per-row with
// getExecution(id). output_bytes lets the UI show an expand affordance.
const EXECUTION_LIST_COLS =
  'id, script_id, server, exit_code, started_at, duration_ms, triggered_by, LENGTH(output) AS output_bytes';

function getExecutions(server, limit = 50, scriptId = null) {
  const where = [];
  const params = [];
  if (server) { where.push('server = ?'); params.push(server); }
  if (scriptId) { where.push('script_id = ?'); params.push(scriptId); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return db.prepare(
    `SELECT ${EXECUTION_LIST_COLS} FROM script_executions ${whereSql} ORDER BY started_at DESC, id DESC LIMIT ?`
  ).all(...params, limit);
}

function getExecution(id) {
  return db.prepare('SELECT * FROM script_executions WHERE id = ?').get(id);
}

// Latest scheduled run per (server, script) — drives the script-failed alert
function getLastScheduledExecutions() {
  return db.prepare(`
    SELECT server, script_id, exit_code, started_at FROM (
      SELECT server, script_id, exit_code, started_at,
             ROW_NUMBER() OVER (PARTITION BY server, script_id ORDER BY started_at DESC, id DESC) AS rn
      FROM script_executions WHERE triggered_by = 'schedule'
    ) WHERE rn = 1
  `).all();
}

// Latest execution per script on a server — powers the last-run badges
function getLatestExecutions(server) {
  return db.prepare(`
    SELECT ${EXECUTION_LIST_COLS} FROM (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY script_id ORDER BY started_at DESC, id DESC) AS rn
      FROM script_executions WHERE server = ?
    ) WHERE rn = 1
  `).all(server);
}

// ─── Servers CRUD ────────────────────────────────────────────────
function getServers() {
  return db.prepare('SELECT * FROM servers ORDER BY created_at').all();
}

function getServer(key) {
  return db.prepare('SELECT * FROM servers WHERE key = ?').get(key);
}

function createServer({ key, displayName, alias, ip, port, user }) {
  db.prepare(
    'INSERT INTO servers (key, display_name, alias, ip, port, user) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(key, displayName, alias || key, ip || '', port || 22, user || '');
  return getServer(key);
}

function updateServer(key, { displayName, alias, ip, port, user }) {
  const fields = [];
  const values = [];
  if (displayName !== undefined) { fields.push('display_name = ?'); values.push(displayName); }
  if (alias !== undefined) { fields.push('alias = ?'); values.push(alias); }
  if (ip !== undefined) { fields.push('ip = ?'); values.push(ip); }
  if (port !== undefined) { fields.push('port = ?'); values.push(port); }
  if (user !== undefined) { fields.push('user = ?'); values.push(user); }
  if (fields.length === 0) return getServer(key);

  fields.push("updated_at = datetime('now')");
  values.push(key);

  db.prepare(`UPDATE servers SET ${fields.join(', ')} WHERE key = ?`).run(...values);
  return getServer(key);
}

function deleteServer(key) {
  return db.prepare('DELETE FROM servers WHERE key = ?').run(key);
}

function getServerCount() {
  return db.prepare('SELECT COUNT(*) as c FROM servers').get().c;
}

// ─── Alerts ──────────────────────────────────────────────────────────
function openAlert({ server, type, severity, message, value, threshold }) {
  const result = db.prepare(
    'INSERT INTO alerts (server, type, severity, message, value, threshold, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(server, type, severity, message, value ?? null, threshold ?? null, new Date().toISOString());
  return getAlert(result.lastInsertRowid);
}

function getAlert(id) {
  return db.prepare('SELECT * FROM alerts WHERE id = ?').get(id);
}

function getOpenAlert(server, type) {
  return db.prepare(
    'SELECT * FROM alerts WHERE server = ? AND type = ? AND resolved_at IS NULL ORDER BY started_at DESC LIMIT 1'
  ).get(server, type);
}

// Track the peak observed value while the alert is open
function updateAlertPeak(id, value) {
  if (value == null) return;
  db.prepare(
    'UPDATE alerts SET value = ? WHERE id = ? AND (value IS NULL OR value < ?)'
  ).run(value, id, value);
}

function resolveAlert(id) {
  db.prepare('UPDATE alerts SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL')
    .run(new Date().toISOString(), id);
  return getAlert(id);
}

function acknowledgeAlert(id) {
  db.prepare('UPDATE alerts SET acknowledged_at = ? WHERE id = ? AND acknowledged_at IS NULL')
    .run(new Date().toISOString(), id);
  return getAlert(id);
}

function getAlerts({ activeOnly = false, limit = 100 } = {}) {
  if (activeOnly) {
    return db.prepare(
      'SELECT * FROM alerts WHERE resolved_at IS NULL ORDER BY started_at DESC LIMIT ?'
    ).all(limit);
  }
  // Active first, then most recent resolved
  return db.prepare(
    'SELECT * FROM alerts ORDER BY (resolved_at IS NULL) DESC, started_at DESC LIMIT ?'
  ).all(limit);
}

// ─── Thresholds ──────────────────────────────────────────────────────
// Rows keyed by server key; the row 'default' is the global override.
// NULL columns mean "inherit from the next level up".
function getThreshold(server) {
  return db.prepare('SELECT server, cpu, memory, disk FROM thresholds WHERE server = ?').get(server);
}

function getAllThresholds() {
  return db.prepare('SELECT server, cpu, memory, disk FROM thresholds').all();
}

function setThreshold(server, { cpu, memory, disk }) {
  db.prepare(`
    INSERT INTO thresholds (server, cpu, memory, disk, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(server) DO UPDATE SET cpu = excluded.cpu, memory = excluded.memory,
      disk = excluded.disk, updated_at = datetime('now')
  `).run(server, cpu ?? null, memory ?? null, disk ?? null);
  return getThreshold(server);
}

function deleteThreshold(server) {
  return db.prepare('DELETE FROM thresholds WHERE server = ?').run(server);
}

// ─── Close ───────────────────────────────────────────────────────────
function closeDB() {
  if (db) db.close();
}

module.exports = {
  initDB,
  closeDB,
  // Scripts
  getScripts,
  getScript,
  createScript,
  updateScript,
  deleteScript,
  // Metrics
  appendMetric,
  getMetrics,
  getMetricsBucketed,
  pruneOldMetrics,
  // Rollups
  rollupHourly,
  getRollup,
  pruneRollup,
  // PostgreSQL history
  appendPgMetrics,
  getPgHistory,
  prunePgHistory,
  // Detail
  appendMetricDetails,
  getMetricDetails,
  findDetailTimestamp,
  // Executions
  logExecution,
  getExecutions,
  getExecution,
  getLatestExecutions,
  getLastScheduledExecutions,
  truncateOutput,
  // Alerts
  openAlert,
  getAlert,
  getOpenAlert,
  updateAlertPeak,
  resolveAlert,
  acknowledgeAlert,
  getAlerts,
  // Thresholds
  getThreshold,
  getAllThresholds,
  setThreshold,
  deleteThreshold,
  // Servers
  getServers,
  getServer,
  createServer,
  updateServer,
  deleteServer,
  getServerCount,
};
