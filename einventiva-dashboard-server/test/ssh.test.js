const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { filterWarnings, isSSHWarning, injectSudoPassword, maskSudoPassword, describeExecFailure } = require('../services/ssh');

describe('describeExecFailure', () => {
  it('names a timeout, which exec reports with no stderr at all', () => {
    // The real symptom: a probe that hung looked identical to a command
    // that failed, because both arrive as "Command failed: <ssh line>"
    const msg = describeExecFailure({ killed: true, stderr: '', message: 'Command failed: ssh ...' }, 20000);
    assert.match(msg, /no response within 20s/);
  });

  it('surfaces the tail of stderr, keeping two lines for context', () => {
    // Real ssh failures are often two lines ("Permission denied (publickey)."
    // under a connect line), so the tail is kept rather than the last line
    const err = { killed: false, code: 255, stderr: 'Host key verification failed.\nssh: connect to host x port 22: Connection refused\n' };
    assert.equal(
      describeExecFailure(err, 30000),
      'Host key verification failed.; ssh: connect to host x port 22: Connection refused'
    );
  });

  it('never leaks an injected sudo password echoed back by the shell', () => {
    const err = { code: 1, stderr: "sh: line 1: echo 'hunter2' | sudo -S apt update: not found" };
    const msg = describeExecFailure(err, 30000);
    assert.ok(!msg.includes('hunter2'), msg);
    assert.match(msg, /sudo -S/);
  });

  it('drops ssh banner warnings rather than reporting them as the cause', () => {
    const err = { code: 3, stderr: 'WARNING: connection is not using a post-quantum key exchange algorithm.\n' };
    assert.equal(describeExecFailure(err, 30000), 'exited 3 with no error output');
  });
});

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

  it('does NOT inject into the word sudo inside quoted strings (password leak)', () => {
    // Regression: safe-reboot's final echo mentions "sudo shutdown -c" —
    // a blind global replace printed the password verbatim in the output
    const cmd = 'sudo shutdown -r +1 "msg" && echo "Reboot scheduled. Run: sudo shutdown -c to cancel."';
    const result = injectSudoPassword(cmd, 'secret123');
    assert.equal(
      result,
      'echo \'secret123\' | sudo -S shutdown -r +1 "msg" && echo "Reboot scheduled. Run: sudo shutdown -c to cancel."'
    );
    assert.ok(result.split('secret123').length === 2, 'password must appear exactly once');
  });

  it('injects at command positions: pipes, subshells and semicolons', () => {
    assert.equal(injectSudoPassword('a | sudo tee f', 'p'), "a | echo 'p' | sudo -S tee f");
    assert.equal(injectSudoPassword('x; (sudo y)', 'p'), "x; (echo 'p' | sudo -S y)");
  });
});

describe('maskSudoPassword', () => {
  it('hides the password in injected commands for logging', () => {
    const injected = injectSudoPassword('sudo apt update && sudo apt upgrade', 'hunter2');
    const masked = maskSudoPassword(injected);
    assert.ok(!masked.includes('hunter2'));
    assert.ok(masked.includes("echo '****' | sudo -S"));
  });

  it('masks passwords containing escaped quotes', () => {
    const injected = injectSudoPassword('sudo cmd', "pa'ss");
    assert.ok(!maskSudoPassword(injected).includes('pa'));
  });

  it('leaves commands without injection untouched', () => {
    assert.equal(maskSudoPassword('ls -la'), 'ls -la');
  });
});
