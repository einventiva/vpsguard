const { test, describe } = require('node:test');
const assert = require('node:assert');
const { parseCronLog, parseCronLogLine, expectedIntervalMs, annotateEntries } = require('../services/cronWatch');

const HOUR = 3600e3;
const DAY = 24 * HOUR;
// Fixed "now": Jul 16 2026 12:00 local
const NOW = new Date('2026-07-16T12:00:00').getTime();

function entry(overrides = {}) {
  return {
    index: 0,
    minute: '0',
    hour: '2',
    dayOfMonth: '*',
    month: '*',
    dayOfWeek: '*',
    command: '/usr/local/bin/backup.sh',
    enabled: true,
    source: 'user',
    raw: '',
    ...overrides,
  };
}

describe('parseCronLogLine', () => {
  test('parses traditional syslog format', () => {
    const line = 'Jul 16 02:00:01 vps1 CRON[4242]: (root) CMD (/usr/local/bin/backup.sh)';
    const parsed = parseCronLogLine(line, NOW);
    assert.ok(parsed);
    assert.strictEqual(parsed.user, 'root');
    assert.strictEqual(parsed.command, '/usr/local/bin/backup.sh');
    assert.strictEqual(new Date(parsed.timestamp).getDate(), 16);
  });

  test('parses ISO syslog format', () => {
    const line = '2026-07-16T02:00:01.123456-06:00 vps1 CRON[4242]: (deploy) CMD (docker system prune -f)';
    const parsed = parseCronLogLine(line, NOW);
    assert.ok(parsed);
    assert.strictEqual(parsed.user, 'deploy');
    assert.strictEqual(parsed.command, 'docker system prune -f');
  });

  test('keeps nested parentheses inside the command', () => {
    const line = 'Jul 16 02:00:01 vps1 CRON[1]: (root) CMD (echo $(date) >> /tmp/log)';
    const parsed = parseCronLogLine(line, NOW);
    assert.strictEqual(parsed.command, 'echo $(date) >> /tmp/log');
  });

  test('ignores non-CMD and malformed lines', () => {
    assert.strictEqual(parseCronLogLine('Jul 16 02:00:01 vps1 CRON[1]: pam_unix(cron:session): session opened', NOW), null);
    assert.strictEqual(parseCronLogLine('garbage', NOW), null);
  });

  test('December timestamps parsed in January map to the previous year', () => {
    const january = new Date('2026-01-05T12:00:00').getTime();
    const parsed = parseCronLogLine('Dec 30 02:00:01 vps1 CRON[1]: (root) CMD (task)', january);
    assert.strictEqual(new Date(parsed.timestamp).getFullYear(), 2025);
  });
});

describe('expectedIntervalMs', () => {
  test('every-N-minutes', () => {
    assert.strictEqual(expectedIntervalMs(entry({ minute: '*/5', hour: '*' })), 5 * 60e3);
  });
  test('hourly', () => {
    assert.strictEqual(expectedIntervalMs(entry({ minute: '30', hour: '*' })), HOUR);
  });
  test('every-N-hours', () => {
    assert.strictEqual(expectedIntervalMs(entry({ minute: '0', hour: '*/6' })), 6 * HOUR);
  });
  test('daily', () => {
    assert.strictEqual(expectedIntervalMs(entry({ minute: '0', hour: '2' })), DAY);
  });
  test('weekly', () => {
    assert.strictEqual(expectedIntervalMs(entry({ minute: '0', hour: '2', dayOfWeek: '1' })), 7 * DAY);
  });
  test('complex schedules get no judgment', () => {
    assert.strictEqual(expectedIntervalMs(entry({ minute: '0', hour: '2', dayOfMonth: '1' })), null);
    assert.strictEqual(expectedIntervalMs(entry({ minute: '1,31', hour: '*' })), null);
  });
});

describe('annotateEntries', () => {
  const exec = (hoursAgo, command = '/usr/local/bin/backup.sh') => ({
    timestamp: NOW - hoursAgo * HOUR,
    user: 'root',
    command,
  });

  test('finds last run and stays calm when fresh', () => {
    const [a] = annotateEntries([entry()], [exec(30), exec(6)], NOW);
    assert.strictEqual(a.lastRun, new Date(NOW - 6 * HOUR).toISOString());
    assert.strictEqual(a.overdue, false);
  });

  test('flags a daily job silent for 3 days', () => {
    const [a] = annotateEntries([entry()], [exec(72), exec(1, 'other-job')], NOW);
    assert.strictEqual(a.overdue, true);
  });

  test('daily job with no run on record is overdue when logs are alive', () => {
    const [a] = annotateEntries([entry()], [exec(1, 'other-job')], NOW);
    assert.strictEqual(a.lastRun, null);
    assert.strictEqual(a.overdue, true);
  });

  test('no executions at all -> unknown, never overdue (journald/no-permission guard)', () => {
    const [a] = annotateEntries([entry()], [], NOW);
    assert.strictEqual(a.lastRun, null);
    assert.strictEqual(a.overdue, false);
  });

  test('disabled jobs are never overdue', () => {
    const [a] = annotateEntries([entry({ enabled: false })], [exec(1, 'other-job')], NOW);
    assert.strictEqual(a.overdue, false);
  });

  test('weekly job missing from short logs is not flagged', () => {
    const [a] = annotateEntries([entry({ dayOfWeek: '1' })], [exec(1, 'other-job')], NOW);
    assert.strictEqual(a.overdue, false);
  });

  test('command matching tolerates whitespace differences', () => {
    const e = entry({ command: 'cd /app &&   ./run.sh' });
    const [a] = annotateEntries([e], [exec(2, 'cd /app && ./run.sh')], NOW);
    assert.ok(a.lastRun);
  });
});
