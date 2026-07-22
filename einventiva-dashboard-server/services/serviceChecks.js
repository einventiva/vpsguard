// User-defined service checks: "is this thing answering, and answering
// correctly?" — the question the machine-level watchers never ask.
//
// Every check declares where it runs from. Neither vantage point can
// replace the other: a broker bound to loopback is invisible from the
// dashboard, and a DNS/TLS/proxy failure is invisible from the host.
//   run_from === 'dashboard'  -> the backend probes over the network
//   run_from === '<serverKey>' -> the probe runs over the existing SSH
//
// Response bodies are never returned to callers or persisted — only the
// boolean match result — for the same reason raw script output stays
// out of the AI sample.

const net = require('net');
const { executeSSHCommand, filterWarnings } = require('./ssh');

const KINDS = ['http', 'tcp', 'command', 'container'];
// A shell command or a container has no meaning "from the dashboard"
const SERVER_ONLY_KINDS = ['command', 'container'];

// Bodies are read only when an assertion needs them, and never whole:
// a health endpoint that accidentally returns a database dump should
// not become a memory problem.
const MAX_BODY = 64 * 1024;
// Remote probes enforce their own deadline; SSH gets extra room so the
// transport never cuts before the probe can report its own timeout.
const SSH_TIMEOUT_MARGIN = 10000;

// ─── Pure helpers (exported for tests) ──────────────────────────────

// Share of runs that passed, to one decimal. null when nothing has run:
// "no data" must never render as 0% (a total outage) or 100% (perfect).
// Single definition — the list endpoint, the live socket payload and the
// AI sample all read uptime from here, so they cannot drift apart.
function uptimePct(row) {
  if (!row || !row.total) return null;
  return Math.round((row.passed / row.total) * 1000) / 10;
}

// Accepts 200, '200', '2xx', or a comma list of either. Empty = any 2xx.
function statusMatches(code, expect) {
  if (code == null) return false;
  const spec = String(expect ?? '').trim() || '2xx';
  return spec.split(',').map(s => s.trim().toLowerCase()).filter(Boolean).some(part => {
    if (/^\d{3}$/.test(part)) return Number(part) === code;
    if (/^\dxx$/.test(part)) return Math.floor(code / 100) === Number(part[0]);
    return false;
  });
}

// Secrets stay out of the database: header values keep their ${VAR}
// form on disk and over the API, and are resolved only here, at request
// time. An undefined variable resolves to empty rather than leaking the
// literal '${VAR}' into an Authorization header.
function interpolateEnv(value, env = process.env) {
  return String(value).replace(/\$\{(\w+)\}/g, (_, name) => env[name] ?? '');
}

function resolveHeaders(headers, env = process.env) {
  const out = {};
  for (const [k, v] of Object.entries(headers || {})) out[k] = interpolateEnv(v, env);
  return out;
}

// Dotted path; numeric segments index into arrays. Returns undefined
// for any missing link, which never equals an expected value.
function readJsonPath(obj, path) {
  return String(path).split('.').reduce((acc, seg) => {
    if (acc == null) return undefined;
    return acc[/^\d+$/.test(seg) ? Number(seg) : seg];
  }, obj);
}

// Returns null when the body satisfies the assertions, or a reason string.
function evaluateBody(body, cfg = {}) {
  if (cfg.expectBody && !String(body).includes(cfg.expectBody)) {
    return `body does not contain "${cfg.expectBody}"`;
  }
  if (cfg.jsonPath) {
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch (_) {
      return `response is not valid JSON (expected field "${cfg.jsonPath}")`;
    }
    const actual = readJsonPath(parsed, cfg.jsonPath);
    const expected = cfg.jsonEquals;
    if (expected !== undefined && expected !== null && expected !== '') {
      if (String(actual) !== String(expected)) {
        return `${cfg.jsonPath} is ${JSON.stringify(actual ?? null)}, expected ${JSON.stringify(expected)}`;
      }
    } else if (actual === undefined) {
      return `${cfg.jsonPath} is missing from the response`;
    }
  }
  return null;
}

function needsBody(cfg = {}) {
  return !!(cfg.expectBody || cfg.jsonPath);
}

// `host:port`, or a bare host when the kind implies a default port
function parseHostPort(target) {
  const m = String(target).trim().match(/^\[?([^\]]+?)\]?:(\d+)$/);
  if (!m) return null;
  const port = Number(m[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host: m[1], port };
}

// Remote curl writes `\n<code> <seconds>` after the body, so the trailer
// survives whatever the body happens to contain.
function parseCurlOutput(raw) {
  const lines = filterWarnings(String(raw)).split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].trim().match(/^(\d{3})\s+([\d.]+)$/);
    if (m) {
      return {
        statusCode: Number(m[1]),
        latencyMs: Math.round(parseFloat(m[2]) * 1000),
        body: lines.slice(0, i).join('\n'),
      };
    }
  }
  return null;
}

