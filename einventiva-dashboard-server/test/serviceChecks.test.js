const { test, describe } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const net = require('node:net');
const { execFileSync } = require('node:child_process');
const {
  statusMatches, interpolateEnv, resolveHeaders, readJsonPath, evaluateBody, needsBody,
  parseHostPort, parseCurlOutput, parseTcpProbeOutput, parseCommandOutput,
  evaluateContainerState, evaluateSystemdState, buildHttpProbeScript, buildTcpProbeScript,
  runCheck, shq, uptimePct,
} = require('../services/serviceChecks');

const noServers = { getServers: () => ({}) };

const check = (over = {}) => ({
  id: 'c', name: 'Check', kind: 'http', target: 'http://localhost:1',
  run_from: 'dashboard', config: {}, timeout_ms: 2000, ...over,
});

describe('uptimePct', () => {
  test('no samples is null — never 0% and never 100%', () => {
    // Both would be lies: 0 reads as a total outage, 100 as verified perfect
    assert.strictEqual(uptimePct(undefined), null);
    assert.strictEqual(uptimePct({ total: 0, passed: 0 }), null);
  });

  test('rounds to one decimal', () => {
    assert.strictEqual(uptimePct({ total: 3, passed: 2 }), 66.7);
    assert.strictEqual(uptimePct({ total: 34, passed: 33 }), 97.1);
  });

  test('a single failure moves it off 100', () => {
    assert.strictEqual(uptimePct({ total: 4, passed: 4 }), 100);
    assert.strictEqual(uptimePct({ total: 4, passed: 3 }), 75);
    assert.strictEqual(uptimePct({ total: 4, passed: 0 }), 0);
  });
});

describe('statusMatches', () => {
  test('defaults to any 2xx when unspecified', () => {
    assert.strictEqual(statusMatches(200, undefined), true);
    assert.strictEqual(statusMatches(204, ''), true);
    assert.strictEqual(statusMatches(301, undefined), false);
    assert.strictEqual(statusMatches(500, undefined), false);
  });

  test('accepts exact codes, families and comma lists', () => {
    assert.strictEqual(statusMatches(404, '404'), true);
    assert.strictEqual(statusMatches(403, '4xx'), true);
    assert.strictEqual(statusMatches(301, '2xx,3xx'), true);
    assert.strictEqual(statusMatches(500, '2xx,3xx'), false);
  });

  test('a missing status never matches', () => {
    assert.strictEqual(statusMatches(null, '2xx'), false);
  });
});

describe('interpolateEnv', () => {
  test('substitutes from the environment', () => {
    assert.strictEqual(interpolateEnv('Bearer ${TOK}', { TOK: 'abc' }), 'Bearer abc');
  });

  test('an undefined variable resolves to empty, never to the literal', () => {
    // Leaking '${TOK}' into an Authorization header would send the
    // placeholder to the remote service as if it were a credential
    assert.strictEqual(interpolateEnv('Bearer ${TOK}', {}), 'Bearer ');
  });

  test('resolveHeaders maps every value', () => {
    const out = resolveHeaders({ Authorization: 'Bearer ${T}', 'X-Fixed': 'v' }, { T: 's3cr3t' });
    assert.deepStrictEqual(out, { Authorization: 'Bearer s3cr3t', 'X-Fixed': 'v' });
  });
});

describe('readJsonPath', () => {
  const obj = { status: 'ok', db: { pool: { free: 3 } }, nodes: [{ up: true }, { up: false }] };

  test('walks dotted paths and array indexes', () => {
    assert.strictEqual(readJsonPath(obj, 'status'), 'ok');
    assert.strictEqual(readJsonPath(obj, 'db.pool.free'), 3);
    assert.strictEqual(readJsonPath(obj, 'nodes.1.up'), false);
  });

  test('a broken link yields undefined instead of throwing', () => {
    assert.strictEqual(readJsonPath(obj, 'db.missing.deep'), undefined);
  });
});

