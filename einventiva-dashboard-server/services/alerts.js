const notifier = require('node-notifier');
const { ALERT_THRESHOLDS } = require('../config');
const { parseCpuPercent } = require('./metrics');

let previousAlertState = {};

function checkAlerts(serverKey, serverDisplayName, metrics) {
  const alerts = [];
  const now = new Date().toISOString();

  if (!metrics || metrics.status === 'error') {
    alerts.push({
      server: serverKey,
      type: 'offline',
      severity: 'critical',
      message: `${serverDisplayName} is offline`,
      timestamp: now
    });
    return alerts;
  }

  const parsed = metrics.metrics || {};

  // CPU alert
  const cpuPercent = parseCpuPercent(parsed.cpu);
  if (cpuPercent > ALERT_THRESHOLDS.cpu) {
    alerts.push({
      server: serverKey,
      type: 'cpu',
      severity: 'warning',
      message: `${serverDisplayName} CPU at ${cpuPercent.toFixed(1)}%`,
      value: cpuPercent,
      threshold: ALERT_THRESHOLDS.cpu,
      timestamp: now
    });
  }

  // Memory alert
  const mem = parsed.memory || {};
  if (mem.total && mem.used) {
    const memPercent = (mem.used / mem.total) * 100;
    if (memPercent > ALERT_THRESHOLDS.memory) {
      alerts.push({
        server: serverKey,
        type: 'memory',
        severity: 'warning',
        message: `${serverDisplayName} Memory at ${memPercent.toFixed(1)}%`,
        value: memPercent,
        threshold: ALERT_THRESHOLDS.memory,
        timestamp: now
      });
    }
  }

  // Disk alert
  const diskPercent = parseInt((parsed.disk?.percentUsed || '0').replace('%', ''));
  if (diskPercent > ALERT_THRESHOLDS.disk) {
    alerts.push({
      server: serverKey,
      type: 'disk',
      severity: 'critical',
      message: `${serverDisplayName} Disk at ${diskPercent}%`,
      value: diskPercent,
      threshold: ALERT_THRESHOLDS.disk,
      timestamp: now
    });
  }

  return alerts;
}

function sendNativeNotification(alert) {
  const stateKey = `${alert.server}-${alert.type}`;
  const now = Date.now();
  if (previousAlertState[stateKey] && now - previousAlertState[stateKey] < 300000) {
    return;
  }
  previousAlertState[stateKey] = now;

  notifier.notify({
    title: `Server Alert: ${alert.severity.toUpperCase()}`,
    message: alert.message,
    sound: alert.severity === 'critical' ? 'Basso' : 'Ping',
    timeout: 10
  });
}

module.exports = { checkAlerts, sendNativeNotification };