// `<rc> <elapsed_ms>` from the /dev/tcp probe
function parseTcpProbeOutput(raw) {
  const m = filterWarnings(String(raw)).trim().split('\n').pop().trim().match(/^(\d+)\s+(\d+)$/);
  if (!m) return null;
  return { rc: Number(m[1]), latencyMs: Number(m[2]) };
}

// Command output ends with the sentinel so a command that prints
// nothing is still distinguishable from a transport failure.
function parseCommandOutput(raw) {
  const text = filterWarnings(String(raw));
  const m = text.match(/__rc=(\d+)\s*$/);
  if (!m) return null;
  return { rc: Number(m[1]), body: text.slice(0, m.index) };
}

// `docker inspect` prints "<state> <health>"; health is empty when the
// image declares no HEALTHCHECK, which is not a failure.
function evaluateContainerState(raw) {
  const line = filterWarnings(String(raw)).trim().split('\n').filter(Boolean).pop() || '';
  // Only the first token is the state; the rest is the health string,
  // which Go templates render as the literal "<no value>" — spaces and
  // all — when the image declares no HEALTHCHECK
  const [state, ...rest] = line.trim().split(/\s+/);
  const health = rest.join(' ');
  if (!state) return { ok: false, error: 'container not found' };
  if (state !== 'running') return { ok: false, error: `container is ${state}` };
  if (health && health !== 'healthy' && health !== '<no value>') {
    return { ok: false, error: `container health is ${health}` };
  }
  return { ok: true, error: null };
}

function evaluateSystemdState(raw) {
  const state = filterWarnings(String(raw)).trim().split('\n').filter(Boolean).pop() || '';
  if (state === 'active') return { ok: true, error: null };
  return { ok: false, error: `unit is ${state || 'unknown'}` };
}

// ─── Local probes (run_from: dashboard) ─────────────────────────────

async function probeHttpLocal(check, cfg) {
  const t0 = Date.now();
  let res;
  try {
    res = await fetch(check.target, {
      method: cfg.method || 'GET',
      headers: resolveHeaders(cfg.headers),
      // A redirect is reported as its own 3xx status rather than
      // silently followed: "my endpoint moved" is a finding, not a pass.
      redirect: cfg.followRedirects ? 'follow' : 'manual',
      signal: AbortSignal.timeout(check.timeout_ms),
    });
  } catch (e) {
    const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    return {
      ok: false,
      latencyMs: Date.now() - t0,
      statusCode: null,
      error: timedOut ? `no response within ${check.timeout_ms}ms` : e.message,
    };
  }

  const latencyMs = Date.now() - t0;
  let body = '';
  if (needsBody(cfg)) {
    body = (await res.text().catch(() => '')).slice(0, MAX_BODY);
  } else {
    res.body?.cancel?.().catch(() => {});
  }

  if (!statusMatches(res.status, cfg.expectStatus)) {
    return { ok: false, latencyMs, statusCode: res.status, error: `HTTP ${res.status}` };
  }
  const bodyError = evaluateBody(body, cfg);
  return { ok: !bodyError, latencyMs, statusCode: res.status, error: bodyError };
}

function probeTcpLocal(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ ok: !error, latencyMs: Date.now() - t0, statusCode: null, error });
    };
    const socket = net.connect({ host, port });
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(null));
    socket.once('timeout', () => finish(`no connection within ${timeoutMs}ms`));
    socket.once('error', (e) => finish(e.message));
  });
}

// ─── Remote probes (run_from: <serverKey>) ──────────────────────────

// The base64 pipe is the house pattern: it keeps quoting in the probe
// script from colliding with the outer ssh "..." wrapper.
async function runRemoteScript(alias, script, timeoutMs) {
  const b64 = Buffer.from(script).toString('base64');
  return executeSSHCommand(alias, `echo ${b64} | base64 -d | bash`, timeoutMs + SSH_TIMEOUT_MARGIN);
}

// POSIX single-quote escaping: close the quote, emit an escaped quote,
// reopen. Everything else inside stays literal, so a target containing
// shell metacharacters reaches curl as one argument instead of running.
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

function buildHttpProbeScript(check, cfg) {
  const seconds = Math.max(1, Math.ceil(check.timeout_ms / 1000));
  const args = [
    'curl', '-s', '-S',
    cfg.followRedirects ? '-L' : '',
    '-X', shq(cfg.method || 'GET'),
    '--max-time', String(seconds),
    needsBody(cfg) ? '' : '-o /dev/null',
    `-w ${shq('\\n%{http_code} %{time_total}')}`,
  ];
  for (const [k, v] of Object.entries(resolveHeaders(cfg.headers))) {
    args.push('-H', shq(`${k}: ${v}`));
  }
  args.push(shq(check.target));
  return `${args.filter(Boolean).join(' ')} 2>&1 || true`;
}

