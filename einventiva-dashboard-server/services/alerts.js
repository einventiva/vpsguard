const notifier = require('node-notifier');
const { parseCpuPercent } = require('./metrics');

// Pure evaluation: which thresholds does this sample breach right now?
// Lifecycle (open/resolve with hysteresis) lives in alertEngine.js.
function evaluateBreaches(serverDisplayName, data, thresholds) {
  if (!data || data.status === 'error') {
    return [{
      type: 'offline',
      severity: 'critical',
      message: `${serverDisplayName} is offline`,
      value: null,
      threshold: null,
    }];
  }

  const breaches = [];
  const parsed = data.metrics || {};

  const cpuPercent = parseCpuPercent(parsed.cpu);
  if (cpuPercent > thresholds.cpu) {
    breaches.push({
      type: 'cpu',
      severity: 'warning',
      message: `${serverDisplayName} CPU at ${cpuPercent.toFixed(1)}%`,
      value: cpuPercent,
      threshold: thresholds.cpu,
    });
  }

  const mem = parsed.memory || {};
  if (mem.total && mem.used) {
    const memPercent = (mem.used / mem.total) * 100;
    if (memPercent > thresholds.memory) {
      breaches.push({
        type: 'memory',
        severity: 'warning',
        message: `${serverDisplayName} Memory at ${memPercent.toFixed(1)}%`,
        value: memPercent,
        threshold: thresholds.memory,
      });
    }
  }

  const diskPercent = parseInt((parsed.disk?.percentUsed || '0').replace('%', ''));
  if (diskPercent > thresholds.disk) {
    breaches.push({
      type: 'disk',
      severity: 'critical',
      message: `${serverDisplayName} Disk at ${diskPercent}%`,
      value: diskPercent,
      threshold: thresholds.disk,
    });
  }

  return breaches;
}

// Fires only on lifecycle transitions (opened/resolved), so no rate
// limiting is needed anymore
function sendNativeNotification(alert, event) {
  const resolved = event === 'resolved';
  notifier.notify({
    title: resolved
      ? 'Server Alert Resolved'
      : `Server Alert: ${alert.severity.toUpperCase()}`,
    message: resolved ? `Resolved: ${alert.message}` : alert.message,
    sound: resolved ? 'Ping' : (alert.severity === 'critical' ? 'Basso' : 'Ping'),
    timeout: 10
  });
}

module.exports = { evaluateBreaches, sendNativeNotification };
