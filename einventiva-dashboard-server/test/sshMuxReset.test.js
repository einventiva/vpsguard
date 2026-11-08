const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { recordMuxOutcome, resetMuxConnection, MUX_RESET_AFTER_TIMEOUTS } = require('../services/ssh');

describe('recordMuxOutcome', () => {
  it('asks for a reset only after the threshold of consecutive timeouts', () => {
    const alias = 'mux-threshold';
    for (let i = 1; i < MUX_RESET_AFTER_TIMEOUTS; i++) {
      assert.equal(recordMuxOutcome(alias, true), false);
    }
    assert.equal(recordMuxOutcome(alias, true), true);
  });

  it('restarts the count after a reset', () => {
    const alias = 'mux-restart';
    for (let i = 0; i < MUX_RESET_AFTER_TIMEOUTS; i++) recordMuxOutcome(alias, true);
    assert.equal(recordMuxOutcome(alias, true), false);
  });

  it('a success clears the streak', () => {
    const alias = 'mux-success';
    for (let i = 1; i < MUX_RESET_AFTER_TIMEOUTS; i++) recordMuxOutcome(alias, true);
    recordMuxOutcome(alias, false);
    assert.equal(recordMuxOutcome(alias, true), false);
  });

  it('non-timeout failures do not count toward a reset', () => {
    const alias = 'mux-nontimeout';
    for (let i = 0; i < MUX_RESET_AFTER_TIMEOUTS * 2; i++) {
      assert.equal(recordMuxOutcome(alias, false), false);
    }
  });

  it('tracks servers independently', () => {
    for (let i = 1; i < MUX_RESET_AFTER_TIMEOUTS; i++) recordMuxOutcome('mux-a', true);
    assert.equal(recordMuxOutcome('mux-b', true), false);
    assert.equal(recordMuxOutcome('mux-a', true), true);
  });
});

describe('resetMuxConnection', () => {
  it('sends -O exit with a timeout and leaves the socket when it works', () => {
    let cmd, opts, unlinked = false;
    resetMuxConnection('srv', {
      execFn: (c, o, cb) => { cmd = c; opts = o; cb(null); },
      unlink: () => { unlinked = true; },
    });
    assert.match(cmd, /-O exit srv$/);
    assert.match(cmd, /ControlPath=\/tmp\/dshmux\/srv/);
    assert.ok(opts.timeout > 0);
    assert.equal(unlinked, false);
  });

  it('removes the control socket when the master does not answer', () => {
    let unlinkedPath;
    resetMuxConnection('srv', {
      execFn: (_c, _o, cb) => cb(new Error('timed out')),
      unlink: (p) => { unlinkedPath = p; },
    });
    assert.equal(unlinkedPath, '/tmp/dshmux/srv');
  });
});