function buildTcpProbeScript(host, port, timeoutMs) {
  const seconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  // /dev/tcp is a bash builtin — no netcat dependency on the host
  return [
    's=$(date +%s%N)',
    `timeout ${seconds} bash -c ${shq(`exec 3<>/dev/tcp/${host}/${port}`)} 2>/dev/null`,
    'r=$?',
    'e=$(date +%s%N)',
    'echo "$r $(( (e - s) / 1000000 ))"',
  ].join('\n');
}

async function probeRemote(check, cfg, alias) {
  const t0 = Date.now();

  if (check.kind === 'http') {
    const raw = await runRemoteScript(alias, buildHttpProbeScript(check, cfg), check.timeout_ms);
    const parsed = parseCurlOutput(raw);
    if (!parsed) return { ok: false, latencyMs: Date.now() - t0, statusCode: null, error: 'no response from curl on the host' };
    if (!statusMatches(parsed.statusCode, cfg.expectStatus)) {
      return { ok: false, latencyMs: parsed.latencyMs, statusCode: parsed.statusCode, error: `HTTP ${parsed.statusCode}` };
    }
    const bodyError = evaluateBody(parsed.body.slice(0, MAX_BODY), cfg);
    return { ok: !bodyError, latencyMs: parsed.latencyMs, statusCode: parsed.statusCode, error: bodyError };
  }

  if (check.kind === 'tcp') {
    const hp = parseHostPort(check.target);
    if (!hp) return { ok: false, latencyMs: 0, statusCode: null, error: `invalid target "${check.target}" — expected host:port` };
    const raw = await runRemoteScript(alias, buildTcpProbeScript(hp.host, hp.port, check.timeout_ms), check.timeout_ms);
    const parsed = parseTcpProbeOutput(raw);
    if (!parsed) return { ok: false, latencyMs: Date.now() - t0, statusCode: null, error: 'probe produced no output on the host' };
    return {
      ok: parsed.rc === 0,
      latencyMs: parsed.latencyMs,
      statusCode: null,
      error: parsed.rc === 0 ? null : `port ${hp.port} on ${hp.host} refused the connection`,
    };
  }

  if (check.kind === 'command') {
    const raw = await runRemoteScript(alias, `${check.target}\necho "__rc=$?"`, check.timeout_ms);
    const parsed = parseCommandOutput(raw);
    const latencyMs = Date.now() - t0;
    if (!parsed) return { ok: false, latencyMs, statusCode: null, error: 'command produced no exit status' };
    if (parsed.rc !== 0) return { ok: false, latencyMs, statusCode: parsed.rc, error: `command exited ${parsed.rc}` };
    const bodyError = evaluateBody(parsed.body.slice(0, MAX_BODY), cfg);
    return { ok: !bodyError, latencyMs, statusCode: 0, error: bodyError };
  }

  // container
  const systemd = cfg.runtime === 'systemd';
  const script = systemd
    ? `systemctl is-active ${shq(check.target)} 2>&1 || true`
    : `docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' ${shq(check.target)} 2>/dev/null || true`;
  const raw = await runRemoteScript(alias, script, check.timeout_ms);
  const verdict = systemd ? evaluateSystemdState(raw) : evaluateContainerState(raw);
  return { ...verdict, latencyMs: Date.now() - t0, statusCode: null };
}

// ─── Entry point ────────────────────────────────────────────────────

// Never throws: a probe that blows up is a failing check, not a crashed
// loop. Returns { ok, latencyMs, statusCode, error }.
async function runCheck(check, { getServers }) {
  const cfg = check.config || {};
  try {
    if (check.run_from === 'dashboard') {
      if (check.kind === 'http') return await probeHttpLocal(check, cfg);
      if (check.kind === 'tcp') {
        const hp = parseHostPort(check.target);
        if (!hp) return { ok: false, latencyMs: 0, statusCode: null, error: `invalid target "${check.target}" — expected host:port` };
        return await probeTcpLocal(hp.host, hp.port, check.timeout_ms);
      }
      return { ok: false, latencyMs: 0, statusCode: null, error: `kind "${check.kind}" cannot run from the dashboard` };
    }

    const server = getServers()[check.run_from];
    if (!server) {
      return { ok: false, latencyMs: 0, statusCode: null, error: `server "${check.run_from}" is no longer registered` };
    }
    return await probeRemote(check, cfg, server.alias);
  } catch (e) {
    return { ok: false, latencyMs: 0, statusCode: null, error: e.message };
  }
}

module.exports = {
  KINDS, SERVER_ONLY_KINDS, runCheck, uptimePct,
  // exported for tests
  statusMatches, interpolateEnv, resolveHeaders, readJsonPath, evaluateBody, needsBody,
  parseHostPort, parseCurlOutput, parseTcpProbeOutput, parseCommandOutput,
  evaluateContainerState, evaluateSystemdState,
  buildHttpProbeScript, buildTcpProbeScript, shq,
};
