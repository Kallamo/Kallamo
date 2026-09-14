// One neutral transcript, rendered into each provider's native tool-calling format and read
// back from each provider's reply, so the retrieval loop never branches on the provider.
//
// Transcript entries:
//   { role: 'user', text }
//   { role: 'assistant', text, toolCalls: [{ id, name, args }], raw, rawFormat }
//   { role: 'tool', results: [{ id, name, content }] }
// `raw` is the provider's own assistant payload, replayed unchanged when the format matches:
// thinking blocks and thought signatures must come back exactly as they were sent.

const OPENAI_COMPATIBLE = new Set(['openai', 'openrouter', 'local']);
const GOOGLE = new Set(['google ai', 'vertex ai']);

function normalize(provider) {
  return String(provider || '').toLowerCase();
}

function isBedrockClaude(provider, model) {
  return normalize(provider) === 'aws bedrock' && String(model || '').toLowerCase().includes('claude');
}

function usesAnthropicFormat(provider, model) {
  return normalize(provider) === 'anthropic' || isBedrockClaude(provider, model);
}

// Bedrock's other model families take one flat prompt string, which has no place for tools.
function supportsNativeTools(provider, model) {
  const p = normalize(provider);
  return OPENAI_COMPATIBLE.has(p) || GOOGLE.has(p) || usesAnthropicFormat(p, model);
}

function renderOpenAi(conversation) {
  const messages = [];
  for (const entry of conversation) {
    if (entry.role === 'user') {
      messages.push({ role: 'user', content: entry.text });
    } else if (entry.role === 'assistant') {
      const message = { role: 'assistant', content: entry.text || '' };
      if (entry.toolCalls && entry.toolCalls.length) {
        message.tool_calls = entry.toolCalls.map(call => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.args || {}) }
        }));
      }
      messages.push(message);
    } else if (entry.role === 'tool') {
      for (const result of entry.results) {
        messages.push({ role: 'tool', tool_call_id: result.id, content: result.content });
      }
    }
  }
  return messages;
}

// Anthropic wants every tool result in the user turn right after the calls, so results and
// the text that follows them share one user message.
function renderAnthropic(conversation) {
  const messages = [];
  const pushUser = blocks => {
    const last = messages[messages.length - 1];
    if (last && last.role === 'user') last.content.push(...blocks);
    else messages.push({ role: 'user', content: blocks });
  };
  for (const entry of conversation) {
    if (entry.role === 'user') {
      pushUser([{ type: 'text', text: entry.text || '.' }]);
    } else if (entry.role === 'tool') {
      pushUser(entry.results.map(result => ({ type: 'tool_result', tool_use_id: result.id, content: result.content || '.' })));
    } else if (entry.role === 'assistant') {
      const content = entry.rawFormat === 'anthropic' && Array.isArray(entry.raw) && entry.raw.length
        ? entry.raw
        : [
          ...(entry.text ? [{ type: 'text', text: entry.text }] : []),
          ...(entry.toolCalls || []).map(call => ({ type: 'tool_use', id: call.id, name: call.name, input: call.args || {} }))
        ];
      messages.push({ role: 'assistant', content: content.length ? content : [{ type: 'text', text: '.' }] });
    }
  }
  return messages;
}

function renderGoogle(conversation) {
  const contents = [];
  const pushUser = parts => {
    const last = contents[contents.length - 1];
    if (last && last.role === 'user') last.parts.push(...parts);
    else contents.push({ role: 'user', parts });
  };
  for (const entry of conversation) {
    if (entry.role === 'user') {
      pushUser([{ text: entry.text }]);
    } else if (entry.role === 'tool') {
      pushUser(entry.results.map(result => ({
        functionResponse: {
          ...(result.id ? { id: result.id } : {}),
          name: result.name,
          response: { content: result.content }
        }
      })));
    } else if (entry.role === 'assistant') {
      const parts = entry.rawFormat === 'google' && Array.isArray(entry.raw) && entry.raw.length
        ? entry.raw
        : [
          ...(entry.text ? [{ text: entry.text }] : []),
          ...(entry.toolCalls || []).map(call => ({ functionCall: { name: call.name, args: call.args || {} } }))
        ];
      contents.push({ role: 'model', parts: parts.length ? parts : [{ text: '.' }] });
    }
  }
  return contents;
}

function renderTools(provider, model, tools) {
  if (!Array.isArray(tools) || !tools.length) return null;
  const p = normalize(provider);
  if (OPENAI_COMPATIBLE.has(p)) {
    return tools.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } }));
  }
  if (usesAnthropicFormat(p, model)) {
    return tools.map(tool => ({ name: tool.name, description: tool.description, input_schema: tool.parameters }));
  }
  if (GOOGLE.has(p)) {
    return [{ functionDeclarations: tools.map(tool => ({ name: tool.name, description: tool.description, parameters: tool.parameters })) }];
  }
  return null;
}

// Replaces the single-prompt body a provider branch built with the full transcript and tools.
function applyConversation(body, provider, model, { systemPrompt = '', conversation = [], tools = null } = {}) {
  const p = normalize(provider);
  const next = { ...body };
  const renderedTools = renderTools(p, model, tools);
  if (OPENAI_COMPATIBLE.has(p)) {
    next.messages = [{ role: 'system', content: systemPrompt }, ...renderOpenAi(conversation)];
  } else if (usesAnthropicFormat(p, model)) {
    next.messages = renderAnthropic(conversation);
  } else if (GOOGLE.has(p)) {
    next.contents = renderGoogle(conversation);
  } else {
    const error = new Error(`The provider '${provider}' cannot carry a structured conversation.`);
    error.code = 'TOOLS_UNSUPPORTED';
    throw error;
  }
  if (renderedTools) next.tools = renderedTools;
  return next;
}

