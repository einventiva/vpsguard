const express = require('express');
const { handleError } = require('../services/logger');
const { getCached, setCache } = require('../services/cache');
const { computeProjections } = require('../services/projections');

function createRouter(getServers) {
  const router = express.Router();

  // Disk-full ETA and memory slope per server (cached 5 min)
  router.get('/projections', (req, res) => {
    try {
      const cached = getCached('projections');
      if (cached) return res.json(cached);

      const serverKeys = Object.keys(getServers());
      const result = {
        timestamp: new Date().toISOString(),
        servers: computeProjections(serverKeys),
      };
      setCache('projections', result, 5 * 60 * 1000);
      res.json(result);
    } catch (error) {
      handleError(res, error, 'Failed to compute projections');
    }
  });

  return router;
}

module.exports = createRouter;
