const { executeSSHCommand } = require('./ssh');
const { getAllCrontabEntries } = require('./crontab');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// Grace: a job is overdue after 2x its expected interval plus 15 min
const OVERDUE_FACTOR = 2;
const OVERDUE_GRACE_MS = 15 * MIN;

// Syslog CRON execution lines, both timestamp flavors:
//   Jul 16 06:25:01 host CRON[123]: (root) CMD (command)
//   2026-07-16T06:25:01.123456-06:00 host CRON[123]: (root) CMD (command)
const TRAD_RE = /^([A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+\S+\s+CRON\[\d+\]:\s+\((.+?)\)\s+CMD\s+\((.*)\)\s*$/;
const ISO_RE = /^(\d{4}-\d{2}-\d{2}T[\d:.]+(?:[+-]\d{2}:?\d{2}|Z)?)\s+\S+\s+CRON\[\d+\]:\s+\((.+?)\)\s+CMD\s+\((.*)\)\s*$/;

// Traditional syslog timestamps carry no year: assume the current one,
// step back if that lands in the future
function parseTradTimestamp(str, now) {
  const year = new Date(now).getFullYear();
  let d = new Date(`${str} ${year}`);
  if (isNaN(d.getTime())) return null;
  if (d.getTime() > now + DAY) d = new Date(`${str} ${year - 1}`);
  return d.getTime();
}

function parseCronLogLine(line, now) {
  let m = line.match(ISO_RE);
  if (m) {
    const t = new Date(m[1]).getTime();
    return isNaN(t) ? null : { timestamp: t, user: m[2], command: m[3].trim() };
  }
  m = line.match(TRAD_RE);
  if (m) {
    const t = parseTradTimestamp(m[1], now);
    return t == null ? null : { timestamp: t, user: m[2], command: m[3].trim() };
  }
  return null;
}

function parseCronLog(raw, now = Date.now()) {
  return raw
    .split('\n')
    .map(line => parseCronLogLine(line, now))
    .filter(Boolean);
}

const normalize = (cmd) => cmd.replace(/\s+/g, ' ').trim();

// Expected interval for simple schedules only; anything fancier returns
// null and gets no overdue judgment (just a last-run display)
function expectedIntervalMs(entry) {
  const { minute, hour, dayOfMonth, month, dayOfWeek } = entry;
  const isStar = f => f === '*';
  const isNum = f => /^\d+$/.test(f);
  const step = f => (f.match(/^\*\/(\d+)$/) || [])[1];

  if (step(minute) && isStar(hour)) return parseInt(step(minute)) * MIN;
  if (isNum(minute) && step(hour)) return parseInt(step(hour)) * HOUR;
  if (isNum(minute) && isStar(hour)) return HOUR;
  if (isNum(minute) && isNum(hour) && isStar(dayOfMonth) && isStar(month) && isStar(dayOfWeek)) return DAY;
  if (isNum(minute) && isNum(hour) && isStar(dayOfMonth) && isStar(month) && isNum(dayOfWeek)) return 7 * DAY;
  return null;
}

// Annotate crontab entries with lastRun/overdue from parsed executions.
// If the log yielded zero executions (journald-only box, no read
// permission, rotated away) everything stays unknown — no false alarms.
function annotateEntries(entries, executions, now = Date.now()) {
  const logsAvailable = executions.length > 0;
  return entries.map(entry => {
    const target = normalize(entry.command);
    let lastRun = null;
    for (const exec of executions) {
      const cmd = normalize(exec.command);
      if (cmd === target || cmd.startsWith(target) || target.startsWith(cmd)) {
        if (lastRun == null || exec.timestamp > lastRun) lastRun = exec.timestamp;
      }
    }
    const intervalMs = expectedIntervalMs(entry);
    let overdue = false;
    if (entry.enabled && logsAvailable && intervalMs != null) {
      const limit = intervalMs * OVERDUE_FACTOR + OVERDUE_GRACE_MS;
      // No run on record counts as overdue only for daily-or-faster
      // jobs, where the retained logs certainly span the interval
      overdue = lastRun != null ? now - lastRun > limit : intervalMs <= DAY;
    }
    return {
      ...entry,
      lastRun: lastRun != null ? new Date(lastRun).toISOString() : null,
      intervalMs,
      overdue,
    };
  });
}

async function fetchCronExecutions(alias) {
  // b64 sidesteps the quoting of nested parentheses in the pattern.
  // Oldest file FIRST: grep emits lines in argument order, so tail
  // keeps the newest — the reverse order silently dropped today's runs.
  const script = "grep -hE 'CRON\\[[0-9]+\\]: \\(.*\\) CMD' /var/log/syslog.1 /var/log/syslog 2>/dev/null | tail -2000";
  const b64 = Buffer.from(script).toString('base64');
  const raw = await executeSSHCommand(alias, `echo ${b64} | base64 -d | bash`).catch(() => '');
  return parseCronLog(raw);
}

async function getCronStatus(serverKey, getServers) {
  const servers = getServers();
  const serverConfig = servers[serverKey];
  if (!serverConfig) throw new Error(`Server '${serverKey}' not found`);

  const [{ all }, executions] = await Promise.all([
    getAllCrontabEntries(serverKey, getServers),
    fetchCronExecutions(serverConfig.alias),
  ]);
  return { entries: annotateEntries(all, executions), executionsSeen: executions.length };
}

module.exports = { parseCronLog, parseCronLogLine, expectedIntervalMs, annotateEntries, fetchCronExecutions, getCronStatus };