describe('evaluateBody', () => {
  test('no assertions always passes', () => {
    assert.strictEqual(evaluateBody('anything', {}), null);
    assert.strictEqual(needsBody({}), false);
  });

  test('substring assertion', () => {
    assert.strictEqual(evaluateBody('all systems ok', { expectBody: 'ok' }), null);
    assert.match(evaluateBody('degraded', { expectBody: 'ok' }), /does not contain/);
  });

  test('json field must equal the expected value', () => {
    assert.strictEqual(evaluateBody('{"status":"ok"}', { jsonPath: 'status', jsonEquals: 'ok' }), null);
    assert.match(evaluateBody('{"status":"down"}', { jsonPath: 'status', jsonEquals: 'ok' }), /expected "ok"/);
  });

  test('a json field with no expected value only has to exist', () => {
    assert.strictEqual(evaluateBody('{"version":"1.2"}', { jsonPath: 'version' }), null);
    assert.match(evaluateBody('{"other":1}', { jsonPath: 'version' }), /missing/);
  });

  test('html served where json was expected is a clear failure', () => {
    // The common real case: a proxy error page with a 200 status
    assert.match(evaluateBody('<html>502</html>', { jsonPath: 'status' }), /not valid JSON/);
  });

  test('numeric comparison is not type-strict', () => {
    assert.strictEqual(evaluateBody('{"free":3}', { jsonPath: 'free', jsonEquals: 3 }), null);
    assert.strictEqual(evaluateBody('{"free":3}', { jsonPath: 'free', jsonEquals: '3' }), null);
  });
});

describe('parseHostPort', () => {
  test('accepts host:port and bracketed IPv6', () => {
    assert.deepStrictEqual(parseHostPort('localhost:5672'), { host: 'localhost', port: 5672 });
    assert.deepStrictEqual(parseHostPort('[::1]:5432'), { host: '::1', port: 5432 });
  });

  test('rejects a missing or out-of-range port', () => {
    assert.strictEqual(parseHostPort('localhost'), null);
    assert.strictEqual(parseHostPort('localhost:0'), null);
    assert.strictEqual(parseHostPort('localhost:70000'), null);
  });
});

describe('parseCurlOutput', () => {
  test('reads the trailer written after the body', () => {
    const parsed = parseCurlOutput('{"status":"ok"}\n200 0.123');
    assert.strictEqual(parsed.statusCode, 200);
    assert.strictEqual(parsed.latencyMs, 123);
    assert.strictEqual(parsed.body, '{"status":"ok"}');
  });

  test('a body that itself ends in a status-like line does not confuse it', () => {
    // The trailer is the LAST match, so body content cannot shadow it
    const parsed = parseCurlOutput('logged: 500 0.900\n200 0.010');
    assert.strictEqual(parsed.statusCode, 200);
    assert.strictEqual(parsed.body, 'logged: 500 0.900');
  });

  test('no trailer means curl never reported', () => {
    assert.strictEqual(parseCurlOutput('curl: (7) Failed to connect'), null);
  });
});

describe('parseTcpProbeOutput / parseCommandOutput', () => {
  test('tcp probe returns exit code and elapsed ms', () => {
    assert.deepStrictEqual(parseTcpProbeOutput('0 12'), { rc: 0, latencyMs: 12 });
    assert.deepStrictEqual(parseTcpProbeOutput('124 5000'), { rc: 124, latencyMs: 5000 });
  });

  test('command output separates body from the exit sentinel', () => {
    const parsed = parseCommandOutput('Status: running\n__rc=0\n');
    assert.strictEqual(parsed.rc, 0);
    assert.match(parsed.body, /Status: running/);
  });

  test('a silent command is still distinguishable from a lost transport', () => {
    assert.deepStrictEqual(parseCommandOutput('__rc=3'), { rc: 3, body: '' });
    assert.strictEqual(parseCommandOutput('no sentinel here'), null);
  });
});

describe('container and unit state', () => {
  test('running without a healthcheck is healthy', () => {
    assert.deepStrictEqual(evaluateContainerState('running '), { ok: true, error: null });
    assert.deepStrictEqual(evaluateContainerState('running <no value>'), { ok: true, error: null });
  });

  test('running but unhealthy fails', () => {
    const v = evaluateContainerState('running unhealthy');
    assert.strictEqual(v.ok, false);
    assert.match(v.error, /health is unhealthy/);
  });

  test('a restarting container is not up', () => {
    // "Up 2 minutes" hides a crash loop; the state does not
    assert.strictEqual(evaluateContainerState('restarting ').ok, false);
  });

  test('empty output means the container does not exist', () => {
    assert.match(evaluateContainerState('').error, /not found/);
  });

  test('systemd is-active', () => {
    assert.strictEqual(evaluateSystemdState('active').ok, true);
    assert.match(evaluateSystemdState('failed').error, /unit is failed/);
    assert.match(evaluateSystemdState('').error, /unknown/);
  });
});

