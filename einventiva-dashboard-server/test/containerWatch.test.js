const { test, describe } = require('node:test');
const assert = require('node:assert');
const { computeRestartDeltas, toSnapshot } = require('../services/containerWatch');

const c = (name, restartCount, oomKilled = false) => ({ name, restartCount, oomKilled });

describe('computeRestartDeltas', () => {
  test('flags containers whose restart count grew', () => {
    const prev = toSnapshot([c('api', 2), c('web', 0)]);
    const deltas = computeRestartDeltas(prev, [c('api', 5), c('web', 0)]);
    assert.strictEqual(deltas.length, 1);
    assert.deepStrictEqual(deltas[0], { name: 'api', delta: 3, total: 5, oomKilled: false });
  });

  test('carries the OOM flag on flagged containers', () => {
    const prev = toSnapshot([c('worker', 1)]);
    const deltas = computeRestartDeltas(prev, [c('worker', 4, true)]);
    assert.strictEqual(deltas[0].oomKilled, true);
  });

  test('new containers are baselined, not flagged', () => {
    const prev = toSnapshot([c('api', 2)]);
    const deltas = computeRestartDeltas(prev, [c('api', 2), c('fresh', 7)]);
    assert.deepStrictEqual(deltas, []);
  });

  test('empty previous snapshot (first run) yields no deltas', () => {
    assert.deepStrictEqual(computeRestartDeltas(new Map(), [c('api', 9)]), []);
  });

  test('a recreated container (count reset to 0) is not flagged', () => {
    const prev = toSnapshot([c('api', 5)]);
    assert.deepStrictEqual(computeRestartDeltas(prev, [c('api', 0)]), []);
  });

  test('stable counts stay quiet', () => {
    const containers = [c('a', 1), c('b', 0), c('c', 3)];
    assert.deepStrictEqual(computeRestartDeltas(toSnapshot(containers), containers), []);
  });
});
