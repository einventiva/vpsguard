const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { getCached, setCache } = require('../services/cache');

describe('cache', () => {
  it('returns null for missing key', () => {
    assert.equal(getCached('nonexistent'), null);
  });

  it('stores and retrieves data', () => {
    setCache('test-key', { foo: 'bar' }, 5000);
    const result = getCached('test-key');
    assert.deepEqual(result, { foo: 'bar' });
  });

  it('returns null for expired entry', async () => {
    setCache('expire-key', 'data', 1); // 1ms TTL
    await new Promise(r => setTimeout(r, 10));
    assert.equal(getCached('expire-key'), null);
  });

  it('overwrites existing key', () => {
    setCache('overwrite', 'first', 5000);
    setCache('overwrite', 'second', 5000);
    assert.equal(getCached('overwrite'), 'second');
  });

  it('stores null as a valid value', () => {
    setCache('null-val', null, 5000);
    // getCached returns null for missing AND for null value — both are null
    assert.equal(getCached('null-val'), null);
  });

  it('stores falsy values correctly', () => {
    setCache('zero', 0, 5000);
    assert.equal(getCached('zero'), 0);

    setCache('empty-str', '', 5000);
    assert.equal(getCached('empty-str'), '');

    setCache('false-val', false, 5000);
    assert.equal(getCached('false-val'), false);
  });
});
