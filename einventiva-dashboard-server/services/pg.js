const { executeSSHCommand, filterWarnings } = require('./ssh');

// Working user per container, so the probe runs at most once an hour
const userCache = new Map(); // `${alias}:${container}` -> { user, ts }
const USER_CACHE_TTL = 60 * 60 * 1000;

// POSTGRES_USER env var, or '' when absent (replicas created from
// basebackups aren't initialized by the official image and don't have it)
async function detectEnvPgUser(alias, containerName) {
  try {
    const raw = await executeSSHCommand(
      alias,
      `docker exec ${containerName} printenv POSTGRES_USER 2>/dev/null || true`,
      5000
    );
    return filterWarnings(raw).trim().split('\n').pop().trim();
  } catch (_) {
    return '';
  }
}

// Candidate roles derived from the container name: a replica of a
// primary initialized with POSTGRES_USER=hashtask_admin is typically
// named pg-replica-hashtask, so the app name — plus the common
// _admin/_user suffixes — is the best guess.
function deriveUserCandidates(containerName) {
  const name = containerName.replace(/\.\d+\.[a-z0-9]+$/i, ''); // swarm task suffix
  const bases = [...new Set([
    name.replace(/^pg[-_]replica[-_]/i, ''),
    name.replace(/^(postgres|pg)[-_]/i, ''),
    name.replace(/[-_]?(postgres|pg|db)([-_].*)?$/i, ''),
    name.split(/[-_.]/)[0],
  ])].filter(v => v && v !== name && /^[a-zA-Z0-9_-]+$/.test(v));
  return [...new Set(bases.flatMap(b => [b, `${b}_admin`, `${b}_user`]))];
}

// Resolve a role that can actually connect: env var -> 'postgres' ->
// name-derived candidates, probed with a single SSH call (remote loop).
// Returns null when nothing works.
async function resolvePgUser(alias, containerName) {
  const key = `${alias}:${containerName}`;
  const cached = userCache.get(key);
  if (cached && Date.now() - cached.ts < USER_CACHE_TTL) return cached.user;

  const { PG_USER_OVERRIDES } = require('../config');
  const envUser = await detectEnvPgUser(alias, containerName);
  const candidates = [...new Set(
    [PG_USER_OVERRIDES[containerName], envUser, 'postgres', ...deriveUserCandidates(containerName)]
      .filter(u => u && /^[a-zA-Z0-9_-]+$/.test(u))
  )];

  const script = `for u in ${candidates.join(' ')}; do if docker exec ${containerName} psql -U "$u" -d postgres -tAc 'SELECT 1' >/dev/null 2>&1; then echo "$u"; exit 0; fi; done`;
  const b64 = Buffer.from(script).toString('base64');
  const raw = await executeSSHCommand(alias, `echo ${b64} | base64 -d | bash`, 20000).catch(() => '');
  const user = filterWarnings(raw).trim().split('\n').pop().trim() || null;

  userCache.set(key, { user, ts: Date.now() });
  return user;
}

// Build a shell command that base64-encodes the SQL to avoid all quoting/escaping issues
function psqlViaB64(container, pgUser, sql, dbName = 'postgres') {
  const b64 = Buffer.from(sql).toString('base64');
  return `echo ${b64} | base64 -d | docker exec -i ${container} psql -U ${pgUser} -d ${dbName} -t -A`;
}

// Running containers whose image or name mentions postgres
async function discoverPgContainers(alias) {
  const psOutput = await executeSSHCommand(
    alias,
    "docker ps --format '{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}' 2>/dev/null | grep -i postgres"
  ).catch(() => '');

  if (!psOutput.trim()) return [];
  return psOutput.trim().split('\n').filter(Boolean).map(line => {
    const [id, name, image, ...statusParts] = line.split('|');
    return { id: id.trim(), name: name.trim(), image: image.trim(), status: statusParts.join('|').trim() };
  });
}

// Reduce a failed SSH/psql invocation to its meaningful line for the UI
function cleanPgError(message) {
  const lines = (message || '').split('\n').map(l => l.trim()).filter(Boolean);
  const meaningful = lines.filter(l => l.includes('psql:') || l.includes('FATAL') || l.includes('ERROR:'));
  return meaningful.length > 0 ? meaningful[meaningful.length - 1] : 'Failed to query PostgreSQL';
}

module.exports = { resolvePgUser, deriveUserCandidates, psqlViaB64, discoverPgContainers, cleanPgError };
