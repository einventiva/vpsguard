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
  const text = json?.choices?.[0]?.message?.content;
  if (typeof text !== 'string') throw new Error('Unexpected OpenAI-compatible response shape');
  return {
    text,
    tokensIn: json.usage?.prompt_tokens ?? null,
    tokensOut: json.usage?.completion_tokens ?? null,
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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 120000);
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
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { callLLM, buildOpenAIRequest, buildAnthropicRequest, extractOpenAIResponse, extractAnthropicResponse };