function parseArguments(value) {
  if (value && typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    return { query: String(value || '') };
  }
}

function readToolReply(provider, data) {
  const p = normalize(provider);
  if (OPENAI_COMPATIBLE.has(p)) {
    const message = data?.choices?.[0]?.message || {};
    const toolCalls = (Array.isArray(message.tool_calls) ? message.tool_calls : [])
      .map(call => ({ id: call?.id || null, name: call?.function?.name || '', args: parseArguments(call?.function?.arguments) }))
      .filter(call => call.name);
    return { toolCalls, raw: null, rawFormat: null };
  }
  if (p === 'anthropic' || p === 'aws bedrock') {
    const content = Array.isArray(data?.content) ? data.content : [];
    const toolCalls = content
      .filter(block => block?.type === 'tool_use' && block.name)
      .map(block => ({ id: block.id || null, name: block.name, args: block.input || {} }));
    return { toolCalls, raw: content, rawFormat: 'anthropic' };
  }
  if (GOOGLE.has(p)) {
    const parts = data?.candidates?.[0]?.content?.parts;
    const list = Array.isArray(parts) ? parts : [];
    const toolCalls = list
      .filter(part => part?.functionCall?.name)
      .map(part => ({ id: part.functionCall.id || null, name: part.functionCall.name, args: parseArguments(part.functionCall.args) }));
    return { toolCalls, raw: list, rawFormat: 'google' };
  }
  return { toolCalls: [], raw: null, rawFormat: null };
}

// What the provider itself reports. The fields mean different things per provider, so they are
// shown as reported; `totalInputTokens` is the one figure comparable across providers, because
// Anthropic counts cache reads and writes apart from the rest of the input.
function readUsage(provider, data) {
  const p = normalize(provider);
  const count = value => (value == null || !Number.isFinite(Number(value)) ? null : Number(value));
  if (OPENAI_COMPATIBLE.has(p)) {
    const usage = data?.usage || {};
    const inputTokens = count(usage.prompt_tokens);
    return {
      inputTokens,
      outputTokens: count(usage.completion_tokens),
      cacheReadTokens: count(usage.prompt_tokens_details?.cached_tokens),
      cacheWriteTokens: null,
      totalInputTokens: inputTokens
    };
  }
  if (p === 'anthropic' || p === 'aws bedrock') {
    const usage = data?.usage || {};
    const inputTokens = count(usage.input_tokens);
    const cacheReadTokens = count(usage.cache_read_input_tokens);
    const cacheWriteTokens = count(usage.cache_creation_input_tokens);
    return {
      inputTokens,
      outputTokens: count(usage.output_tokens),
      cacheReadTokens,
      cacheWriteTokens,
      totalInputTokens: inputTokens == null ? null : inputTokens + (cacheReadTokens || 0) + (cacheWriteTokens || 0)
    };
  }
  if (GOOGLE.has(p)) {
    const usage = data?.usageMetadata || {};
    const inputTokens = count(usage.promptTokenCount);
    return {
      inputTokens,
      outputTokens: count(usage.candidatesTokenCount),
      cacheReadTokens: count(usage.cachedContentTokenCount),
      cacheWriteTokens: null,
      totalInputTokens: inputTokens
    };
  }
  return { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, totalInputTokens: null };
}

// Claude through Bedrock's InvokeModel takes explicit cache breakpoints only, so the end of the
// request is marked on its last block; moving that mark forward each turn keeps earlier ones readable.
// Every message is sent as blocks, so a turn is written the same way whether or not it carries the mark.
function applyCacheBreakpoint(body, provider, model) {
  if (!isBedrockClaude(provider, model) || !Array.isArray(body?.messages) || !body.messages.length) return body;
  const messages = body.messages.map(message => (typeof message.content === 'string'
    ? { ...message, content: [{ type: 'text', text: message.content || '.' }] }
    : message));
  const last = messages[messages.length - 1];
  const content = [...(Array.isArray(last.content) ? last.content : [])];
  if (!content.length) return body;
  content[content.length - 1] = { ...content[content.length - 1], cache_control: { type: 'ephemeral' } };
  messages[messages.length - 1] = { ...last, content };
  return { ...body, messages };
}

// The transcript as plain messages, so the payload budget measures what is actually sent.
function flattenConversation(conversation, tools = null) {
  const messages = [];
  if (Array.isArray(tools) && tools.length) messages.push({ role: 'system', content: JSON.stringify(tools) });
  for (const entry of conversation || []) {
    if (entry.role === 'user') {
      messages.push({ role: 'user', content: String(entry.text || '') });
    } else if (entry.role === 'assistant') {
      const calls = (entry.toolCalls || []).map(call => `${call.name}(${JSON.stringify(call.args || {})})`).join('\n');
      messages.push({ role: 'assistant', content: [entry.text, calls].filter(Boolean).join('\n') });
    } else if (entry.role === 'tool') {
      messages.push({ role: 'user', content: entry.results.map(result => String(result.content || '')).join('\n\n') });
    }
  }
  return messages;
}

module.exports = {
  supportsNativeTools,
  applyConversation,
  applyCacheBreakpoint,
  readToolReply,
  readUsage,
  flattenConversation
};
