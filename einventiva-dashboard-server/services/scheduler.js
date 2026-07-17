// Scheduled script execution: standard 5-field cron expressions
// (minute hour day-of-month month day-of-week) matched once per minute.
// Pure parse/match helpers here; the execution loop lives in
// backgroundJobs so it shares the alert pipeline.

const FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'dom', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'dow', min: 0, max: 7 }, // 0 and 7 are both Sunday
];

// Parse one cron field ("*", "*/15", "5", "1-5", "1,15,30", "1-5/2")
// into a Set of matching values. Throws on anything malformed.
function parseField(spec, { name, min, max }) {
  const values = new Set();
  for (const part of spec.split(',')) {
    const m = part.match(/^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/);
    if (!m) throw new Error(`Invalid cron ${name} field: '${part}'`);
    const [, range, stepStr] = m;
    const step = stepStr ? parseInt(stepStr, 10) : 1;
    if (step < 1) throw new Error(`Invalid cron step in ${name}: '${part}'`);

    let lo, hi;
    if (range === '*') {
      lo = min; hi = max;
    } else if (range.includes('-')) {
      [lo, hi] = range.split('-').map(n => parseInt(n, 10));
    } else {
      lo = hi = parseInt(range, 10);
      if (stepStr) hi = max; // "N/step" means "from N, every step"
    }
    if (lo < min || hi > max || lo > hi) {
      throw new Error(`Cron ${name} value out of range (${min}-${max}): '${part}'`);
    }
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  return values;
}

function parseCron(expr) {
  const parts = String(expr || '').trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Cron expression must have 5 fields, got ${parts.length}`);
  }
  const [minute, hour, dom, month, dow] = parts.map((p, i) => parseField(p, FIELDS[i]));
  // Sunday is 0 or 7 depending on dialect — normalize to both
  if (dow.has(7)) dow.add(0);
  return { minute, hour, dom, month, dow, domRestricted: parts[2] !== '*', dowRestricted: parts[4] !== '*' };
}

function isValidCron(expr) {
  try { parseCron(expr); return true; } catch (_) { return false; }
}

function cronMatches(parsed, date) {
  if (!parsed.minute.has(date.getMinutes())) return false;
  if (!parsed.hour.has(date.getHours())) return false;
  if (!parsed.month.has(date.getMonth() + 1)) return false;
  // Vixie cron: when both dom and dow are restricted, either may match
  const domOk = parsed.dom.has(date.getDate());
  const dowOk = parsed.dow.has(date.getDay());
  if (parsed.domRestricted && parsed.dowRestricted) return domOk || dowOk;
  return domOk && dowOk;
}

// Which of these scripts are due at `date`? Invalid expressions are
// skipped (they can only get into the DB by predating validation).
function dueScripts(scripts, date) {
  const due = [];
  for (const script of scripts) {
    if (!script.schedule) continue;
    try {
      if (cronMatches(parseCron(script.schedule), date)) due.push(script);
    } catch (_) { /* skip malformed schedule */ }
  }
  return due;
}

// Resolve a script's schedule_servers ('*' or comma-separated keys)
// against the live server map; unknown keys are dropped.
function resolveTargetServers(script, serverKeys) {
  const spec = (script.schedule_servers || '*').trim();
  if (spec === '*' || spec === '') return [...serverKeys];
  return spec.split(',').map(s => s.trim()).filter(s => serverKeys.includes(s));
}

module.exports = { parseCron, isValidCron, cronMatches, dueScripts, resolveTargetServers };
