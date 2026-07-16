const { test, describe } = require('node:test');
const assert = require('node:assert');
const { parsePgSample } = require('../services/pgHistory');

const CTX = { server: 'prod', container: 'app-db', timestamp: '2026-07-16T21:00:00.000Z' };

function sampleJson(overrides = {}) {
  return JSON.stringify({
    max_connections: 100,
    total_connections: 12,
    replication_lag_bytes: 0,
    databases: [
      { datname: 'app', size_bytes: 50e6, connections: 8, blks_hit: 900, blks_read: 100 },
      { datname: 'analytics', size_bytes: 200e6, connections: 3, blks_hit: 400, blks_read: 600 },
    ],
    ...overrides,
  });
}

describe('parsePgSample', () => {
  test('produces one row per database plus a container aggregate', () => {
    const rows = parsePgSample(sampleJson(), CTX);
    assert.strictEqual(rows.length, 3);

    const app = rows.find(r => r.datname === 'app');
    assert.strictEqual(app.sizeBytes, 50e6);
    assert.strictEqual(app.connections, 8);
    assert.strictEqual(app.cacheHitRatio, 90);

    const agg = rows.find(r => r.datname === '');
    assert.strictEqual(agg.connections, 12);
    assert.strictEqual(agg.maxConnections, 100);
    assert.strictEqual(agg.sizeBytes, 250e6);
    // (900+400)/(900+400+100+600) = 1300/2000 = 65%
    assert.strictEqual(agg.cacheHitRatio, 65);
    assert.strictEqual(agg.replicationLagBytes, 0);
    assert.strictEqual(agg.server, 'prod');
    assert.strictEqual(agg.container, 'app-db');
  });

  test('ignores SSH warning noise before the JSON line', () => {
    const raw = 'WARNING: connection is not using post-quantum key exchange\n' + sampleJson();
    const rows = parsePgSample(raw, CTX);
    assert.strictEqual(rows.length, 3);
  });

  test('handles zero databases (fresh instance)', () => {
    const rows = parsePgSample(sampleJson({ databases: [] }), CTX);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].datname, '');
    assert.strictEqual(rows[0].sizeBytes, 0);
    assert.strictEqual(rows[0].cacheHitRatio, null);
  });

  test('captures replication lag', () => {
    const rows = parsePgSample(sampleJson({ replication_lag_bytes: 1048576 }), CTX);
    assert.strictEqual(rows.find(r => r.datname === '').replicationLagBytes, 1048576);
  });

  test('returns null on garbage output', () => {
    assert.strictEqual(parsePgSample('psql: error: connection refused', CTX), null);
    assert.strictEqual(parsePgSample('', CTX), null);
    assert.strictEqual(parsePgSample('{not json', CTX), null);
  });

  test('null cache ratio when no block activity', () => {
    const rows = parsePgSample(sampleJson({
      databases: [{ datname: 'idle', size_bytes: 1e6, connections: 0, blks_hit: 0, blks_read: 0 }],
    }), CTX);
    assert.strictEqual(rows.find(r => r.datname === 'idle').cacheHitRatio, null);
  });
});
