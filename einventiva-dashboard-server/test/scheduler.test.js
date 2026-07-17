const { test, describe } = require('node:test');
const assert = require('node:assert');
const { parseCron, isValidCron, cronMatches, dueScripts, resolveTargetServers } = require('../services/scheduler');

// Local-time date helper: 2026-07-15 was a Wednesday (dow 3)
const at = (hour, minute, day = 15, month = 7) => new Date(2026, month - 1, day, hour, minute, 0);

describe('parseCron / isValidCron', () => {
  test('accepts common expressions', () => {
    for (const expr of ['* * * * *', '*/15 * * * *', '0 3 * * *', '30 2 * * 0', '0 */6 * * *', '0 9 1,15 * *', '0 9 * * 1-5']) {
      assert.ok(isValidCron(expr), expr);
    }
  });

  test('rejects malformed expressions', () => {
    for (const expr of ['', '* * * *', '* * * * * *', '60 * * * *', '* 24 * * *', 'a * * * *', '*/0 * * * *', '5-2 * * * *', null, undefined]) {
      assert.ok(!isValidCron(expr), String(expr));
    }
  });

  test('normalizes Sunday as 0 and 7', () => {
    assert.ok(parseCron('0 0 * * 7').dow.has(0));
    assert.ok(parseCron('0 0 * * 0').dow.has(0));
  });
});

describe('cronMatches', () => {
  test('every minute matches always', () => {
    assert.ok(cronMatches(parseCron('* * * * *'), at(13, 37)));
  });

  test('*/15 matches only quarter hours', () => {
    const p = parseCron('*/15 * * * *');
    assert.ok(cronMatches(p, at(10, 0)));
    assert.ok(cronMatches(p, at(10, 45)));
    assert.ok(!cronMatches(p, at(10, 20)));
  });

  test('daily at 3:00 matches only that minute', () => {
    const p = parseCron('0 3 * * *');
    assert.ok(cronMatches(p, at(3, 0)));
    assert.ok(!cronMatches(p, at(3, 1)));
    assert.ok(!cronMatches(p, at(4, 0)));
  });

  test('weekday range excludes the weekend', () => {
    const p = parseCron('0 9 * * 1-5');
    assert.ok(cronMatches(p, at(9, 0, 15))); // Wednesday
    assert.ok(!cronMatches(p, at(9, 0, 19))); // Sunday 2026-07-19
  });

  test('vixie dom/dow OR when both are restricted', () => {
    // Day 15 OR Sunday: matches Wed the 15th and Sun the 19th, not Thu the 16th
    const p = parseCron('0 0 15 * 0');
    assert.ok(cronMatches(p, at(0, 0, 15)));
    assert.ok(cronMatches(p, at(0, 0, 19)));
    assert.ok(!cronMatches(p, at(0, 0, 16)));
  });
});

describe('dueScripts', () => {
  const scripts = [
    { id: 'a', schedule: '* * * * *' },
    { id: 'b', schedule: '0 3 * * *' },
    { id: 'c', schedule: null },
    { id: 'd', schedule: 'garbage' },
  ];

  test('returns matching schedules only, skipping null and malformed', () => {
    assert.deepStrictEqual(dueScripts(scripts, at(10, 30)).map(s => s.id), ['a']);
    assert.deepStrictEqual(dueScripts(scripts, at(3, 0)).map(s => s.id), ['a', 'b']);
  });
});

describe('resolveTargetServers', () => {
  const keys = ['prod', 'qa', 'infra'];

  test('star and empty mean all servers', () => {
    assert.deepStrictEqual(resolveTargetServers({ schedule_servers: '*' }, keys), keys);
    assert.deepStrictEqual(resolveTargetServers({ schedule_servers: null }, keys), keys);
  });

  test('filters to known keys', () => {
    assert.deepStrictEqual(resolveTargetServers({ schedule_servers: 'qa, infra' }, keys), ['qa', 'infra']);
    assert.deepStrictEqual(resolveTargetServers({ schedule_servers: 'qa,ghost' }, keys), ['qa']);
  });
});
