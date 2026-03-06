const { executeSSHCommand } = require('./ssh');

function parseCrontab(raw) {
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

    entries.push({
      index,
      minute: parts[0],
      hour: parts[1],
      dayOfMonth: parts[2],
      month: parts[3],
      dayOfWeek: parts[4],
      command: parts.slice(5).join(' '),
      enabled,
      raw: trimmed,
    });
    index++;
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
  try {
    const raw = await executeSSHCommand(serverConfig.alias, 'crontab -l');
    return parseCrontab(raw);
  } catch (error) {
    if (error.message && error.message.includes('no crontab')) {
      return [];
    }
    throw error;
  }
}

module.exports = { parseCrontab, buildCrontabLine, writeCrontab, getCrontabEntries };
