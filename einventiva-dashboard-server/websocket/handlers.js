const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const db = require('../db');
const { log } = require('../services/logger');
const { isSSHWarning } = require('../services/ssh');
const { injectSudoPassword } = require('../services/ssh');
const { SCRIPT_TIMEOUT } = require('../config');

const logSubscribers = new Map(); // socketId -> { server, container }

function registerHandlers(io, getServers) {
  io.on('connection', (socket) => {
    log('Socket.IO client connected', { id: socket.id });

    socket.on('subscribe:logs', ({ server, container }) => {
      const SERVERS = getServers();
      if (!SERVERS[server]) return;
      if (!/^[a-zA-Z0-9_.-]+$/.test(container)) return;
      logSubscribers.set(socket.id, { server, container });
      log('Client subscribed to logs', { id: socket.id, server, container });
    });

    socket.on('unsubscribe:logs', () => {
      logSubscribers.delete(socket.id);
    });

    // Streaming script execution
    socket.on('execute:script', ({ server: serverKey, script, password }) => {
      const SERVERS = getServers();
      if (!SERVERS[serverKey]) {
        socket.emit('script:error', { error: `Server '${serverKey}' not found` });
        return;
      }

      const scriptRow = db.getScript(script);
      if (!scriptRow) {
        socket.emit('script:error', { error: `Script '${script}' not found` });
        return;
      }

      const serverConfig = SERVERS[serverKey];
      const command = injectSudoPassword(scriptRow.command, password);
      const sshCommand = `ssh ${serverConfig.alias} "${command.replace(/"/g, '\\"')}"`;
      log('Streaming script execution', { server: serverKey, script });

      socket.emit('script:start', { script, server: serverKey });

      const startTime = Date.now();
      const child = exec(sshCommand, { timeout: SCRIPT_TIMEOUT });

      child.stdout.on('data', (chunk) => {
        socket.emit('script:output', { stream: 'stdout', data: chunk.toString() });
      });

      child.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        if (isSSHWarning(text)) return;
        socket.emit('script:output', { stream: 'stderr', data: text });
      });

      child.on('close', (code) => {
        socket.emit('script:done', { code, script, server: serverKey });
        log('Script execution finished', { server: serverKey, script, exitCode: code });
        db.logExecution({
          scriptId: script,
          server: serverKey,
          exitCode: code,
          startedAt: new Date(startTime).toISOString(),
          durationMs: Date.now() - startTime,
        });
      });

      child.on('error', (err) => {
        socket.emit('script:error', { error: err.message });
      });
    });

    // Streaming crontab command test
    socket.on('crontab:test', ({ server: serverKey, command }) => {
      const SERVERS = getServers();
      if (!SERVERS[serverKey]) {
        socket.emit('crontab:error', { error: `Server '${serverKey}' not found` });
        return;
      }
      if (!command) {
        socket.emit('crontab:error', { error: 'No command provided' });
        return;
      }

      const serverConfig = SERVERS[serverKey];
      const sshCommand = `ssh ${serverConfig.alias} "${command.replace(/"/g, '\\"')}"`;
      log('Streaming crontab test', { server: serverKey, command: command.substring(0, 100) });

      socket.emit('crontab:start', { command, server: serverKey });

      const child = exec(sshCommand, { timeout: SCRIPT_TIMEOUT });

      child.stdout.on('data', (chunk) => {
        socket.emit('crontab:output', { stream: 'stdout', data: chunk.toString() });
      });

      child.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        if (isSSHWarning(text)) return;
        socket.emit('crontab:output', { stream: 'stderr', data: text });
      });

      child.on('close', (code) => {
        socket.emit('crontab:done', { code, command, server: serverKey });
        log('Crontab test finished', { server: serverKey, exitCode: code });
      });

      child.on('error', (err) => {
        socket.emit('crontab:error', { error: err.message });
      });
    });

    // ─── Setup Wizard ─────────────────────────────────────────────────
    socket.on('wizard:setup', async ({ ip, port, rootPassword, newUser, newPassword, serverKey, displayName }) => {
      const SERVERS = getServers();
      const escQ = (s) => s.replace(/'/g, "'\\''");
      const sshOpts = '-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10';
      const sshDir = path.join(os.homedir(), '.ssh');
      const keyPath = path.join(sshDir, `dashboard_${serverKey}`);
      const alias = `dashboard_${serverKey}`;
      port = parseInt(port, 10) || 22;

      function maskPasswords(cmd) {
        return cmd.replace(/sshpass -p '[^']*'/g, "sshpass -p '****'")
                  .replace(/echo '[^']*' \| chpasswd/g, "echo '****' | chpasswd")
                  .replace(/echo '[^']*' \| sudo/g, "echo '****' | sudo");
      }

      function runStep(stepName, cmd, timeoutMs = 30000) {
        return new Promise((resolve) => {
          socket.emit('wizard:step', { step: stepName, status: 'running', message: `Running: ${stepName}` });
          socket.emit('wizard:output', { data: `\n$ ${maskPasswords(cmd)}\n` });
          const child = exec(cmd, { timeout: timeoutMs });
          child.stdout.on('data', (d) => socket.emit('wizard:output', { data: d.toString() }));
          child.stderr.on('data', (d) => {
            const text = d.toString();
            if (text.includes('WARNING:') || text.includes('store now') || text.includes('openssh.com') || text.includes('*****')) return;
            socket.emit('wizard:output', { data: text });
          });
          child.on('close', (code) => {
            if (code === 0) {
              socket.emit('wizard:step', { step: stepName, status: 'done', message: `Done: ${stepName}` });
              resolve(true);
            } else {
              socket.emit('wizard:step', { step: stepName, status: 'error', message: `Failed: ${stepName} (exit ${code})` });
              resolve(false);
            }
          });
          child.on('error', (err) => {
            socket.emit('wizard:step', { step: stepName, status: 'error', message: `Error: ${err.message}` });
            resolve(false);
          });
        });
      }

      try {
        // Step 1: Validation
        socket.emit('wizard:output', { data: `══════════════════════════════════════════════\n` });
        socket.emit('wizard:output', { data: `  Setup Wizard: ${displayName} (${serverKey})\n` });
        socket.emit('wizard:output', { data: `  Target: root@${ip}:${port}\n` });
        socket.emit('wizard:output', { data: `  New user: ${newUser}\n` });
        socket.emit('wizard:output', { data: `  SSH alias: dashboard_${serverKey}\n` });
        socket.emit('wizard:output', { data: `  Keypair: ~/.ssh/dashboard_${serverKey}\n` });
        socket.emit('wizard:output', { data: `══════════════════════════════════════════════\n\n` });
        socket.emit('wizard:step', { step: 'validate', status: 'running', message: 'Validating inputs...' });
        if (!ip || !rootPassword || !newUser || !newPassword || !serverKey || !displayName) {
          socket.emit('wizard:step', { step: 'validate', status: 'error', message: 'All fields are required' });
          socket.emit('wizard:error', { step: 'validate', error: 'All fields are required' });
          return;
        }
        if (!/^[a-zA-Z0-9_-]+$/.test(serverKey)) {
          socket.emit('wizard:step', { step: 'validate', status: 'error', message: 'Server key must be alphanumeric (a-z, 0-9, _, -)' });
          socket.emit('wizard:error', { step: 'validate', error: 'Server key must be alphanumeric' });
          return;
        }
        if (SERVERS[serverKey]) {
          socket.emit('wizard:step', { step: 'validate', status: 'error', message: `Server key '${serverKey}' already exists` });
          socket.emit('wizard:error', { step: 'validate', error: `Server key '${serverKey}' already exists` });
          return;
        }
        socket.emit('wizard:step', { step: 'validate', status: 'done', message: 'Inputs validated' });

        // Step 2: Preflight
        socket.emit('wizard:output', { data: '\n── Step 2: Checking sshpass is installed locally ──\n' });
        const preflight = await runStep('preflight', 'which sshpass');
        if (!preflight) {
          socket.emit('wizard:error', { step: 'preflight', error: 'sshpass is not installed. Install it with: brew install hudochenkov/sshpass/sshpass (macOS) or apt install sshpass (Linux)' });
          return;
        }

        // Step 3: Test root SSH
        socket.emit('wizard:output', { data: `\n── Step 3: Testing root SSH access to ${ip}:${port} ──\n` });
        const rootTest = await runStep('root-ssh', `sshpass -p '${escQ(rootPassword)}' ssh ${sshOpts} -p ${port} root@${ip} "echo ok"`);
        if (!rootTest) {
          socket.emit('wizard:error', { step: 'root-ssh', error: 'Cannot connect as root. Check IP, port, and password.' });
          return;
        }

        // Step 4: Create user
        socket.emit('wizard:output', { data: `\n── Step 4: Creating user '${newUser}' with sudo + docker access ──\n` });
        socket.emit('wizard:output', { data: `  Will run on remote as root:\n` });
        socket.emit('wizard:output', { data: `    - useradd -m -s /bin/bash ${newUser}\n` });
        socket.emit('wizard:output', { data: `    - chpasswd (set password)\n` });
        socket.emit('wizard:output', { data: `    - usermod -aG sudo/wheel ${newUser}\n` });
        socket.emit('wizard:output', { data: `    - usermod -aG docker ${newUser}\n` });
        socket.emit('wizard:output', { data: `    - sudoers.d/${newUser} → NOPASSWD:ALL\n` });
        const userSetupCmds = [
          `id ${newUser} &>/dev/null || useradd -m -s /bin/bash ${newUser}`,
          `echo '${newUser}:${escQ(newPassword)}' | chpasswd`,
          `(grep -q sudo /etc/group && usermod -aG sudo ${newUser}) || (grep -q wheel /etc/group && usermod -aG wheel ${newUser}) || true`,
          `(grep -q docker /etc/group && usermod -aG docker ${newUser}) || true`,
          `echo '${newUser} ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/${newUser}`,
          `chmod 440 /etc/sudoers.d/${newUser}`,
        ].join(' && ');
        const userSetup = await runStep('create-user', `sshpass -p '${escQ(rootPassword)}' ssh ${sshOpts} -p ${port} root@${ip} "${userSetupCmds.replace(/"/g, '\\"')}"`);
        if (!userSetup) {
          socket.emit('wizard:error', { step: 'create-user', error: 'Failed to create user or configure sudo' });
          return;
        }

        // Step 5: Generate keypair
        socket.emit('wizard:output', { data: `\n── Step 5: Generating ed25519 keypair ──\n` });
        socket.emit('wizard:output', { data: `  Path: ${keyPath}\n` });
        if (!fs.existsSync(keyPath)) {
          const keygen = await runStep('keygen', `ssh-keygen -t ed25519 -f ${keyPath} -N "" -C "dashboard-${serverKey}"`);
          if (!keygen) {
            socket.emit('wizard:error', { step: 'keygen', error: 'Failed to generate SSH keypair' });
            return;
          }
        } else {
          socket.emit('wizard:step', { step: 'keygen', status: 'done', message: 'Keypair already exists, skipping' });
        }

        // Step 6: Copy public key (via root to avoid PasswordAuthentication issues)
        socket.emit('wizard:output', { data: `\n── Step 6: Copying public key to ${newUser}@${ip} ──\n` });
        socket.emit('wizard:output', { data: `  Using root SSH to install key into ~${newUser}/.ssh/authorized_keys\n` });
        const pubKey = fs.readFileSync(`${keyPath}.pub`, 'utf-8').trim();
        const installKeyCmd = [
          `mkdir -p /home/${newUser}/.ssh`,
          `echo '${escQ(pubKey)}' >> /home/${newUser}/.ssh/authorized_keys`,
          `chmod 700 /home/${newUser}/.ssh`,
          `chmod 600 /home/${newUser}/.ssh/authorized_keys`,
          `chown -R ${newUser}:${newUser} /home/${newUser}/.ssh`,
        ].join(' && ');
        const copyKey = await runStep('copy-key',
          `sshpass -p '${escQ(rootPassword)}' ssh ${sshOpts} -p ${port} root@${ip} "${installKeyCmd.replace(/"/g, '\\"')}"`,
          20000
        );
        if (!copyKey) {
          socket.emit('wizard:error', { step: 'copy-key', error: 'Failed to copy SSH public key' });
          return;
        }

        // Step 7: Configure ~/.ssh/config
        socket.emit('wizard:output', { data: `\n── Step 7: Configuring ~/.ssh/config ──\n` });
        socket.emit('wizard:output', { data: `  Will add block:\n` });
        socket.emit('wizard:output', { data: `    Host ${alias}\n` });
        socket.emit('wizard:output', { data: `      HostName ${ip}\n` });
        socket.emit('wizard:output', { data: `      Port ${port}\n` });
        socket.emit('wizard:output', { data: `      User ${newUser}\n` });
        socket.emit('wizard:output', { data: `      IdentityFile ${keyPath}\n` });
        socket.emit('wizard:step', { step: 'ssh-config', status: 'running', message: 'Configuring ~/.ssh/config...' });
        const configPath = path.join(sshDir, 'config');
        let configContent = '';
        try { configContent = fs.readFileSync(configPath, 'utf-8'); } catch (_) { /* file may not exist */ }
        if (configContent.includes(`Host ${alias}`)) {
          socket.emit('wizard:step', { step: 'ssh-config', status: 'done', message: 'SSH config alias already exists, skipping' });
        } else {
          const block = `\n# Dashboard: ${displayName}\nHost ${alias}\n  HostName ${ip}\n  Port ${port}\n  User ${newUser}\n  IdentityFile ${keyPath}\n  IdentitiesOnly yes\n`;
          fs.appendFileSync(configPath, block);
          socket.emit('wizard:output', { data: `Added SSH config block for ${alias}\n` });
          socket.emit('wizard:step', { step: 'ssh-config', status: 'done', message: 'SSH config updated' });
        }

        // Step 8: Test connection via alias
        socket.emit('wizard:output', { data: `\n── Step 8: Testing passwordless SSH via alias '${alias}' ──\n` });
        const aliasTest = await runStep('test-alias', `ssh -o ConnectTimeout=10 ${alias} "echo ok"`);
        if (!aliasTest) {
          socket.emit('wizard:error', { step: 'test-alias', error: 'SSH connection via alias failed. Check ~/.ssh/config entry.' });
          return;
        }

        // Step 9: Register in DB
        socket.emit('wizard:output', { data: `\n── Step 9: Registering server in dashboard DB ──\n` });
        socket.emit('wizard:output', { data: `  key=${serverKey}, alias=${alias}, user=${newUser}@${ip}:${port}\n` });
        socket.emit('wizard:step', { step: 'register', status: 'running', message: 'Registering server in dashboard...' });
        db.createServer({ key: serverKey, displayName, alias, ip, port, user: newUser });
        SERVERS[serverKey] = { alias, ip, port, user: newUser, displayName };
        socket.emit('wizard:step', { step: 'register', status: 'done', message: 'Server registered' });

        // Done!
        socket.emit('wizard:done', { serverKey, displayName, alias, ip, port, user: newUser });
        log('Wizard completed', { serverKey, ip, user: newUser });

      } catch (err) {
        socket.emit('wizard:error', { step: 'unknown', error: err.message });
        log('Wizard error', { serverKey, error: err.message });
      }
    });

    socket.on('disconnect', () => {
      logSubscribers.delete(socket.id);
      log('Socket.IO client disconnected', { id: socket.id });
    });
  });
}

module.exports = { registerHandlers, logSubscribers };
