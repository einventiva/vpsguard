const express = require('express');
const db = require('../db');
const { log, handleError } = require('../services/logger');
const { executeSSHCommand } = require('../services/ssh');

function createRouter(getServers, setServers) {
  const router = express.Router();

  // List servers
  router.get('/servers', (req, res) => {
    const SERVERS = getServers();
    const info = {};
    for (const [key, svr] of Object.entries(SERVERS)) {
      info[key] = {
        displayName: svr.displayName,
        user: svr.user,
        ip: svr.ip,
        port: svr.port,
        alias: svr.alias,
      };
    }
    res.json(info);
  });

  // Create server
  router.post('/servers', (req, res) => {
    try {
      const { key, displayName, alias, ip, port, user } = req.body;
      if (!key || !displayName || !alias) {
        return res.status(400).json({ error: 'key, displayName, and alias are required' });
      }
      if (!/^[a-zA-Z0-9_-]+$/.test(key)) {
        return res.status(400).json({ error: 'key must be alphanumeric (hyphens and underscores allowed)' });
      }
      if (db.getServer(key)) {
        return res.status(409).json({ error: `Server '${key}' already exists` });
      }
      const server = db.createServer({ key, displayName, alias, ip: ip || '', port: port || 22, user: user || '' });
      const SERVERS = getServers();
      SERVERS[key] = {
        alias: server.alias,
        ip: server.ip,
        port: server.port,
        user: server.user,
        displayName: server.display_name,
      };
      log('Server created', { key });
      res.status(201).json(server);
    } catch (error) {
      handleError(res, error, 'Failed to create server');
    }
  });

  // Update server
  router.put('/servers/:key', (req, res) => {
    try {
      const { key } = req.params;
      if (!db.getServer(key)) {
        return res.status(404).json({ error: `Server '${key}' not found` });
      }
      const { displayName, alias, ip, port, user } = req.body;
      const updated = db.updateServer(key, { displayName, alias, ip, port, user });
      const SERVERS = getServers();
      SERVERS[key] = {
        alias: updated.alias,
        ip: updated.ip,
        port: updated.port,
        user: updated.user,
        displayName: updated.display_name,
      };
      log('Server updated', { key });
      res.json(updated);
    } catch (error) {
      handleError(res, error, `Failed to update server '${req.params.key}'`);
    }
  });

  // Delete server
  router.delete('/servers/:key', (req, res) => {
    try {
      const { key } = req.params;
      if (!db.getServer(key)) {
        return res.status(404).json({ error: `Server '${key}' not found` });
      }
      db.deleteServer(key);
      const SERVERS = getServers();
      delete SERVERS[key];
      log('Server deleted', { key });
      res.json({ success: true, key });
    } catch (error) {
      handleError(res, error, `Failed to delete server '${req.params.key}'`);
    }
  });

  // Test SSH connection
  router.post('/servers/:key/test', async (req, res) => {
    try {
      const { key } = req.params;
      const SERVERS = getServers();
      if (!SERVERS[key]) {
        return res.status(404).json({ error: `Server '${key}' not found` });
      }
      const serverConfig = SERVERS[key];
      const output = await executeSSHCommand(serverConfig.alias, 'echo ok', 10000);
      res.json({ success: true, output: output.trim() });
    } catch (error) {
      res.json({ success: false, error: error.message });
    }
  });

  return router;
}

module.exports = createRouter;
