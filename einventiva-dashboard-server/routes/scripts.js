const express = require('express');
const db = require('../db');
const { log, handleError } = require('../services/logger');
const { executeSSHCommand } = require('../services/ssh');
const { injectSudoPassword } = require('../services/ssh');
const { maskSudoPassword } = require('../services/ssh');
const { isValidCron } = require('../services/scheduler');
const { SCRIPT_TIMEOUT } = require('../config');

// null/empty clears the schedule; anything else must be 5-field cron
function validateSchedule(schedule) {
  if (schedule === undefined || schedule === null || schedule === '') return null;
  if (!isValidCron(schedule)) {
    return 'Invalid schedule: must be a 5-field cron expression (e.g. "0 3 * * *")';
  }
  return null;
}

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
      const { id, name, description, command, destructive, schedule, scheduleServers, alertTypes } = req.body;
      if (!id || !name || !command) {
        return res.status(400).json({ error: 'id, name, and command are required' });
      }
      if (db.getScript(id)) {
        return res.status(409).json({ error: `Script '${id}' already exists` });
      }
      const scheduleError = validateSchedule(schedule);
      if (scheduleError) {
        return res.status(400).json({ error: scheduleError });
      }
      const script = db.createScript({ id, name, description, command, destructive, schedule, scheduleServers, alertTypes });
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
      const { name, description, command, destructive, schedule, scheduleServers, alertTypes } = req.body;
      const scheduleError = validateSchedule(schedule);
      if (scheduleError) {
        return res.status(400).json({ error: scheduleError });
      }
      const script = db.updateScript(id, { name, description, command, destructive, schedule: schedule === '' ? null : schedule, scheduleServers, alertTypes });
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
      const maskSecret = (text) => (password && text ? String(text).split(password).join('••••') : text);

      log(`Executing script`, { server: serverKey, script, command: maskSudoPassword(command).substring(0, 100) });

      const startTime = Date.now();
      try {
        const output = await executeSSHCommand(serverConfig.alias, command, SCRIPT_TIMEOUT);

        db.logExecution({
          scriptId: script,
          server: serverKey,
          exitCode: 0,
          startedAt: new Date(startTime).toISOString(),
          durationMs: Date.now() - startTime,
          output: maskSecret(output),
        });

        res.json({
          server: serverKey,
          script,
          timestamp: new Date().toISOString(),
          success: true,
          output: maskSecret(output),
          outputLength: output.length
        });
      } catch (execError) {
        // exec() puts the remote exit code on error.code and any partial
        // stdout/stderr on the error object itself
        db.logExecution({
          scriptId: script,
          server: serverKey,
          exitCode: typeof execError.code === 'number' ? execError.code : 1,
          startedAt: new Date(startTime).toISOString(),
          durationMs: Date.now() - startTime,
          output: maskSecret([
            execError.stdout,
            execError.stderr,
            execError.killed ? `\n[dashboard] Timed out after ${Math.round(SCRIPT_TIMEOUT / 1000)}s — the remote command may still be running on the server.\n` : '',
          ].filter(Boolean).join('') || execError.message),
        });
        throw execError;
      }
    } catch (error) {
      handleError(res, error, `Failed to execute script '${req.body.script}'`);
    }
  });

  return router;
}

module.exports = createRouter;
