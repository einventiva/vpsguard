const db = require('../db');
const { ALERT_THRESHOLDS } = require('../config');

const METRICS = ['cpu', 'memory', 'disk'];

// Cascade: per-server override -> global override (row 'default') -> built-in
function resolveThresholds(serverKey) {
  const global = db.getThreshold('default') || {};
  const override = (serverKey && db.getThreshold(serverKey)) || {};
  const resolved = {};
  for (const m of METRICS) {
    resolved[m] = override[m] ?? global[m] ?? ALERT_THRESHOLDS[m];
  }
  return resolved;
}

module.exports = { resolveThresholds, METRICS };
