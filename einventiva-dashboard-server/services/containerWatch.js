const { executeSSHCommand, filterWarnings } = require('./ssh');

// Restart counts + OOM flags for all running containers on a server
async function fetchRestartCounts(alias) {
  const raw = await executeSSHCommand(
    alias,
    "docker ps -q | xargs -r docker inspect --format '{{.Name}}|{{.RestartCount}}|{{.State.OOMKilled}}' 2>/dev/null"
  ).catch(() => '');

  const containers = [];
  for (const line of filterWarnings(raw).split('\n')) {
    const [name, restarts, oom] = line.trim().split('|');
    if (!name) continue;
    containers.push({
      name: name.replace(/^\//, ''),
      restartCount: parseInt(restarts) || 0,
      oomKilled: oom === 'true',
    });
  }
  return containers;
}

// Containers whose restart count grew since the previous snapshot.
// `prev` is a Map(name -> count); missing entries (new containers or
// first run after a dashboard restart) are baselined, not flagged.
function computeRestartDeltas(prev, current) {
  const deltas = [];
  for (const c of current) {
    const before = prev.get(c.name);
    if (before != null && c.restartCount > before) {
      deltas.push({
        name: c.name,
        delta: c.restartCount - before,
        total: c.restartCount,
        oomKilled: c.oomKilled,
      });
    }
  }
  return deltas;
}

function toSnapshot(containers) {
  return new Map(containers.map(c => [c.name, c.restartCount]));
}

module.exports = { fetchRestartCounts, computeRestartDeltas, toSnapshot };
