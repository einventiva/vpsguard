const express = require('express');
const { log, handleError } = require('../services/logger');
const { getCached, setCache } = require('../services/cache');
const { executeSSHCommand } = require('../services/ssh');
const { parseDockerPsOutput, parseLogs } = require('../services/metrics');

function createRouter(getServers) {
  const router = express.Router();

  // Docker containers (cached 15s)
  router.get('/docker/:server', async (req, res) => {
    try {
      const { server: serverKey } = req.params;
      const SERVERS = getServers();
      log('GET /api/docker/:server requested', { server: serverKey });

      if (!SERVERS[serverKey]) {
        return res.status(404).json({ error: `Server '${serverKey}' not found` });
      }

      const cacheKey = `docker-${serverKey}`;
      const cached = getCached(cacheKey);
      if (cached) {
        return res.json(cached);
      }

      const serverConfig = SERVERS[serverKey];
      const command = 'docker ps --format \'{{json .}}\'; echo "---STATS---"; docker stats --no-stream --format \'{{json .}}\' 2>/dev/null';
      const output = await executeSSHCommand(serverConfig.alias, command);
      const [psOutput, statsOutput] = output.split('---STATS---');
      const containers = parseDockerPsOutput(psOutput || '');

      const statsMap = {};
      if (statsOutput) {
        for (const line of statsOutput.trim().split('\n')) {
          if (!line.trim()) continue;
          try {
            const stat = JSON.parse(line);
            statsMap[stat.Name] = stat;
          } catch (_) {}
        }
      }
      for (const c of containers) {
        const stat = statsMap[c.Names ? c.Names.replace(/^\//, '') : ''];
        if (stat) {
          c.CPUPerc = stat.CPUPerc || '0%';
          c.MemUsage = stat.MemUsage || '';
          c.MemPerc = stat.MemPerc || '0%';
          c.BlockIO = stat.BlockIO || '';
          c.NetIO = stat.NetIO || '';
        }
      }

      const result = {
        server: serverKey,
        name: serverConfig.displayName,
        timestamp: new Date().toISOString(),
        count: containers.length,
        containers
      };

      setCache(cacheKey, result, 15000);
      res.json(result);
    } catch (error) {
      handleError(res, error, `Failed to retrieve docker containers for server '${req.params.server}'`);
    }
  });

  // Container logs
  router.get('/docker/:server/:container/logs', async (req, res) => {
    try {
      const { server: serverKey, container } = req.params;
      const SERVERS = getServers();
      log('GET /api/docker/:server/:container/logs requested', { server: serverKey, container });

      if (!SERVERS[serverKey]) {
        return res.status(404).json({ error: `Server '${serverKey}' not found` });
      }

      if (!/^[a-zA-Z0-9_.-]+$/.test(container)) {
        return res.status(400).json({ error: 'Invalid container name' });
      }

      const serverConfig = SERVERS[serverKey];
      const command = `docker logs --tail 100 ${container}`;
      const output = await executeSSHCommand(serverConfig.alias, command);
      const logs = parseLogs(output);

      res.json({
        server: serverKey,
        container,
        timestamp: new Date().toISOString(),
        lineCount: logs.length,
        logs
      });
    } catch (error) {
      handleError(res, error, `Failed to retrieve logs for container '${req.params.container}'`);
    }
  });

  return router;
}

module.exports = createRouter;
