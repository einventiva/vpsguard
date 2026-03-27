const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const os = require('os');
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

// ─── SSH Multiplexing (ControlMaster) ──────────────────────────────
const CONTROL_DIR = '/tmp/dshmux';

function ensureControlDir() {
  if (!fs.existsSync(CONTROL_DIR)) {
    fs.mkdirSync(CONTROL_DIR, { mode: 0o700, recursive: true });
  }
}

function getControlPath(serverAlias) {
  // Keep path short — macOS has a 104-byte limit on Unix socket paths
  return path.join(CONTROL_DIR, serverAlias);
}

function getMuxOpts(serverAlias) {
  const controlPath = getControlPath(serverAlias);
  return `-o ControlMaster=auto -o ControlPath=${controlPath} -o ControlPersist=120 -o LogLevel=ERROR`;
}

async function executeSSHCommand(serverAlias, command, timeout = COMMAND_TIMEOUT) {
  ensureControlDir();
  try {
    const muxOpts = getMuxOpts(serverAlias);
    const sshCommand = `ssh ${muxOpts} ${serverAlias} "${command}"`;
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

function closeMuxConnection(serverAlias) {
  const controlPath = getControlPath(serverAlias);
  exec(`ssh -o ControlPath=${controlPath} -O exit ${serverAlias} 2>/dev/null`);
}

function closeAllMuxConnections() {
  try {
    if (!fs.existsSync(CONTROL_DIR)) return;
    const files = fs.readdirSync(CONTROL_DIR);
    for (const file of files) {
      const fullPath = path.join(CONTROL_DIR, file);
      exec(`ssh -o ControlPath=${fullPath} -O exit dummy 2>/dev/null`);
    }
    log('Closed all SSH mux connections');
  } catch (_) { /* ignore cleanup errors */ }
}

module.exports = { executeSSHCommand, filterWarnings, isSSHWarning, injectSudoPassword, closeMuxConnection, closeAllMuxConnections, exec };
