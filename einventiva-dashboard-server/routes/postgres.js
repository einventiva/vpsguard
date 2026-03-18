const express = require('express');
const { log, handleError } = require('../services/logger');
const { getCached, setCache } = require('../services/cache');
const { executeSSHCommand, filterWarnings } = require('../services/ssh');

// Detect the postgres user for a container via POSTGRES_USER env var
async function detectPgUser(alias, containerName) {
  try {
    const raw = await executeSSHCommand(
      alias,
      `docker exec ${containerName} printenv POSTGRES_USER 2>/dev/null || echo postgres`,
      5000
    );
    const user = filterWarnings(raw).trim().split('\n').pop().trim();
    return user || 'postgres';
  } catch (_) {
    return 'postgres';
  }
}

// Clean SSH output: remove warnings, keep only data lines
function cleanOutput(raw) {
  return filterWarnings(raw);
}

// Build a shell command that base64-encodes the SQL to avoid all quoting/escaping issues
function psqlViaB64(container, pgUser, sql, dbName = 'postgres') {
  const b64 = Buffer.from(sql).toString('base64');
  return `echo ${b64} | base64 -d | docker exec -i ${container} psql -U ${pgUser} -d ${dbName} -t -A`;
}

function createRouter(getServers) {
  const router = express.Router();

  // Basic PostgreSQL info (cached 30s)
  router.get('/postgres/:server', async (req, res) => {
    try {
      const { server: serverKey } = req.params;
      const SERVERS = getServers();
      log('GET /api/postgres/:server requested', { server: serverKey });

      if (!SERVERS[serverKey]) {
        return res.status(404).json({ error: `Server '${serverKey}' not found` });
      }

      const cacheKey = `postgres-${serverKey}`;
      const cached = getCached(cacheKey);
      if (cached) return res.json(cached);

      const serverConfig = SERVERS[serverKey];

      // Detect postgres containers
      const psOutput = await executeSSHCommand(
        serverConfig.alias,
        "docker ps --format '{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}' 2>/dev/null | grep -i postgres"
      ).catch(() => '');

      if (!psOutput.trim()) {
        const result = { server: serverKey, timestamp: new Date().toISOString(), containers: [] };
        setCache(cacheKey, result, 30000);
        return res.json(result);
      }

      const rawContainers = psOutput.trim().split('\n').filter(Boolean).map(line => {
        const [id, name, image, ...statusParts] = line.split('|');
        return { id: id.trim(), name: name.trim(), image: image.trim(), status: statusParts.join('|').trim() };
      });

      // Query each container for basic db info + version
      const containers = await Promise.allSettled(
        rawContainers.map(async (c) => {
          try {
            const pgUser = await detectPgUser(serverConfig.alias, c.name);
            const sql = "SELECT json_agg(row_to_json(t)) FROM (SELECT datname, pg_database_size(datname) as size_bytes, numbackends as active_connections FROM pg_stat_database WHERE datname NOT LIKE 'template%') t;\nSELECT version();";
            const raw = await executeSSHCommand(
              serverConfig.alias,
              psqlViaB64(c.name, pgUser, sql),
              15000
            );
            const output = cleanOutput(raw);
            const lines = output.trim().split('\n').filter(Boolean);
            let databases = [];
            let version = '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
                try {
                  const parsed = JSON.parse(trimmed);
                  databases = (Array.isArray(parsed) ? parsed : [parsed]).map(db => ({
                    name: db.datname,
                    sizeBytes: Number(db.size_bytes) || 0,
                    activeConnections: Number(db.active_connections) || 0,
                  }));
                } catch (_) {}
              } else if (trimmed.toLowerCase().startsWith('postgresql')) {
                version = trimmed;
              }
            }

            return { ...c, version, databases, error: null };
          } catch (err) {
            return { ...c, version: '', databases: [], error: err.message || 'Failed to query PostgreSQL' };
          }
        })
      );

      const result = {
        server: serverKey,
        timestamp: new Date().toISOString(),
        containers: containers.map(r => r.status === 'fulfilled' ? r.value : r.reason),
      };

      setCache(cacheKey, result, 30000);
      res.json(result);
    } catch (error) {
      handleError(res, error, `Failed to retrieve PostgreSQL info for server '${req.params.server}'`);
    }
  });

  // Detailed PostgreSQL stats (cached 60s, timeout 30s)
  router.get('/postgres/:server/detailed', async (req, res) => {
    try {
      const { server: serverKey } = req.params;
      const { container, db } = req.query;
      const SERVERS = getServers();
      const dbName = db || 'postgres';
      log('GET /api/postgres/:server/detailed requested', { server: serverKey, container, db: dbName });

      if (!SERVERS[serverKey]) {
        return res.status(404).json({ error: `Server '${serverKey}' not found` });
      }

      if (!container || !/^[a-zA-Z0-9_.-]+$/.test(container)) {
        return res.status(400).json({ error: 'Invalid or missing container name' });
      }

      if (!/^[a-zA-Z0-9_.-]+$/.test(dbName)) {
        return res.status(400).json({ error: 'Invalid database name' });
      }

      const cacheKey = `postgres-detailed-${serverKey}-${container}-${dbName}`;
      const cached = getCached(cacheKey);
      if (cached) return res.json(cached);

      const serverConfig = SERVERS[serverKey];

      const pgUser = await detectPgUser(serverConfig.alias, container);

      // Queries that are DB-specific (tables) connect to the selected DB
      // Global stats (cache hit, queries, locks, replication) connect to postgres
      const queries = [
        { key: 'cacheHit', db: 'postgres', sql: "SELECT json_agg(row_to_json(t)) FROM (SELECT datname, blks_hit, blks_read, CASE WHEN (blks_hit + blks_read) > 0 THEN round(blks_hit::numeric / (blks_hit + blks_read) * 100, 2) ELSE 0 END as cache_hit_ratio FROM pg_stat_database WHERE datname NOT LIKE 'template%') t;" },
        { key: 'tables', db: dbName, sql: "SELECT json_agg(row_to_json(t)) FROM (SELECT schemaname || chr(46) || relname as tbl, pg_total_relation_size(relid) as total_size, n_live_tup as live_rows, n_dead_tup as dead_rows, last_vacuum::text, last_autovacuum::text FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 20) t;" },
        { key: 'activeQueries', db: 'postgres', sql: "SELECT json_agg(row_to_json(t)) FROM (SELECT pid, datname, usename, state, left(query, 200) as query, EXTRACT(EPOCH FROM (now() - query_start))::int as duration FROM pg_stat_activity WHERE state IS NOT NULL AND pid <> pg_backend_pid() ORDER BY query_start ASC) t;" },
        { key: 'locks', db: 'postgres', sql: "SELECT json_agg(row_to_json(t)) FROM (SELECT locktype, mode, granted, pid, COALESCE(relation::regclass::text, '-') as relation FROM pg_locks WHERE NOT granted) t;" },
        { key: 'replication', db: 'postgres', sql: "SELECT json_agg(row_to_json(t)) FROM (SELECT client_addr::text, state, sent_lsn::text, write_lsn::text, replay_lsn::text, sync_state FROM pg_stat_replication) t;" },
      ];

      const sections = {};
      await Promise.allSettled(
        queries.map(async ({ key, sql, db: queryDb }) => {
          try {
            const raw = await executeSSHCommand(
              serverConfig.alias,
              psqlViaB64(container, pgUser, sql, queryDb),
              20000
            );
            const output = cleanOutput(raw).trim();
            log(`Postgres detailed query ok`, { key, len: output.length });
            if (output && output !== '' && output !== 'null') {
              const parsed = JSON.parse(output);
              sections[key] = Array.isArray(parsed) ? parsed : [parsed];
            }
          } catch (err) {
            log(`Postgres detailed query failed`, { key, container, db: queryDb, error: err.message?.substring(0, 300) });
          }
        })
      );
      const result = {
        server: serverKey,
        container,
        db: dbName,
        timestamp: new Date().toISOString(),
        cacheHit: (sections.cacheHit || []).map(r => ({
          datname: r.datname,
          blks_hit: Number(r.blks_hit) || 0,
          blks_read: Number(r.blks_read) || 0,
          cache_hit_ratio: Number(r.cache_hit_ratio) || 0,
        })),
        tables: (sections.tables || []).map(r => ({
          table: r.tbl || r.table,
          total_size: Number(r.total_size) || 0,
          live_rows: Number(r.live_rows) || 0,
          dead_rows: Number(r.dead_rows) || 0,
          last_vacuum: r.last_vacuum || null,
          last_autovacuum: r.last_autovacuum || null,
        })),
        activeQueries: (sections.activeQueries || []).map(r => ({
          pid: r.pid,
          datname: r.datname,
          usename: r.usename,
          state: r.state,
          query: r.query,
          duration: Number(r.duration) || 0,
        })),
        locks: (sections.locks || []).map(r => ({
          locktype: r.locktype,
          mode: r.mode,
          granted: r.granted,
          pid: r.pid,
          relation: r.relation || '',
        })),
        replication: (sections.replication || []).map(r => ({
          client_addr: r.client_addr,
          state: r.state,
          sent_lsn: r.sent_lsn,
          write_lsn: r.write_lsn,
          replay_lsn: r.replay_lsn,
          sync_state: r.sync_state,
        })),
      };

      setCache(cacheKey, result, 60000);
      res.json(result);
    } catch (error) {
      handleError(res, error, `Failed to retrieve detailed PostgreSQL stats for '${req.params.server}'`);
    }
  });

  return router;
}

module.exports = createRouter;
