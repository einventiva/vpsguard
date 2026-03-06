const express = require('express');
const { log, handleError } = require('../services/logger');
const { getCrontabEntries, writeCrontab } = require('../services/crontab');

function createRouter(getServers) {
  const router = express.Router();

  // List cron jobs
  router.get('/crontab/:server', async (req, res) => {
    try {
      const { server: serverKey } = req.params;
      const SERVERS = getServers();
      log('GET /api/crontab/:server', { server: serverKey });

      if (!SERVERS[serverKey]) {
        return res.status(404).json({ error: `Server '${serverKey}' not found` });
      }

      const entries = await getCrontabEntries(serverKey, getServers);
      res.json({
        server: serverKey,
        name: SERVERS[serverKey].displayName,
        timestamp: new Date().toISOString(),
        count: entries.length,
        entries,
      });
    } catch (error) {
      handleError(res, error, `Failed to list crontab for '${req.params.server}'`);
    }
  });

  // Add new cron job
  router.post('/crontab/:server', async (req, res) => {
    try {
      const { server: serverKey } = req.params;
      const { minute, hour, dayOfMonth, month, dayOfWeek, command } = req.body;
      const SERVERS = getServers();
      log('POST /api/crontab/:server', { server: serverKey, command });

      if (!SERVERS[serverKey]) {
        return res.status(404).json({ error: `Server '${serverKey}' not found` });
      }
      if (!command) {
        return res.status(400).json({ error: 'Command is required' });
      }

      const entries = await getCrontabEntries(serverKey, getServers);
      entries.push({
        index: entries.length,
        minute: minute || '*',
        hour: hour || '*',
        dayOfMonth: dayOfMonth || '*',
        month: month || '*',
        dayOfWeek: dayOfWeek || '*',
        command,
        enabled: true,
        raw: '',
      });

      await writeCrontab(SERVERS[serverKey].alias, entries);
      res.json({ success: true, entry: entries[entries.length - 1] });
    } catch (error) {
      handleError(res, error, `Failed to add crontab entry on '${req.params.server}'`);
    }
  });

  // Edit cron job
  router.put('/crontab/:server/:index', async (req, res) => {
    try {
      const { server: serverKey, index } = req.params;
      const idx = parseInt(index, 10);
      const { minute, hour, dayOfMonth, month, dayOfWeek, command } = req.body;
      const SERVERS = getServers();
      log('PUT /api/crontab/:server/:index', { server: serverKey, index: idx });

      if (!SERVERS[serverKey]) {
        return res.status(404).json({ error: `Server '${serverKey}' not found` });
      }

      const entries = await getCrontabEntries(serverKey, getServers);
      if (idx < 0 || idx >= entries.length) {
        return res.status(404).json({ error: `Crontab entry ${idx} not found` });
      }

      if (minute !== undefined) entries[idx].minute = minute;
      if (hour !== undefined) entries[idx].hour = hour;
      if (dayOfMonth !== undefined) entries[idx].dayOfMonth = dayOfMonth;
      if (month !== undefined) entries[idx].month = month;
      if (dayOfWeek !== undefined) entries[idx].dayOfWeek = dayOfWeek;
      if (command !== undefined) entries[idx].command = command;

      await writeCrontab(SERVERS[serverKey].alias, entries);
      res.json({ success: true, entry: entries[idx] });
    } catch (error) {
      handleError(res, error, `Failed to update crontab entry on '${req.params.server}'`);
    }
  });

  // Delete cron job
  router.delete('/crontab/:server/:index', async (req, res) => {
    try {
      const { server: serverKey, index } = req.params;
      const idx = parseInt(index, 10);
      const SERVERS = getServers();
      log('DELETE /api/crontab/:server/:index', { server: serverKey, index: idx });

      if (!SERVERS[serverKey]) {
        return res.status(404).json({ error: `Server '${serverKey}' not found` });
      }

      const entries = await getCrontabEntries(serverKey, getServers);
      if (idx < 0 || idx >= entries.length) {
        return res.status(404).json({ error: `Crontab entry ${idx} not found` });
      }

      entries.splice(idx, 1);
      entries.forEach((e, i) => { e.index = i; });

      await writeCrontab(SERVERS[serverKey].alias, entries);
      res.json({ success: true, remaining: entries.length });
    } catch (error) {
      handleError(res, error, `Failed to delete crontab entry on '${req.params.server}'`);
    }
  });

  // Toggle enable/disable cron job
  router.patch('/crontab/:server/:index/toggle', async (req, res) => {
    try {
      const { server: serverKey, index } = req.params;
      const idx = parseInt(index, 10);
      const SERVERS = getServers();
      log('PATCH /api/crontab/:server/:index/toggle', { server: serverKey, index: idx });

      if (!SERVERS[serverKey]) {
        return res.status(404).json({ error: `Server '${serverKey}' not found` });
      }

      const entries = await getCrontabEntries(serverKey, getServers);
      if (idx < 0 || idx >= entries.length) {
        return res.status(404).json({ error: `Crontab entry ${idx} not found` });
      }

      entries[idx].enabled = !entries[idx].enabled;

      await writeCrontab(SERVERS[serverKey].alias, entries);
      res.json({ success: true, entry: entries[idx] });
    } catch (error) {
      handleError(res, error, `Failed to toggle crontab entry on '${req.params.server}'`);
    }
  });

  return router;
}

module.exports = createRouter;
