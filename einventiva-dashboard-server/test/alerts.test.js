const { test, describe } = require('node:test');
const assert = require('node:assert');
const { evaluateBreaches } = require('../services/alerts');
const { createAlertEngine } = require('../services/alertEngine');

const THRESHOLDS = { cpu: 80, memory: 85, disk: 90 };

function sample({ cpu = 10, memUsed = 1000, memTotal = 10000, disk = 50, offline = false } = {}) {
  if (offline) return { status: 'error', error: 'ssh failed' };
  return {
    status: 'connected',
    metrics: {
      cpu: { raw: `%Cpu(s): ${(100 - cpu).toFixed(1)} id` },
      memory: { total: memTotal, used: memUsed },
      disk: { percentUsed: `${disk}%` },
    },
  };
}

// In-memory fake of the db.js alert functions
function fakeStore() {
  let nextId = 1;
  const rows = new Map();
  return {
    rows,
    getOpenAlert(server, type) {
      for (const r of rows.values()) {
        if (r.server === server && r.type === type && !r.resolved_at) return r;
      }
      return undefined;
    },
    openAlert(fields) {
      const row = { id: nextId++, ...fields, started_at: new Date().toISOString(), resolved_at: null, acknowledged_at: null };
      rows.set(row.id, row);
      return row;
    },
    updateAlertPeak(id, value) {
      const r = rows.get(id);
      if (r && value != null && (r.value == null || r.value < value)) r.value = value;
    },
    resolveAlert(id) {
      const r = rows.get(id);
      if (r && !r.resolved_at) r.resolved_at = new Date().toISOString();
      return r;
    },
  };
}

describe('evaluateBreaches', () => {
  test('returns offline breach for error status', () => {
    const breaches = evaluateBreaches('Prod', sample({ offline: true }), THRESHOLDS);
    assert.strictEqual(breaches.length, 1);
    assert.strictEqual(breaches[0].type, 'offline');
    assert.strictEqual(breaches[0].severity, 'critical');
  });

  test('returns empty array when everything is under threshold', () => {
    assert.deepStrictEqual(evaluateBreaches('Prod', sample(), THRESHOLDS), []);
  });

  test('detects cpu, memory, and disk breaches with values', () => {
    const breaches = evaluateBreaches('Prod', sample({ cpu: 95, memUsed: 9000, disk: 95 }), THRESHOLDS);
    const types = breaches.map(b => b.type).sort();
    assert.deepStrictEqual(types, ['cpu', 'disk', 'memory']);
    const disk = breaches.find(b => b.type === 'disk');
    assert.strictEqual(disk.severity, 'critical');
    assert.strictEqual(disk.value, 95);
    assert.strictEqual(disk.threshold, 90);
  });
});

describe('alertEngine hysteresis', () => {
  test('does not open on a single breaching sample', () => {
    const store = fakeStore();
    const engine = createAlertEngine({ store, thresholds: THRESHOLDS, samplesToOpen: 2, samplesToResolve: 4 });
    const events = engine.processServerSample('prod', 'Prod', sample({ cpu: 95 }));
    assert.strictEqual(events.opened.length, 0);
    assert.strictEqual(store.rows.size, 0);
  });

  test('opens after N consecutive breaching samples', () => {
    const store = fakeStore();
    const engine = createAlertEngine({ store, thresholds: THRESHOLDS, samplesToOpen: 2, samplesToResolve: 4 });
    engine.processServerSample('prod', 'Prod', sample({ cpu: 95 }));
    const events = engine.processServerSample('prod', 'Prod', sample({ cpu: 96 }));
    assert.strictEqual(events.opened.length, 1);
    assert.strictEqual(events.opened[0].type, 'cpu');
    assert.strictEqual(events.opened[0].resolved_at, null);
  });

  test('a clean sample in between resets the open counter', () => {
    const store = fakeStore();
    const engine = createAlertEngine({ store, thresholds: THRESHOLDS, samplesToOpen: 2, samplesToResolve: 4 });
    engine.processServerSample('prod', 'Prod', sample({ cpu: 95 }));
    engine.processServerSample('prod', 'Prod', sample({ cpu: 10 }));
    const events = engine.processServerSample('prod', 'Prod', sample({ cpu: 95 }));
    assert.strictEqual(events.opened.length, 0);
  });

  test('tracks peak value while open and resolves after M clean samples', () => {
    const store = fakeStore();
    const engine = createAlertEngine({ store, thresholds: THRESHOLDS, samplesToOpen: 2, samplesToResolve: 3 });
    engine.processServerSample('prod', 'Prod', sample({ cpu: 90 }));
    const opened = engine.processServerSample('prod', 'Prod', sample({ cpu: 92 })).opened[0];
    engine.processServerSample('prod', 'Prod', sample({ cpu: 99 })); // peak
    assert.strictEqual(store.rows.get(opened.id).value, 99);

    engine.processServerSample('prod', 'Prod', sample({ cpu: 10 }));
    engine.processServerSample('prod', 'Prod', sample({ cpu: 10 }));
    assert.strictEqual(store.rows.get(opened.id).resolved_at, null);
    const events = engine.processServerSample('prod', 'Prod', sample({ cpu: 10 }));
    assert.strictEqual(events.resolved.length, 1);
    assert.ok(store.rows.get(opened.id).resolved_at);
  });

  test('breaching again mid-recovery resets the resolve counter', () => {
    const store = fakeStore();
    const engine = createAlertEngine({ store, thresholds: THRESHOLDS, samplesToOpen: 1, samplesToResolve: 2 });
    const opened = engine.processServerSample('prod', 'Prod', sample({ cpu: 95 })).opened[0];
    engine.processServerSample('prod', 'Prod', sample({ cpu: 10 }));
    engine.processServerSample('prod', 'Prod', sample({ cpu: 95 })); // flaps back
    engine.processServerSample('prod', 'Prod', sample({ cpu: 10 }));
    assert.strictEqual(store.rows.get(opened.id).resolved_at, null);
    const events = engine.processServerSample('prod', 'Prod', sample({ cpu: 10 }));
    assert.strictEqual(events.resolved.length, 1);
  });

  test('offline resolves on the first clean sample', () => {
    const store = fakeStore();
    const engine = createAlertEngine({ store, thresholds: THRESHOLDS, samplesToOpen: 2, samplesToResolve: 4 });
    engine.processServerSample('prod', 'Prod', sample({ offline: true }));
    const opened = engine.processServerSample('prod', 'Prod', sample({ offline: true })).opened;
    assert.strictEqual(opened.length, 1);
    assert.strictEqual(opened[0].type, 'offline');
    const events = engine.processServerSample('prod', 'Prod', sample());
    assert.strictEqual(events.resolved.length, 1);
  });

  test('servers and types are tracked independently', () => {
    const store = fakeStore();
    const engine = createAlertEngine({ store, thresholds: THRESHOLDS, samplesToOpen: 2, samplesToResolve: 4 });
    engine.processServerSample('prod', 'Prod', sample({ cpu: 95 }));
    engine.processServerSample('qa', 'QA', sample({ disk: 95 }));
    const prodEvents = engine.processServerSample('prod', 'Prod', sample({ cpu: 95 }));
    const qaEvents = engine.processServerSample('qa', 'QA', sample({ disk: 95 }));
    assert.strictEqual(prodEvents.opened.length, 1);
    assert.strictEqual(prodEvents.opened[0].type, 'cpu');
    assert.strictEqual(qaEvents.opened.length, 1);
    assert.strictEqual(qaEvents.opened[0].type, 'disk');
  });
});
