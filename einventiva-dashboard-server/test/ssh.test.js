const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { filterWarnings, isSSHWarning, injectSudoPassword } = require('../services/ssh');

describe('isSSHWarning', () => {
  it('detects "WARNING: connection is not using"', () => {
    assert.equal(isSSHWarning('WARNING: connection is not using secure channel'), true);
  });

  it('detects "store now, decrypt later"', () => {
    assert.equal(isSSHWarning('store now, decrypt later attack'), true);
  });

  it('detects "server may need to be upgraded"', () => {
    assert.equal(isSSHWarning('server may need to be upgraded to a newer version'), true);
  });

  it('detects openssh.com', () => {
    assert.equal(isSSHWarning('see openssh.com for details'), true);
  });

  it('detects *****', () => {
    assert.equal(isSSHWarning('*****'), true);
  });

  it('returns false for normal text', () => {
    assert.equal(isSSHWarning('Linux server 5.15.0-1 x86_64'), false);
  });

  it('returns false for empty string', () => {
    assert.equal(isSSHWarning(''), false);
  });
});

describe('filterWarnings', () => {
  it('removes warning lines from output', () => {
    const input = [
      'WARNING: connection is not using secure channel',
      'actual data line 1',
      'store now, decrypt later',
      'actual data line 2',
    ].join('\n');

    const result = filterWarnings(input);
    assert.equal(result, 'actual data line 1\nactual data line 2');
  });

  it('returns empty string when all lines are warnings', () => {
    const input = 'WARNING: connection is not using\n*****';
    assert.equal(filterWarnings(input), '');
  });

  it('preserves text with no warnings', () => {
    const input = 'line 1\nline 2\nline 3';
    assert.equal(filterWarnings(input), input);
  });

  it('handles single line input', () => {
    assert.equal(filterWarnings('just one line'), 'just one line');
  });

  it('handles empty string', () => {
    assert.equal(filterWarnings(''), '');
  });
});

describe('injectSudoPassword', () => {
  it('replaces sudo with password pipe', () => {
    const result = injectSudoPassword('sudo apt update', 'mypass');
    assert.equal(result, "echo 'mypass' | sudo -S apt update");
  });

  it('handles multiple sudo occurrences', () => {
    const result = injectSudoPassword('sudo cmd1 && sudo cmd2', 'pass');
    assert.equal(result, "echo 'pass' | sudo -S cmd1 && echo 'pass' | sudo -S cmd2");
  });

  it('returns command unchanged when no password', () => {
    assert.equal(injectSudoPassword('sudo apt update', ''), 'sudo apt update');
    assert.equal(injectSudoPassword('sudo apt update', null), 'sudo apt update');
  });

  it('returns command unchanged when no sudo', () => {
    assert.equal(injectSudoPassword('ls -la', 'pass'), 'ls -la');
  });

  it('escapes single quotes in password', () => {
    const result = injectSudoPassword("sudo cmd", "it's");
    assert.equal(result, "echo 'it'\\''s' | sudo -S cmd");
  });

  it('returns command unchanged when password is undefined', () => {
    assert.equal(injectSudoPassword('sudo apt update', undefined), 'sudo apt update');
  });
});
