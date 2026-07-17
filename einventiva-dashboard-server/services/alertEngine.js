const { evaluateBreaches } = require('./alerts');

const ALERT_TYPES = ['offline', 'cpu', 'memory', 'disk', 'inodes', 'systemd'];

// Alert lifecycle with hysteresis. `store` is the persistence layer
// (db.js in production, a fake in tests) providing: getOpenAlert,
// openAlert, updateAlertPeak, resolveAlert.
//
// `thresholds` is either a static { cpu, memory, disk } object or a
// function (serverKey) => thresholds, resolved on every sample so
// per-server overrides apply without restarting.
//
// - An alert opens after `samplesToOpen` consecutive breaching samples,
//   so a single 15s spike doesn't fire.
// - It resolves after `samplesToResolve` consecutive clean samples,
//   so a metric hovering around the threshold doesn't flap.
// - 'offline' resolves on the first clean sample: a successful SSH
//   round-trip is definitive.
function createAlertEngine({ store, thresholds, samplesToOpen = 2, samplesToResolve = 4 }) {
  const counters = new Map(); // `${server}:${type}` -> { breach, ok }

  function processServerSample(serverKey, displayName, data) {
    const resolvedThresholds = typeof thresholds === 'function' ? thresholds(serverKey) : thresholds;
    const breaches = new Map(
      evaluateBreaches(displayName, data, resolvedThresholds).map(b => [b.type, b])
    );
    const events = { opened: [], resolved: [] };

    for (const type of ALERT_TYPES) {
      const key = `${serverKey}:${type}`;
      const counter = counters.get(key) || { breach: 0, ok: 0 };
      const breach = breaches.get(type);
      const open = store.getOpenAlert(serverKey, type);

      if (breach) {
        counter.breach++;
        counter.ok = 0;
        if (open) {
          store.updateAlertPeak(open.id, breach.value);
        } else if (counter.breach >= samplesToOpen) {
          events.opened.push(store.openAlert({ server: serverKey, ...breach }));
          counter.breach = 0;
        }
      } else {
        counter.ok++;
        counter.breach = 0;
        const needed = type === 'offline' ? 1 : samplesToResolve;
        if (open && counter.ok >= needed) {
          events.resolved.push(store.resolveAlert(open.id));
          counter.ok = 0;
        }
      }

      counters.set(key, counter);
    }

    return events;
  }

  return { processServerSample };
}

module.exports = { createAlertEngine, ALERT_TYPES };
