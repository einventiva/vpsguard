const { exec } = require('child_process');
const { promisify } = require('util');
const { log } = require('./logger');
const { COMMAND_TIMEOUT } = require('../config');

const execPromise = promisify(exec);

const SSH_WARNINGS = [
  'WARNING: connection is not using',
  'store now, decrypt later',
  'server may need to be upgraded',
  'openssh.com',
  '*****',
];

function isSSHWarning(text) {
  return SSH_WARNINGS.some(w => text.includes(w));
}

function filterWarnings(text) {
  return text.split('\n').filter(line => !isSSHWarning(line)).join('\n');
}

function injectSudoPassword(command, password) {
  if (!password || !command.includes('sudo')) return command;
  return command.replace(/sudo /g, `echo '${password.replace(/'/g, "'\\''")}' | sudo -S `);
}

async function executeSSHCommand(serverAlias, command, timeout = COMMAND_TIMEOUT) {
  try {
    const sshCommand = `ssh ${serverAlias} "${command}"`;
    log(`Executing SSH command`, { server: serverAlias, command: command.substring(0, 100) });
    const { stdout, stderr } = await execPromise(sshCommand, { timeout });
    if (stderr && !stderr.includes('Warning')) {
      log(`SSH command stderr`, { server: serverAlias, stderr: stderr.substring(0, 200) });
    }
    return stdout;
  } catch (error) {
    log(`SSH command failed`, { server: serverAlias, error: error.message });
    throw error;
  }
}

module.exports = { executeSSHCommand, filterWarnings, isSSHWarning, injectSudoPassword, exec };
