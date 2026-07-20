const { test, describe } = require('node:test');
const assert = require('node:assert');
const { parseAnalysis, parseFindings, groupFindingsForAlerts, parseInterpretation } = require('../services/aiAnalysis');
const { buildOpenAIRequest, buildAnthropicRequest, extractOpenAIResponse, extractAnthropicResponse, callLLM } = require('../services/aiProviders');
const http = require('http');
const { compressRollup, formatServerStatus, detectMaintenanceWindows } = require('../services/aiSample');

describe('parseFindings', () => {
  const good = JSON.stringify({
    summary: 'Todo estable.',
    findings: [
      { severity: 'warning', server: 'infra', title: 'Swap creciendo', detail: 'x', action: 'revisar', script: 'disk-usage' },
      { severity: 'critical', server: 'prod', title: 'Disco', detail: 'y', action: 'limpiar', script: null },
    ],
  });

  test('parses clean JSON and sorts by severity', () => {
    const { summary, findings } = parseFindings(good);
    assert.equal(summary, 'Todo estable.');
    assert.equal(findings.length, 2);
    assert.equal(findings[0].severity, 'critical');
    assert.equal(findings[1].script, 'disk-usage');
  });

  test('unwraps markdown fences and surrounding prose', () => {
    const wrapped = 'Here is the analysis:\n```json\n' + good + '\n```\nHope it helps!';
    assert.equal(parseFindings(wrapped).findings.length, 2);
  });

  test('normalizes invalid severities and missing fields', () => {
    const { findings } = parseFindings(JSON.stringify({
      findings: [{ severity: 'panic', title: 'x' }],
    }));
    assert.equal(findings[0].severity, 'info');
    assert.equal(findings[0].server, 'fleet');
    assert.equal(findings[0].script, null);
  });

  test('throws on responses without JSON', () => {
    assert.throws(() => parseFindings('I cannot analyze this.'));
  });

  test('empty findings array is valid (healthy fleet)', () => {
    const { findings } = parseFindings('{"summary":"ok","findings":[]}');
    assert.deepStrictEqual(findings, []);
  });
});

describe('parseAnalysis actionPlan + trend (A3)', () => {
  test('parses action plan, sorts by horizon, normalizes fields', () => {
    const payload = JSON.stringify({
      summary: 'x',
      findings: [{ severity: 'warning', server: 'prod', title: 'disco', trend: 'worse' }],
      actionPlan: [
        { horizon: 'watch', step: 'vigilar memoria', server: 'infra' },
        { horizon: 'now', step: 'limpiar disco', server: 'prod', script: 'clean-logs', dependsOn: 'ver disk-usage' },
        { horizon: 'bogus', step: 'sin horizonte' },
      ],
    });
    const { findings, actionPlan } = parseAnalysis(payload);
    assert.equal(findings[0].trend, 'worse');
    assert.equal(actionPlan[0].horizon, 'now');
    assert.equal(actionPlan[0].script, 'clean-logs');
    assert.equal(actionPlan[0].dependsOn, 'ver disk-usage');
    assert.equal(actionPlan[2].horizon, 'watch'); // 'bogus' normalized to watch, sorted last
  });

  test('invalid trend becomes null; missing actionPlan is empty array', () => {
    const { findings, actionPlan } = parseAnalysis('{"findings":[{"severity":"info","title":"a","trend":"panic"}]}');
    assert.equal(findings[0].trend, null);
    assert.deepStrictEqual(actionPlan, []);
  });

  test('parseFindings alias still works', () => {
    assert.equal(typeof parseFindings, 'function');
    assert.equal(parseFindings('{"summary":"ok","findings":[]}').summary, 'ok');
  });
});

