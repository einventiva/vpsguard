const express = require('express');
const { log, handleError } = require('../services/logger');
const { getCached, setCache } = require('../services/cache');
const { fetchAllServerStatus } = require('../services/backgroundJobs');
const { STATUS_CACHE_TTL } = require('../config');

function createRouter(getServers) {
  const router = express.Router();

  // In-flight lock to prevent parallel fetches
  let fetchInProgress = null;

  router.get('/status', async (req, res) => {
    try {
      const cached = getCached('status');
      if (cached) {
        return res.json(cached);
      }

      // Coalesce concurrent requests: only one SSH fetch at a time
      if (!fetchInProgress) {
        log('GET /api/status — cache miss, fetching');
        fetchInProgress = fetchAllServerStatus(getServers)
          .then(data => {
            setCache('status', data, STATUS_CACHE_TTL);
            return data;
          })
          .finally(() => { fetchInProgress = null; });
      }

      const statusData = await fetchInProgress;
      res.json(statusData);
    } catch (error) {
      handleError(res, error, 'Failed to retrieve system status');
    }
  });

  return router;
}

module.exports = createRouter;
