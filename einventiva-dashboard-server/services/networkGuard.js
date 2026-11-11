// The servers are reached through a Tailscale tailnet: the SSH aliases
// point at 100.64.x addresses. When the host running the monitor drops off
// the tailnet (logged out, node key expired, tailscaled stopped, or an ACL
// that leaves it with no peers), every SSH probe times out and the monitor
// used to open an `offline` and a `service` alert for each healthy server.
// Those failures describe the monitor's own network, not the fleet.
//
// The guard asks the local `tailscale` CLI whether the node is running and
// sees at least one online peer. While it does not, the monitor raises one
// `network` alert against itself and ignores SSH probe failures, the same
// way it does right after waking from sleep. Successful results still
// count, so alerts resolve as soon as the tailnet is back.
const fs = require('node:fs');
const { execFile } = require('node:child_process');

const CANDIDATE_BINS = [
  '/opt/homebrew/bin/tailscale',
  '/usr/local/bin/tailscale',
  '/usr/bin/tailscale',
  '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
];

const DEFAULT_TTL_MS = 15000;
const PROBE_TIMEOUT_MS = 5000;

// `tailscale status --json` -> { ok, state, peersOnline, reason }
function interpretStatus(json) {
  const state = json?.BackendState || 'Unknown';
  const peers = Object.values(json?.Peer || {});
  const peersOnline = peers.filter(p => p && p.Online).length;
  if (state !== 'Running') {
    return { ok: false, state, peersOnline, reason: `Tailscale is ${state}` };
  }
  if (peersOnline === 0) {
    return { ok: false, state, peersOnline, reason: 'Tailscale is running but sees no online peers (ACL or tags?)' };
  }
  return { ok: true, state, peersOnline, reason: null };
}

function findTailscaleBin(candidates = CANDIDATE_BINS, exists = fs.existsSync) {
  return candidates.find(p => exists(p)) || null;
}

function probeTailscale(bin, timeoutMs = PROBE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    execFile(bin, ['status', '--json'], { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      // `status` exits non-zero when logged out but still prints JSON
      if (stdout) {
        try { return resolve(interpretStatus(JSON.parse(stdout))); } catch { /* fall through */ }
      }
      resolve({ ok: false, state: 'Unreachable', peersOnline: 0, reason: `tailscale status failed: ${err ? err.message.split('\n')[0] : 'no output'}` });
    });
  });
}

// `probe` is injectable for tests. With no probe the guard is disabled and
// always reports the network as up.
function createNetworkGuard({ probe, ttlMs = DEFAULT_TTL_MS, now = Date.now } = {}) {
  let last = { ok: true, state: probe ? 'Unknown' : 'Disabled', peersOnline: null, reason: null };
  let checkedAt = -Infinity;
  let inflight = null;

  async function refresh() {
    if (!probe) return last;
    if (!inflight) {
      inflight = probe()
        .catch(e => ({ ok: false, state: 'Unreachable', peersOnline: 0, reason: e.message }))
        .then(r => { last = r; checkedAt = now(); return r; })
        .finally(() => { inflight = null; });
    }
    return inflight;
  }

  // Cached for ttlMs, so a burst of failing probes costs one CLI call
  async function status({ force = false } = {}) {
    if (!probe) return last;
    if (force || now() - checkedAt >= ttlMs) return refresh();
    return last;
  }

  async function isDown() {
    return !(await status()).ok;
  }

  return { enabled: Boolean(probe), status, isDown, current: () => last };
}

module.exports = { createNetworkGuard, interpretStatus, findTailscaleBin, probeTailscale, CANDIDATE_BINS, DEFAULT_TTL_MS };
