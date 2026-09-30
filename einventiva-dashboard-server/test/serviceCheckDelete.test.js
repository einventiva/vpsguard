const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// A throwaway database: db.js honours DB_PATH, so these tests never touch the
// live one. Set before requiring db.js, which reads it at module load.
const TMP_DB = path.join(os.tmpdir(), `vpsguard-test-${process.pid}.db`);
process.env.DB_PATH = TMP_DB;
process.env.API_TOKEN = process.env.API_TOKEN || 'test';
const db = require('../db');

process.on('exit', () => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TMP_DB + suffix); } catch { /* may not exist */ }
  }
});

const CHECK_ID = 'orphan-check';

describe('deleting a service check closes the alerts it left open', () => {
  test('an open alert cannot outlive its check', () => {
    db.initDB();
    db.createServiceCheck({
      id: CHECK_ID, name: 'Temp', kind: 'tcp', target: '127.0.0.1:9',
      runFrom: 'dashboard', intervalSec: 60,
    });
    // The state a failing check leaves behind
    const alert = db.openAlert({
      server: 'dashboard', type: 'service', subject: CHECK_ID,
      severity: 'critical', message: 'Temp is failing',
    });
    assert.strictEqual(db.getAlert(alert.id).resolved_at, null, 'precondición: la alerta está abierta');

    const { deleted, resolvedAlerts } = db.deleteServiceCheck(CHECK_ID);

    assert.strictEqual(deleted, true);
    assert.strictEqual(resolvedAlerts.length, 1, 'devuelve la alerta que cerró, para poder anunciarla');
    assert.strictEqual(resolvedAlerts[0].id, alert.id);
    // The real defect: without this, nothing could ever clear it — the check
    // that would have resolved it no longer exists
    assert.notStrictEqual(db.getAlert(alert.id).resolved_at, null, 'la alerta quedó cerrada');
    assert.strictEqual(db.getServiceCheck(CHECK_ID), undefined, 'el check se fue');
  });

  test('an already-resolved alert is left alone', () => {
    db.initDB();
    const id = `${CHECK_ID}-b`;
    db.createServiceCheck({
      id, name: 'Temp B', kind: 'tcp', target: '127.0.0.1:9',
      runFrom: 'dashboard', intervalSec: 60,
    });
    const alert = db.openAlert({
      server: 'dashboard', type: 'service', subject: id,
      severity: 'warning', message: 'Temp B',
    });
    db.resolveAlert(alert.id);
    const resolvedAt = db.getAlert(alert.id).resolved_at;

    const { resolvedAlerts } = db.deleteServiceCheck(id);

    assert.strictEqual(resolvedAlerts.length, 0, 'no vuelve a resolver lo ya resuelto');
    assert.strictEqual(db.getAlert(alert.id).resolved_at, resolvedAt, 'conserva la hora original');
  });

  test('deleting a check does not touch another check\'s alert', () => {
    db.initDB();
    const mine = `${CHECK_ID}-c`, other = `${CHECK_ID}-d`;
    for (const id of [mine, other]) {
      db.createServiceCheck({ id, name: id, kind: 'tcp', target: '127.0.0.1:9', runFrom: 'dashboard', intervalSec: 60 });
    }
    const otherAlert = db.openAlert({
      server: 'dashboard', type: 'service', subject: other,
      severity: 'critical', message: 'otro',
    });

    db.deleteServiceCheck(mine);

    assert.strictEqual(db.getAlert(otherAlert.id).resolved_at, null, 'la alerta ajena sigue abierta');
    db.deleteServiceCheck(other);   // limpieza
  });
});
