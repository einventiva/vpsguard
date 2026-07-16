const express = require('express');
const db = require('../db');
const { log, handleError } = require('../services/logger');

function createRouter() {
  const router = express.Router();

  // List alerts: active ones first, then most recent resolved
  router.get('/alerts', (req, res) => {
    try {
      const activeOnly = req.query.active === '1' || req.query.active === 'true';
      const limit = Math.min(parseInt(req.query.limit) || 100, 500);
      const alerts = db.getAlerts({ activeOnly, limit });
      res.json({ alerts, count: alerts.length });
    } catch (error) {
      handleError(res, error, 'Failed to retrieve alerts');
    }
  });

  // Acknowledge an alert
  router.post('/alerts/:id/ack', (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (!Number.isInteger(id)) {
        return res.status(400).json({ error: 'Invalid alert id' });
      }
      const alert = db.getAlert(id);
      if (!alert) {
        return res.status(404).json({ error: `Alert ${id} not found` });
      }
      const updated = db.acknowledgeAlert(id);
      log('Alert acknowledged', { id });
      res.json(updated);
    } catch (error) {
      handleError(res, error, 'Failed to acknowledge alert');
    }
  });

  return router;
}

module.exports = createRouter;