describe('parseInterpretation (A4)', () => {
  test('parses verdict, normalizes severity, caps points', () => {
    const payload = JSON.stringify({
      summary: 'Todo sano.',
      severity: 'ok',
      points: ['servicio-web usa 10% CPU', 'db-cache al 3% de memoria', 'sin contenedores bajo presión'],
      action: 'Ninguna — todo en orden.',
    });
    const r = parseInterpretation(payload);
    assert.equal(r.summary, 'Todo sano.');
    assert.equal(r.severity, 'ok');
    assert.equal(r.points.length, 3);
    assert.equal(r.action, 'Ninguna — todo en orden.');
  });

  test('unwraps fences, invalid severity → info, drops non-string points', () => {
    const wrapped = '```json\n' + JSON.stringify({
      summary: 'x', severity: 'panic', points: ['ok', 42, null, 'dos'], action: '',
    }) + '\n```';
    const r = parseInterpretation(wrapped);
    assert.equal(r.severity, 'info');
    assert.deepStrictEqual(r.points, ['ok', 'dos']);
  });

  test('throws when no JSON present', () => {
    assert.throws(() => parseInterpretation('cannot parse this'));
  });
});

describe('detectMaintenanceWindows (A3)', () => {
  test('flags servers with recent boot from uptime', () => {
    const now = Date.now();
    const status = {
      infra: { metrics: { uptime: { raw: '10:30:00 up 5 min, 2 users, load average: 0.1' } } },
      prod: { metrics: { uptime: { raw: '10:30:00 up 40 days, 2:15, load average: 0.1' } } },
      qa: { metrics: { uptime: { raw: '10:30:00 up 1:30, 2 users' } } },
    };
    const windows = detectMaintenanceWindows(status, now);
    const boots = windows.filter(w => w.kind === 'recent-boot').map(w => w.server);
    assert.ok(boots.includes('infra')); // 5 min
    assert.ok(boots.includes('qa'));    // 1:30 = 90 min
    assert.ok(!boots.includes('prod')); // 40 days
  });
});

describe('groupFindingsForAlerts', () => {
  test('groups warning+critical by server, escalates severity, caps titles', () => {
    const groups = groupFindingsForAlerts([
      { severity: 'warning', server: 'prod', title: 'a' },
      { severity: 'critical', server: 'prod', title: 'b' },
      { severity: 'warning', server: 'prod', title: 'c' },
      { severity: 'warning', server: 'prod', title: 'd' },
      { severity: 'info', server: 'prod', title: 'ignored' },
      { severity: 'warning', title: 'no-server' },
    ]);
    assert.equal(groups.prod.count, 4);
    assert.equal(groups.prod.severity, 'critical');
    assert.equal(groups.prod.titles.length, 3);
    assert.equal(groups.fleet.count, 1);
    assert.equal(groups.fleet.severity, 'warning');
  });

  test('info-only findings produce no groups', () => {
    assert.deepStrictEqual(groupFindingsForAlerts([{ severity: 'info', server: 'qa', title: 'x' }]), {});
    assert.deepStrictEqual(groupFindingsForAlerts([]), {});
    assert.deepStrictEqual(groupFindingsForAlerts(null), {});
  });
});

