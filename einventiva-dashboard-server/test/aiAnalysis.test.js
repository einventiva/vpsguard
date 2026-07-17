const { test, describe } = require('node:test');
const assert = require('node:assert');
const { parseFindings } = require('../services/aiAnalysis');
const { buildOpenAIRequest, buildAnthropicRequest, extractOpenAIResponse, extractAnthropicResponse } = require('../services/aiProviders');
const { compressRollup, formatServerStatus } = require('../services/aiSample');

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
    assert.deepStrictEqual(oa, { text: 'hi', tokensIn: 10, tokensOut: 5 });
    const an = extractAnthropicResponse({ content: [{ type: 'text', text: 'hola' }], usage: { input_tokens: 7, output_tokens: 3 } });
    assert.deepStrictEqual(an, { text: 'hola', tokensIn: 7, tokensOut: 3 });
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
