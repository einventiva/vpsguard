const express = require('express');
const db = require('../db');
const { log, handleError } = require('../services/logger');
const { executeSSHCommand } = require('../services/ssh');
const { injectSudoPassword } = require('../services/ssh');
const { SCRIPT_TIMEOUT } = require('../config');

function createRouter(getServers) {
  const router = express.Router();

  // List scripts
  router.get('/scripts', (req, res) => {
    const scripts = db.getScripts();
    res.json({
      scripts: scripts.map(s => s.id),
      count: scripts.length,
      details: scripts.reduce((acc, s) => { acc[s.id] = s.command; return acc; }, {}),
      items: scripts,
    });
  });

  // Create script
  router.post('/scripts', (req, res) => {
    try {
      const { id, name, description, command } = req.body;
      if (!id || !name || !command) {
        return res.status(400).json({ error: 'id, name, and command are required' });
      }
      if (db.getScript(id)) {
        return res.status(409).json({ error: `Script '${id}' already exists` });
      }
      const script = db.createScript({ id, name, description, command });
      log('Script created', { id });
      res.status(201).json(script);
    } catch (error) {
      handleError(res, error, 'Failed to create script');
    }
  });

  // Update script
  router.put('/scripts/:id', (req, res) => {
    try {
      const { id } = req.params;
      if (!db.getScript(id)) {
        return res.status(404).json({ error: `Script '${id}' not found` });
      }
      const { name, description, command } = req.body;
      const script = db.updateScript(id, { name, description, command });
      log('Script updated', { id });
      res.json(script);
    } catch (error) {
      handleError(res, error, `Failed to update script '${req.params.id}'`);
    }
  });

  // Delete script
  router.delete('/scripts/:id', (req, res) => {
    try {
      const { id } = req.params;
      if (!db.getScript(id)) {
        return res.status(404).json({ error: `Script '${id}' not found` });
      }
      db.deleteScript(id);
      log('Script deleted', { id });
      res.json({ success: true, id });
    } catch (error) {
      handleError(res, error, `Failed to delete script '${req.params.id}'`);
    }
  });

  // Execute script (REST endpoint)
  router.post('/execute/:server', async (req, res) => {
    try {
      const { server: serverKey } = req.params;
      const { script } = req.body;
      const SERVERS = getServers();

      log('POST /api/execute/:server requested', { server: serverKey, script });

      if (!SERVERS[serverKey]) {
        return res.status(404).json({ error: `Server '${serverKey}' not found` });
      }
      if (!script) {
        return res.status(400).json({ error: 'Script name is required' });
      }

      const scriptRow = db.getScript(script);
      if (!scriptRow) {
        return res.status(403).json({
          error: `Script '${script}' not found`,
          allowedScripts: db.getScripts().map(s => s.id)
        });
      }

      const serverConfig = SERVERS[serverKey];
      const { password } = req.body;
      const command = injectSudoPassword(scriptRow.command, password);

      log(`Executing script`, { server: serverKey, script, command: command.substring(0, 100) });

      const startTime = Date.now();
      const output = await executeSSHCommand(serverConfig.alias, command, SCRIPT_TIMEOUT);

      db.logExecution({
        scriptId: script,
        server: serverKey,
        exitCode: 0,
        startedAt: new Date(startTime).toISOString(),
        durationMs: Date.now() - startTime,
      });

      res.json({
        server: serverKey,
        script,
        timestamp: new Date().toISOString(),
        success: true,
        output,
        outputLength: output.length
      });
    } catch (error) {
      handleError(res, error, `Failed to execute script '${req.body.script}'`);
    }
  });

  return router;
}

module.exports = createRouter;
