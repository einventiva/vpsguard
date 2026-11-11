const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createNetworkGuard, interpretStatus, findTailscaleBin } = require('../services/networkGuard');

function fakeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

describe('interpretStatus', () => {
  it('is up when running with at least one online peer', () => {
    const r = interpretStatus({ BackendState: 'Running', Peer: { a: { Online: true }, b: { Online: false } } });
    assert.deepEqual(r, { ok: true, state: 'Running', peersOnline: 1, reason: null });
  });

  it('is down when logged out', () => {
    const r = interpretStatus({ BackendState: 'NeedsLogin', Peer: null });
    assert.equal(r.ok, false);
    assert.equal(r.state, 'NeedsLogin');
    assert.match(r.reason, /NeedsLogin/);
  });

  it('is down when running but no peer is visible (ACL/tags)', () => {
    const r = interpretStatus({ BackendState: 'Running', Peer: {} });
    assert.equal(r.ok, false);
    assert.equal(r.peersOnline, 0);
    assert.match(r.reason, /no online peers/);
  });

  it('is down when every peer is offline', () => {
    assert.equal(interpretStatus({ BackendState: 'Running', Peer: { a: { Online: false } } }).ok, false);
  });
});

describe('findTailscaleBin', () => {
  it('returns the first candidate that exists', () => {
    assert.equal(findTailscaleBin(['/a', '/b', '/c'], p => p !== '/a'), '/b');
  });

  it('returns null when none exists', () => {
    assert.equal(findTailscaleBin(['/a'], () => false), null);
  });
});

describe('createNetworkGuard', () => {
  it('without a probe is disabled and never reports down', async () => {
    const guard = createNetworkGuard();
    assert.equal(guard.enabled, false);
    assert.equal(await guard.isDown(), false);
  });

  it('caches the probe result for the ttl', async () => {
    const clock = fakeClock();
    let calls = 0;
    const guard = createNetworkGuard({
      ttlMs: 15000,
      now: clock.now,
      probe: async () => { calls++; return { ok: false, state: 'NeedsLogin', peersOnline: 0, reason: 'x' }; },
    });
    assert.equal(await guard.isDown(), true);
    assert.equal(await guard.isDown(), true);
    assert.equal(calls, 1);
    clock.advance(15000);
    await guard.isDown();
    assert.equal(calls, 2);
  });

  it('force refreshes regardless of the ttl', async () => {
    let calls = 0;
    const guard = createNetworkGuard({ probe: async () => { calls++; return { ok: true }; } });
    await guard.status();
    await guard.status({ force: true });
    assert.equal(calls, 2);
  });

  it('concurrent callers share one probe', async () => {
    let calls = 0;
    let release;
    const guard = createNetworkGuard({
      probe: () => { calls++; return new Promise(r => { release = () => r({ ok: true }); }); },
    });
    const a = guard.isDown();
    const b = guard.isDown();
    release();
    assert.deepEqual(await Promise.all([a, b]), [false, false]);
    assert.equal(calls, 1);
  });

  it('a probe that throws counts as down', async () => {
    const guard = createNetworkGuard({ probe: async () => { throw new Error('boom'); } });
    assert.equal(await guard.isDown(), true);
    assert.equal(guard.current().reason, 'boom');
  });

  it('recovers when the probe comes back', async () => {
    const clock = fakeClock();
    let ok = false;
    const guard = createNetworkGuard({ ttlMs: 1000, now: clock.now, probe: async () => ({ ok }) });
    assert.equal(await guard.isDown(), true);
    ok = true;
    clock.advance(1000);
    assert.equal(await guard.isDown(), false);
  });
});
