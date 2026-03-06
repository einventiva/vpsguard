const express = require('express');

function createRouter(getServers) {
  const router = express.Router();

  router.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      servers: Object.keys(getServers())
    });
  });

  return router;
}

module.exports = createRouter;