describe('remote probe scripts', () => {
  test('http script carries method, timeout, headers and the trailer', () => {
    const c = check({ timeout_ms: 4000, config: { method: 'POST', headers: { 'X-Key': 'v' } } });
    const script = buildHttpProbeScript(c, c.config);
    assert.match(script, /--max-time 4/);
    assert.match(script, /-X 'POST'/);
    assert.match(script, /-H 'X-Key: v'/);
    assert.match(script, /%\{http_code\} %\{time_total\}/);
    assert.match(script, /-o \/dev\/null/); // no body assertions -> body not fetched
  });

  test('the body is only fetched when something asserts on it', () => {
    const c = check({ config: { jsonPath: 'status' } });
    assert.doesNotMatch(buildHttpProbeScript(c, c.config), /-o \/dev\/null/);
  });

  // Asserting on the generated text only proves what we think we wrote.
  // bash is the authority on whether the escaping actually holds, so we
  // ask it: the nasty string must come back out as one literal argument.
  test('shell metacharacters in a target survive as one literal argument', () => {
    const nasty = [
      "http://x/'; rm -rf /; echo '",
      'http://x/$(whoami)',
      'http://x/`id`',
      'http://x/a b;c|d&e',
    ];
    for (const raw of nasty) {
      const out = execFileSync('bash', ['-c', `printf '%s' ${shq(raw)}`], { encoding: 'utf8' });
      assert.strictEqual(out, raw, `escaping failed for ${raw}`);
    }
  });

  test('tcp script uses the bash builtin, not netcat', () => {
    const script = buildTcpProbeScript('localhost', 5672, 3000);
    assert.match(script, /\/dev\/tcp\/localhost\/5672/);
    assert.match(script, /timeout 3 /);
    assert.doesNotMatch(script, /\bnc\b/);
  });
});

describe('runCheck from the dashboard', () => {
  test('passes on a matching status and asserted body', async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"status":"ok"}');
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    try {
      const result = await runCheck(check({
        target: `http://127.0.0.1:${port}/health`,
        config: { jsonPath: 'status', jsonEquals: 'ok' },
      }), noServers);
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.statusCode, 200);
      assert.ok(result.latencyMs >= 0);
    } finally {
      server.close();
    }
  });

  test('a 500 fails and reports the status', async () => {
    const server = http.createServer((req, res) => { res.writeHead(500); res.end('boom'); });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    try {
      const result = await runCheck(check({ target: `http://127.0.0.1:${port}/` }), noServers);
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.error, 'HTTP 500');
    } finally {
      server.close();
    }
  });

  test('a healthy-looking 200 with the wrong body still fails', async () => {
    const server = http.createServer((req, res) => { res.writeHead(200); res.end('{"status":"degraded"}'); });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    try {
      const result = await runCheck(check({
        target: `http://127.0.0.1:${port}/`,
        config: { jsonPath: 'status', jsonEquals: 'ok' },
      }), noServers);
      assert.strictEqual(result.ok, false);
      assert.match(result.error, /degraded/);
    } finally {
      server.close();
    }
  });

  test('a refused connection fails without throwing', async () => {
    const result = await runCheck(check({ target: 'http://127.0.0.1:1/' }), noServers);
    assert.strictEqual(result.ok, false);
    assert.ok(result.error);
  });

  test('tcp reaches a listening port and misses a closed one', async () => {
    const server = net.createServer(() => {});
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    try {
      const up = await runCheck(check({ kind: 'tcp', target: `127.0.0.1:${port}` }), noServers);
      assert.strictEqual(up.ok, true);
    } finally {
      server.close();
    }
    const down = await runCheck(check({ kind: 'tcp', target: '127.0.0.1:1' }), noServers);
    assert.strictEqual(down.ok, false);
  });

  test('kinds that need a host are rejected, not silently attempted', async () => {
    for (const kind of ['command', 'container']) {
      const result = await runCheck(check({ kind, target: 'x' }), noServers);
      assert.strictEqual(result.ok, false);
      assert.match(result.error, /cannot run from the dashboard/);
    }
  });

  test('a check pointing at a deleted server reports that, not a false outage', async () => {
    const result = await runCheck(check({ kind: 'command', target: 'true', run_from: 'gone' }), noServers);
    assert.strictEqual(result.ok, false);
    assert.match(result.error, /no longer registered/);
  });
});