describe('provider request builders', () => {
  const args = { baseUrl: 'http://llm:4000/v1', apiKey: 'k', model: 'm', maxTokens: 100, system: 'S', user: 'U' };

  test('openai-compatible shape', () => {
    const req = buildOpenAIRequest(args);
    assert.equal(req.url, 'http://llm:4000/v1/chat/completions');
    assert.equal(req.headers.Authorization, 'Bearer k');
    assert.equal(req.body.messages[0].role, 'system');
    assert.equal(req.body.messages[1].content, 'U');
  });

  test('openai without api key omits auth header (local ollama)', () => {
    const req = buildOpenAIRequest({ ...args, apiKey: '' });
    assert.ok(!('Authorization' in req.headers));
  });

  test('anthropic shape with default base url', () => {
    const req = buildAnthropicRequest({ ...args, baseUrl: '' });
    assert.equal(req.url, 'https://api.anthropic.com/v1/messages');
    assert.equal(req.headers['x-api-key'], 'k');
    assert.equal(req.body.system, 'S');
    assert.equal(req.body.messages[0].role, 'user');
  });

  test('response extractors pull text and token usage', () => {
    const oa = extractOpenAIResponse({ choices: [{ message: { content: 'hi' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
    assert.deepStrictEqual(oa, { text: 'hi', tokensIn: 10, tokensOut: 5, reasoningTokens: null, finishReason: null });
    const an = extractAnthropicResponse({ content: [{ type: 'text', text: 'hola' }], usage: { input_tokens: 7, output_tokens: 3 } });
    assert.deepStrictEqual(an, { text: 'hola', tokensIn: 7, tokensOut: 3 });
  });

  test('carries reasoning tokens and finish reason through', () => {
    const oa = extractOpenAIResponse({
      choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 80, completion_tokens_details: { reasoning_tokens: 30 } },
    });
    assert.equal(oa.reasoningTokens, 30);
    assert.equal(oa.finishReason, 'stop');
  });

  // A reasoning model can spend the whole budget thinking and answer nothing.
  // That must be named here, not surface later as "No JSON object".
  test('empty content spent entirely on reasoning explains itself', () => {
    assert.throws(
      () => extractOpenAIResponse({
        choices: [{ message: { content: '' }, finish_reason: 'length' }],
        usage: { prompt_tokens: 11, completion_tokens: 50, completion_tokens_details: { reasoning_tokens: 50 } },
      }),
      /internal reasoning.*AI_MAX_TOKENS/s
    );
  });

  test('empty content without reasoning tokens is passed through, not misreported', () => {
    const oa = extractOpenAIResponse({ choices: [{ message: { content: '' } }], usage: { prompt_tokens: 5, completion_tokens: 0 } });
    assert.equal(oa.text, '');
  });
});

describe('callLLM timeout reporting', () => {
  // A bare AbortError reads "This operation was aborted" and names neither the
  // model nor the limit — useless when a slow model is the actual cause.
  test('names the model and the timeout instead of the raw abort', async () => {
    const server = http.createServer(() => { /* never responds */ });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    try {
      await assert.rejects(
        callLLM({
          provider: 'openai', baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: 'k',
          model: 'slow-model', maxTokens: 10, timeoutMs: 150, system: 'S', user: 'U',
        }),
        (err) => {
          assert.match(err.message, /timed out after 150ms/);
          assert.match(err.message, /slow-model/);
          assert.match(err.message, /AI_TIMEOUT_MS/);
          assert.doesNotMatch(err.message, /This operation was aborted/);
          return true;
        }
      );
    } finally {
      server.close();
    }
  });
});

describe('aiSample shaping', () => {
  test('offline server keeps error only', () => {
    const s = formatServerStatus('qa', { status: 'error', error: 'ssh timeout' });
    assert.deepStrictEqual(s, { server: 'qa', online: false, error: 'ssh timeout' });
  });

  test('online server rounds and derives percentages', () => {
    const s = formatServerStatus('prod', {
      status: 'connected', name: 'Production', latencyMs: 42,
      metrics: {
        cpu: { raw: '%Cpu(s): 88.5 id' },
        memory: { total: 1000, used: 250, swapTotal: 100, swapUsed: 5 },
        disk: { percentUsed: '18%' },
        inodes: { percentUsed: '3%' },
        dockerStats: [{}, {}],
        rebootRequired: false,
        failedUnits: [],
      },
    });
    assert.equal(s.cpuPct, 11.5);
    assert.equal(s.memPct, 25);
    assert.equal(s.swapPct, 5);
    assert.equal(s.diskPct, 18);
    assert.equal(s.containers, 2);
  });

  test('compressRollup rounds and keeps timestamps', () => {
    const out = compressRollup([{ timestamp: 'T1', cpu: 1.234, memory: 50.55, disk: 20 }]);
    assert.deepStrictEqual(out, [{ t: 'T1', cpu: 1.2, mem: 50.6, disk: 20 }]);
  });
});
