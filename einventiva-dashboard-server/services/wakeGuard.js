// The monitor often runs on a laptop. While the machine sleeps the process
// is frozen; when it wakes, fully or for a few seconds of dark wake, the
// network and the SSH control masters are not back yet, so every probe in
// that window fails. Those failures describe the laptop, not the servers.
//
// A heartbeat timer marks the process as alive every few seconds. A gap far
// longer than the heartbeat means the process was frozen, and probe
// failures are ignored for `graceMs` after it. A failure that reaches
// `suppressing()` before the next heartbeat still sees the gap, because the
// check itself compares against the last time the process was seen alive.
const HEARTBEAT_MS = 5000;
const DEFAULT_GAP_MS = 30000;

function createWakeGuard({ graceMs, gapMs = DEFAULT_GAP_MS, now = Date.now, onWake = () => {} } = {}) {
  let lastSeen = now();
  let wokeAt = -Infinity;

  function observe() {
    const t = now();
    const gap = t - lastSeen;
    if (gap > gapMs) {
      wokeAt = t;
      onWake({ sleptMs: gap });
    }
    lastSeen = t;
    return t;
  }

  function suppressing() {
    if (!(graceMs > 0)) return false;
    const t = observe();
    return t - wokeAt < graceMs;
  }

  return { observe, suppressing };
}

function startHeartbeat(guard, intervalMs = HEARTBEAT_MS) {
  const timer = setInterval(() => guard.observe(), intervalMs);
  timer.unref?.();
  return timer;
}

module.exports = { createWakeGuard, startHeartbeat, HEARTBEAT_MS, DEFAULT_GAP_MS };
