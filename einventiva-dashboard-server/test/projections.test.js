const { test, describe } = require('node:test');
const assert = require('node:assert');
const { linearRegression, projectDisk, projectMemory } = require('../services/projections');

const HOUR = 3600e3;
const DAY = 24 * HOUR;
const T0 = 1750000000000; // fixed epoch base

// rows shaped like db.getRollup / getMetricsBucketed output
function rows(field, values, stepMs) {
  return values.map((v, i) => ({
    timestamp: new Date(T0 + i * stepMs).toISOString(),
    [field]: v,
  }));
}

describe('linearRegression', () => {
  test('fits a perfect line with r2=1', () => {
    const points = [0, 1, 2, 3, 4].map(i => ({ x: i * HOUR, y: 10 + i * 2 }));
    const fit = linearRegression(points);
    assert.ok(Math.abs(fit.slope * HOUR - 2) < 1e-9);
    assert.ok(Math.abs(fit.intercept - 10) < 1e-6);
    assert.ok(fit.r2 > 0.999);
  });

  test('returns null for fewer than 2 points', () => {
    assert.strictEqual(linearRegression([{ x: 1, y: 1 }]), null);
  });

  test('flat series has zero slope', () => {
    const points = [0, 1, 2, 3].map(i => ({ x: i * HOUR, y: 50 }));
    const fit = linearRegression(points);
    assert.strictEqual(fit.slope, 0);
  });
});

describe('projectDisk', () => {
  test('computes ETA for a steadily filling disk', () => {
    // 1%/day growth from 50%, hourly points over 3 days
    const values = Array.from({ length: 73 }, (_, i) => 50 + i / 24);
    const p = projectDisk(rows('disk', values, HOUR));
    assert.strictEqual(p.insufficient, false);
    assert.ok(Math.abs(p.slopePerDay - 1) < 0.01, `slopePerDay=${p.slopePerDay}`);
    // current = 53, so (100-53)/1 = ~47 days
    assert.ok(Math.abs(p.etaDays - 47) < 1, `etaDays=${p.etaDays}`);
  });

  test('stable disk yields no ETA', () => {
    const values = Array.from({ length: 48 }, () => 60);
    const p = projectDisk(rows('disk', values, HOUR));
    assert.strictEqual(p.insufficient, false);
    assert.strictEqual(p.etaDays, null);
  });

  test('shrinking disk yields no ETA', () => {
    const values = Array.from({ length: 48 }, (_, i) => 60 - i / 24);
    const p = projectDisk(rows('disk', values, HOUR));
    assert.strictEqual(p.etaDays, null);
  });

  test('marks insufficient with under 24h of span', () => {
    const values = Array.from({ length: 20 }, (_, i) => 50 + i);
    const p = projectDisk(rows('disk', values, 30 * 60000)); // 10h span
    assert.strictEqual(p.insufficient, true);
    assert.strictEqual(p.etaDays, null);
  });

  test('ignores zero (offline) samples', () => {
    const values = Array.from({ length: 60 }, (_, i) => (i % 10 === 0 ? 0 : 50 + i / 24));
    const p = projectDisk(rows('disk', values, HOUR));
    assert.strictEqual(p.insufficient, false);
    assert.ok(p.slopePerDay > 0.5);
  });
});

describe('projectMemory', () => {
  test('flags a sustained climb as trending up', () => {
    // +1%/h over 12h, 30-min points
    const values = Array.from({ length: 25 }, (_, i) => 40 + i * 0.5);
    const p = projectMemory(rows('memory', values, 30 * 60000));
    assert.strictEqual(p.trendingUp, true);
    assert.ok(Math.abs(p.slopePerHour - 1) < 0.05, `slopePerHour=${p.slopePerHour}`);
  });

  test('noisy but flat memory is not flagged', () => {
    const values = Array.from({ length: 25 }, (_, i) => 50 + (i % 2 === 0 ? 3 : -3));
    const p = projectMemory(rows('memory', values, 30 * 60000));
    assert.strictEqual(p.trendingUp, false);
  });

  test('insufficient with a short window', () => {
    const values = Array.from({ length: 6 }, (_, i) => 40 + i);
    const p = projectMemory(rows('memory', values, 30 * 60000));
    assert.strictEqual(p.insufficient, true);
  });
});
