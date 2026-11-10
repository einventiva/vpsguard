const { describe, it, mock, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createWakeGuard, DEFAULT_GAP_MS } = require('../services/wakeGuard');

function fakeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

describe('createWakeGuard', () => {
  it('does not suppress while the process keeps running', () => {
    const clock = fakeClock();
    const guard = createWakeGuard({ graceMs: 180000, now: clock.now });
    for (let i = 0; i < 20; i++) {
      clock.advance(5000);
      assert.equal(guard.suppressing(), false);
    }
  });

  it('suppresses after a gap longer than the threshold, until the grace ends', () => {
    const clock = fakeClock();
    const wakes = [];
    const guard = createWakeGuard({ graceMs: 180000, now: clock.now, onWake: (w) => wakes.push(w) });
    clock.advance(DEFAULT_GAP_MS + 60000);
    assert.equal(guard.suppressing(), true);
    assert.deepEqual(wakes, [{ sleptMs: DEFAULT_GAP_MS + 60000 }]);

    // Heartbeats keep the process "seen" so the grace can run out
    for (let elapsed = 0; elapsed < 175000; elapsed += 5000) {
      clock.advance(5000);
      guard.observe();
    }
    assert.equal(guard.suppressing(), true, 'still inside the grace');
    clock.advance(5000);
    assert.equal(guard.suppressing(), false, 'grace is over');
    assert.equal(wakes.length, 1);
  });

  it('sees the gap even when a failure arrives before the next heartbeat', () => {
    const clock = fakeClock();
    const guard = createWakeGuard({ graceMs: 180000, now: clock.now });
    guard.observe();
    clock.advance(10 * 60000);
    // No observe() in between: the failing probe is the first to run
    assert.equal(guard.suppressing(), true);
  });

  it('a new dark wake starts a new grace', () => {
    const clock = fakeClock();
    const guard = createWakeGuard({ graceMs: 180000, now: clock.now });
    clock.advance(60000);
    assert.equal(guard.suppressing(), true);
    clock.advance(170000);
    assert.equal(guard.suppressing(), true, 'the second gap restarts the grace');
  });

  it('a grace of 0 turns the guard off', () => {
    const clock = fakeClock();
    const guard = createWakeGuard({ graceMs: 0, now: clock.now });
    clock.advance(10 * 60000);
    assert.equal(guard.suppressing(), false);
  });
});

describe('service checks right after waking', () => {
  const TMP_DB = path.join(os.tmpdir(), `vpsguard-wake-test-${process.pid}.db`);
  process.env.DB_PATH = TMP_DB;
  process.env.API_TOKEN = process.env.API_TOKEN || 'test';
  after(() => {
    mock.timers.reset();
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(TMP_DB + suffix); } catch { /* may not exist */ }
    }
  });

  it('a failure after a long gap is neither recorded nor alerted', async () => {
    mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
    const db = require('../db');
    const { runDueChecks } = require('../services/backgroundJobs');
    db.initDB();
    // Port 9 (discard) is closed locally, so the probe fails fast
    db.createServiceCheck({
      id: 'wake-check', name: 'Wake', kind: 'tcp', target: '127.0.0.1:9',
      runFrom: 'dashboard', intervalSec: 60, failuresToOpen: 1, timeoutMs: 2000,
    });
    const io = { emit() {} };
    const getServers = () => ({});

    await runDueChecks(io, getServers);
    assert.equal(db.getCheckResults('wake-check', 10).length, 1, 'awake: the failure is recorded');
    const first = db.getOpenAlert('dashboard', 'service', 'wake-check');
    assert.ok(first, 'awake: one failure opens the alert');
    db.resolveAlert(first.id);

    // The laptop sleeps for ten minutes
    mock.timers.tick(10 * 60000);
    await runDueChecks(io, getServers);
    assert.equal(db.getCheckResults('wake-check', 10).length, 1, 'right after waking: nothing new recorded');
    assert.equal(db.getOpenAlert('dashboard', 'service', 'wake-check'), undefined, 'and no alert opened');
  });
});
