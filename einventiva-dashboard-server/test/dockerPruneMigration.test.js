const { test, describe, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Set before requiring db.js, which reads DB_PATH at module load
const TMP_DB = path.join(os.tmpdir(), `vpsguard-prune-test-${process.pid}.db`);
process.env.DB_PATH = TMP_DB;
process.env.API_TOKEN = process.env.API_TOKEN || 'test';
const db = require('../db');

const LEGACY_COMMAND = 'docker system prune -af --volumes';
const LEGACY_DESCRIPTION = 'Remove unused Docker images and containers';

function removeDb() {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TMP_DB + suffix); } catch { /* may not exist */ }
  }
}

function pruneScript() {
  return db.getScripts().find(s => s.id === 'docker-prune');
}

// Leave the row as an install from before the fix has it, then restart
function restartWith(fields) {
  db.updateScript('docker-prune', fields);
  db.closeDB();
  db.initDB();
}

describe('docker-prune keeps volumes', () => {
  beforeEach(() => {
    db.closeDB();
    removeDb();
    db.initDB();
  });
  after(() => {
    db.closeDB();
    removeDb();
  });

  test('a new install does not delete volumes', () => {
    assert.ok(!pruneScript().command.includes('--volumes'));
    assert.strictEqual(pruneScript().destructive, 1);
  });

  test('an existing install is migrated', () => {
    restartWith({ command: LEGACY_COMMAND, description: LEGACY_DESCRIPTION });
    assert.strictEqual(pruneScript().command, 'docker system prune -af');
    assert.ok(pruneScript().description.includes('Volumes are kept'));
  });

  test('a command the user edited stays theirs', () => {
    const custom = 'docker system prune -af --volumes --filter until=720h';
    restartWith({ command: custom, description: LEGACY_DESCRIPTION });
    assert.strictEqual(pruneScript().command, custom);
    assert.strictEqual(pruneScript().description, LEGACY_DESCRIPTION);
  });

  test('a description the user edited stays theirs', () => {
    restartWith({ command: LEGACY_COMMAND, description: 'Our weekly cleanup' });
    assert.strictEqual(pruneScript().command, 'docker system prune -af');
    assert.strictEqual(pruneScript().description, 'Our weekly cleanup');
  });
});
