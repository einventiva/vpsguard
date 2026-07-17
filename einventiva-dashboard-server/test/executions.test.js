const { test, describe } = require('node:test');
const assert = require('node:assert');
const { truncateOutput } = require('../db');

describe('truncateOutput', () => {
  test('passes through null and undefined', () => {
    assert.strictEqual(truncateOutput(null), null);
    assert.strictEqual(truncateOutput(undefined), null);
  });

  test('keeps short output untouched', () => {
    assert.strictEqual(truncateOutput('hello\nworld'), 'hello\nworld');
    assert.strictEqual(truncateOutput(''), '');
  });

  test('keeps the tail when output exceeds the cap (errors print last)', () => {
    const big = 'x'.repeat(60 * 1024) + 'THE-ERROR-LINE';
    const result = truncateOutput(big);
    assert.ok(result.length < big.length);
    assert.ok(result.startsWith('…[truncated'));
    assert.ok(result.endsWith('THE-ERROR-LINE'));
  });

  test('coerces non-string values', () => {
    assert.strictEqual(truncateOutput(42), '42');
  });
});
