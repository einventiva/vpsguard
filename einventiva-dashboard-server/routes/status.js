const express = require('express');
const { log, handleError } = require('../services/logger');
const { getCached, setCache } = require('../services/cache');
const { fetchAllServerStatus } = require('../services/backgroundJobs');

function createRouter(getServers) {
  const router = express.Router();

  router.get('/status', async (req, res) => {
    try {
      log('GET /api/status requested');

      const cached = getCached('status');
      if (cached) {
        return res.json(cached);
      }

      const statusData = await fetchAllServerStatus(getServers);
      setCache('status', statusData, 10000);
      res.json(statusData);
    } catch (error) {
      handleError(res, error, 'Failed to retrieve system status');
    }
  });

  return router;
}

module.exports = createRouter;
