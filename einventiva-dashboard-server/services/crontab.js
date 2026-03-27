const { executeSSHCommand } = require('./ssh');

function parseCrontab(raw, source = 'user') {
  const lines = raw.split('\n');
  const entries = [];
  let index = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || (trimmed.startsWith('#') && !trimmed.startsWith('#DISABLED# '))) {
      continue;
    }

    let enabled = true;
    let cronLine = trimmed;

    if (trimmed.startsWith('#DISABLED# ')) {
      enabled = false;
      cronLine = trimmed.replace('#DISABLED# ', '');
    }

    const parts = cronLine.split(/\s+/);
    if (parts.length < 6) continue;

    // /etc/cron.d/ files have a user field (6th field) before the command
    let command, user;
    if (source === 'system') {
      // Format: min hour dom month dow USER command
      user = parts[5];
      command = parts.slice(6).join(' ');
      if (!command) continue; // Skip if no command after user
    } else {
      command = parts.slice(5).join(' ');
      user = null;
    }

    entries.push({
      index,
      minute: parts[0],
      hour: parts[1],
      dayOfMonth: parts[2],
      month: parts[3],
      dayOfWeek: parts[4],
      command,
      user,
      enabled,
      source,
      raw: trimmed,
    });
    index++;
  }

  return entries;
}

function parseSystemCrontabs(raw) {
  // raw is the concatenated output of all /etc/cron.d/* files
  // with "=== filename ===" separators
  const entries = [];
  let currentFile = '';

  for (const line of raw.split('\n')) {
    const fileMatch = line.match(/^=== (.+) ===$/);
    if (fileMatch) {
      currentFile = fileMatch[1];
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('SHELL=') ||
        trimmed.startsWith('PATH=') || trimmed.startsWith('MAILTO=')) {
      continue;
    }

    const parts = trimmed.split(/\s+/);
    if (parts.length < 7) continue; // need min hour dom month dow user command

    entries.push({
      index: entries.length,
      minute: parts[0],
      hour: parts[1],
      dayOfMonth: parts[2],
      month: parts[3],
      dayOfWeek: parts[4],
      user: parts[5],
      command: parts.slice(6).join(' '),
      enabled: true,
      source: 'system',
      file: currentFile,
      raw: trimmed,
    });
  }

  return entries;
}

function buildCrontabLine(entry) {
  const line = `${entry.minute} ${entry.hour} ${entry.dayOfMonth} ${entry.month} ${entry.dayOfWeek} ${entry.command}`;
  return entry.enabled ? line : `#DISABLED# ${line}`;
}

async function writeCrontab(serverAlias, entries) {
  const content = entries.map(e => buildCrontabLine(e)).join('\n');
  const escaped = content.replace(/\\/g, '\\\\').replace(/'/g, "'\\''");
  const command = `printf '%s\\n' '${escaped}' | crontab -`;
  await executeSSHCommand(serverAlias, command);
}

async function getCrontabEntries(serverKey, getServers) {
  const servers = getServers();
  const serverConfig = servers[serverKey];
  if (!serverConfig) throw new Error(`Server '${serverKey}' not found`);

  // Fetch user crontab
  let userEntries = [];
  try {
    const raw = await executeSSHCommand(serverConfig.alias, 'crontab -l');
    userEntries = parseCrontab(raw, 'user');
  } catch (error) {
    if (!error.message || !error.message.includes('no crontab')) {
      throw error;
    }
  }

  return userEntries;
}

async function getSystemCrontabEntries(serverKey, getServers) {
  const servers = getServers();
  const serverConfig = servers[serverKey];
  if (!serverConfig) throw new Error(`Server '${serverKey}' not found`);

  try {
    const script = 'for f in /etc/cron.d/*; do [ -f "$f" ] && echo "=== $(basename $f) ===" && cat "$f"; done 2>/dev/null';
    const b64 = Buffer.from(script).toString('base64');
    const cmd = `echo ${b64} | base64 -d | bash`;
    const raw = await executeSSHCommand(serverConfig.alias, cmd);
    return parseSystemCrontabs(raw);
  } catch {
    return [];
  }
}

async function getAllCrontabEntries(serverKey, getServers) {
  const [userEntries, systemEntries] = await Promise.all([
    getCrontabEntries(serverKey, getServers),
    getSystemCrontabEntries(serverKey, getServers),
  ]);

  // Re-index all entries
  const all = [
    ...userEntries,
    ...systemEntries,
  ];
  all.forEach((e, i) => { e.index = i; });

  return { userEntries, systemEntries, all };
}

module.exports = { parseCrontab, buildCrontabLine, writeCrontab, getCrontabEntries, getSystemCrontabEntries, getAllCrontabEntries };
