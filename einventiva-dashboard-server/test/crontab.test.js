const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseCrontab, buildCrontabLine, systemCrontabScript } = require('../services/crontab');

describe('parseCrontab', () => {
  it('parses standard cron entries', () => {
    const raw = '*/5 * * * * /usr/bin/check.sh\n0 3 * * * /usr/bin/backup.sh';
    const entries = parseCrontab(raw);

    assert.equal(entries.length, 2);
    assert.equal(entries[0].minute, '*/5');
    assert.equal(entries[0].command, '/usr/bin/check.sh');
    assert.equal(entries[0].enabled, true);
    assert.equal(entries[1].hour, '3');
    assert.equal(entries[1].command, '/usr/bin/backup.sh');
  });

  it('parses disabled entries', () => {
    const raw = '#DISABLED# 0 * * * * /usr/bin/hourly.sh';
    const entries = parseCrontab(raw);

    assert.equal(entries.length, 1);
    assert.equal(entries[0].enabled, false);
    assert.equal(entries[0].command, '/usr/bin/hourly.sh');
  });

  it('skips comments and empty lines', () => {
    const raw = '# This is a comment\n\n*/5 * * * * /script.sh\n# Another comment';
    const entries = parseCrontab(raw);

    assert.equal(entries.length, 1);
    assert.equal(entries[0].command, '/script.sh');
  });

  it('skips lines with fewer than 6 parts', () => {
    const raw = '*/5 * * *\n*/5 * * * * /valid.sh';
    const entries = parseCrontab(raw);

    assert.equal(entries.length, 1);
  });

  it('handles commands with spaces', () => {
    const raw = '0 0 * * * /usr/bin/cmd --flag value extra';
    const entries = parseCrontab(raw);

    assert.equal(entries[0].command, '/usr/bin/cmd --flag value extra');
  });

  it('returns empty array for empty input', () => {
    assert.deepEqual(parseCrontab(''), []);
  });

  it('handles mixed enabled and disabled entries', () => {
    const raw = '*/5 * * * * /active.sh\n#DISABLED# 0 3 * * * /paused.sh\n0 * * * * /hourly.sh';
    const entries = parseCrontab(raw);
    assert.equal(entries.length, 3);
    assert.equal(entries[0].enabled, true);
    assert.equal(entries[1].enabled, false);
    assert.equal(entries[2].enabled, true);
  });

  it('preserves raw field', () => {
    const raw = '*/5 * * * * /script.sh';
    const entries = parseCrontab(raw);
    assert.equal(entries[0].raw, '*/5 * * * * /script.sh');
  });

  it('preserves raw field for disabled entry', () => {
    const raw = '#DISABLED# 0 3 * * * /backup.sh';
    const entries = parseCrontab(raw);
    assert.equal(entries[0].raw, '#DISABLED# 0 3 * * * /backup.sh');
  });

  it('assigns sequential indices', () => {
    const raw = '0 * * * * /a\n*/5 * * * * /b\n0 0 * * * /c';
    const entries = parseCrontab(raw);

    assert.equal(entries[0].index, 0);
    assert.equal(entries[1].index, 1);
    assert.equal(entries[2].index, 2);
  });
});

describe('buildCrontabLine', () => {
  it('builds an enabled crontab line', () => {
    const entry = {
      minute: '*/5', hour: '*', dayOfMonth: '*', month: '*', dayOfWeek: '*',
      command: '/usr/bin/check.sh', enabled: true,
    };
    assert.equal(buildCrontabLine(entry), '*/5 * * * * /usr/bin/check.sh');
  });

  it('builds a disabled crontab line', () => {
    const entry = {
      minute: '0', hour: '3', dayOfMonth: '*', month: '*', dayOfWeek: '*',
      command: '/usr/bin/backup.sh', enabled: false,
    };
    assert.equal(buildCrontabLine(entry), '#DISABLED# 0 3 * * * /usr/bin/backup.sh');
  });

  it('roundtrips with parseCrontab', () => {
    const original = '*/10 2 * * 1 /home/user/weekly.sh --verbose';
    const parsed = parseCrontab(original);
    const rebuilt = buildCrontabLine(parsed[0]);
    assert.equal(rebuilt, original);
  });

  it('roundtrips disabled entry with parseCrontab', () => {
    const original = '#DISABLED# 0 3 * * * /usr/bin/backup.sh';
    const parsed = parseCrontab(original);
    const rebuilt = buildCrontabLine(parsed[0]);
    assert.equal(rebuilt, original);
  });
});

describe('systemCrontabScript', () => {
  // Runs the real shell script: the rule lives in bash, not in JavaScript
  function listed({ debian }) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crond-'));
    try {
      for (const name of ['backup-db', 'log_rotate', 'old-job.disabled', 'edited.bak']) {
        fs.writeFileSync(path.join(dir, name), `0 3 * * * root /usr/bin/${name}\n`);
      }
      const marker = path.join(dir, debian ? 'marker/debian_version' : 'marker/absent');
      fs.mkdirSync(path.dirname(marker));
      if (debian) fs.writeFileSync(marker, '12\n');
      const out = execFileSync('bash', ['-c', systemCrontabScript(dir, marker)], { encoding: 'utf8' });
      return [...out.matchAll(/^=== (.+) ===$/gm)].map(m => m[1]).sort();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  it('skips files Debian-family cron ignores', () => {
    assert.deepEqual(listed({ debian: true }), ['backup-db', 'log_rotate']);
  });

  it('keeps dotted names where the rule does not apply', () => {
    assert.deepEqual(listed({ debian: false }), ['backup-db', 'edited.bak', 'log_rotate', 'old-job.disabled']);
  });
});
