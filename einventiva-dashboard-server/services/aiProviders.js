// LLM provider client for the AI analysis module. Two dialects cover
// the ecosystem: 'openai' speaks the OpenAI-compatible chat completions
// API (LiteLLM, OpenAI, xAI/Grok, Ollama, DeepSeek, …) and 'anthropic'
// speaks the native Messages API. Payload builders and response
// extractors are pure so they can be unit-tested without a network.

function buildOpenAIRequest({ baseUrl, apiKey, model, maxTokens, system, user }) {
  return {
    url: `${baseUrl}/chat/completions`,
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: {
      model,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    },
  };
}

function buildAnthropicRequest({ baseUrl, apiKey, model, maxTokens, system, user }) {
  return {
    url: `${baseUrl || 'https://api.anthropic.com'}/v1/messages`,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: {
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    },
  };
}

function extractOpenAIResponse(json) {
  const choice = json?.choices?.[0];
  const text = choice?.message?.content;
  if (typeof text !== 'string') throw new Error('Unexpected OpenAI-compatible response shape');

  const usage = json.usage || {};
  const tokensOut = usage.completion_tokens ?? null;
  const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens ?? null;

  // A heavy reasoning model can spend its whole completion budget on internal
  // thinking and return empty content. Say so here — downstream this would
  // otherwise surface as a baffling "No JSON object in model response".
  if (!text.trim() && reasoningTokens > 0) {
    throw new Error(
      `Model returned no content: the entire ${tokensOut}-token completion budget went to internal reasoning ` +
      `(${reasoningTokens} reasoning tokens). Raise AI_MAX_TOKENS or pick a model that reasons less.`
    );
  }

  return {
    text,
    tokensIn: usage.prompt_tokens ?? null,
    tokensOut,
    reasoningTokens,
    finishReason: choice?.finish_reason ?? null,
  };
}

function extractAnthropicResponse(json) {
  const text = (json?.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  if (!text) throw new Error('Unexpected Anthropic response shape');
  return {
    text,
    tokensIn: json.usage?.input_tokens ?? null,
    tokensOut: json.usage?.output_tokens ?? null,
  };
}

async function callLLM({ provider, baseUrl, apiKey, model, maxTokens, timeoutMs, system, user }) {
  const req = provider === 'anthropic'
    ? buildAnthropicRequest({ baseUrl, apiKey, model, maxTokens, system, user })
    : buildOpenAIRequest({ baseUrl, apiKey, model, maxTokens, system, user });

  const effectiveTimeout = timeoutMs || 120000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), effectiveTimeout);
  try {
    const res = await fetch(req.url, {
      method: 'POST',
      headers: req.headers,
      body: JSON.stringify(req.body),
      signal: controller.signal,
    });
    const raw = await res.text();
    if (!res.ok) {
      throw new Error(`LLM HTTP ${res.status}: ${raw.slice(0, 300)}`);
    }
    const json = JSON.parse(raw);
    return provider === 'anthropic' ? extractAnthropicResponse(json) : extractOpenAIResponse(json);
  } catch (error) {
    // The bare AbortError reads "This operation was aborted", which tells the
    // operator nothing. Name the model and the limit that was hit.
    if (error?.name === 'AbortError') {
      const limit = effectiveTimeout >= 1000 ? `${Math.round(effectiveTimeout / 1000)}s` : `${effectiveTimeout}ms`;
      throw new Error(
        `LLM request timed out after ${limit} (model '${model}'). ` +
        `Heavy reasoning models often need longer — raise AI_TIMEOUT_MS or pick a faster model.`
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// List model ids from an OpenAI-compatible /v1/models endpoint. With a
// LiteLLM virtual key this returns only the groups the key is allowed
// to use. Anthropic has no discovery endpoint — the caller supplies a
// static list — so this is OpenAI-dialect only.
async function listModels({ baseUrl, apiKey, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 15000);
  try {
    const res = await fetch(`${baseUrl}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: controller.signal,
    });
    const raw = await res.text();
    if (!res.ok) throw new Error(`models HTTP ${res.status}: ${raw.slice(0, 200)}`);
    const json = JSON.parse(raw);
    const ids = (json?.data || []).map(m => m.id).filter(Boolean);
    return [...new Set(ids)].sort();
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { callLLM, listModels, buildOpenAIRequest, buildAnthropicRequest, extractOpenAIResponse, extractAnthropicResponse };
