const { executeSSHCommand, filterWarnings } = require('./ssh');

// Detect the postgres user for a container via POSTGRES_USER env var
async function detectPgUser(alias, containerName) {
  try {
    const raw = await executeSSHCommand(
      alias,
      `docker exec ${containerName} printenv POSTGRES_USER 2>/dev/null || echo postgres`,
      5000
    );
    const user = filterWarnings(raw).trim().split('\n').pop().trim();
    return user || 'postgres';
  } catch (_) {
    return 'postgres';
  }
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

module.exports = { detectPgUser, psqlViaB64, discoverPgContainers };
