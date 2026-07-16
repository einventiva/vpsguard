const { log } = require('./logger');
const { ALERT_WEBHOOK_URL } = require('../config');

// Fire-and-forget webhook delivery. Payload:
//   { event: 'opened' | 'resolved', alert: <alerts row>, sentAt: ISO }
async function sendWebhook(event, alert) {
  if (!ALERT_WEBHOOK_URL) return;
  try {
    await fetch(ALERT_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, alert, sentAt: new Date().toISOString() }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (e) {
    log('Alert webhook delivery failed', { event, error: e.message });
  }
}

module.exports = { sendWebhook };
