// One neutral transcript for every provider's tool-calling format, so the loop never branches on it.
// `raw` is replayed unchanged when the format matches: thinking blocks must return exactly as sent.

const { readUsage } = require('./response-metadata');
const OPENAI_COMPATIBLE = new Set(['openai', 'openrouter', 'local']);
const GOOGLE = new Set(['google ai', 'vertex ai']);

function normalize(provider) {
  return String(provider || '').toLowerCase();
}

// Families that predate chat messages on Bedrock and still read one flat prompt string.
const BEDROCK_PROMPT_MODELS = /mistral-7b|mixtral|mistral-large-2402|mistral-small-2402|amazon\.|cohere\./;

// Bedrock passes each request through in its model's own format. Newer families (Kimi,
// DeepSeek, Qwen, gpt-oss, current Mistral) read OpenAI chat messages, so that is the default.
function bedrockFormat(model) {
  const id = String(model || '').toLowerCase();
  if (id.includes('claude')) return 'anthropic';
  if (id.includes('meta') || id.includes('llama')) return 'llama';
  if (BEDROCK_PROMPT_MODELS.test(id)) return 'prompt';
  return 'openai';
}

function isBedrockClaude(provider, model) {
  return normalize(provider) === 'aws bedrock' && bedrockFormat(model) === 'anthropic';
}

function usesAnthropicFormat(provider, model) {
  return normalize(provider) === 'anthropic' || isBedrockClaude(provider, model);
}

function usesOpenAiFormat(provider, model) {
  const p = normalize(provider);
  return OPENAI_COMPATIBLE.has(p) || (p === 'aws bedrock' && bedrockFormat(model) === 'openai');
}

// Bedrock's flat-prompt families have no place for tools.
function supportsNativeTools(provider, model) {
  const p = normalize(provider);
  return usesOpenAiFormat(p, model) || GOOGLE.has(p) || usesAnthropicFormat(p, model);
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
  if (usesOpenAiFormat(p, model)) {
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
  if (usesOpenAiFormat(p, model)) {
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

// Bedrock replies in its model's format, so the reply's own shape tells which one it is.
function readToolReply(provider, data) {
  const p = normalize(provider);
  if (OPENAI_COMPATIBLE.has(p) || (p === 'aws bedrock' && Array.isArray(data?.choices))) {
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

// Every message goes as blocks, so a turn serializes the same with or without the mark.
// `fromEnd` > 1 reads a prefix an earlier request wrote without writing one.
function applyCacheBreakpoint(body, provider, model, fromEnd = 1) {
  if (normalize(provider) === 'openrouter') return markOpenRouterMessage(body, fromEnd);
  if (!usesAnthropicFormat(provider, model) || !Array.isArray(body?.messages)) return body;
  const index = body.messages.length - fromEnd;
  if (index < 0) return body;
  const messages = body.messages.map(message => (typeof message.content === 'string'
    ? { ...message, content: [{ type: 'text', text: message.content || '.' }] }
    : message));
  const target = messages[index];
  const content = [...(Array.isArray(target.content) ? target.content : [])];
  if (!content.length) return body;
  content[content.length - 1] = { ...content[content.length - 1], cache_control: { type: 'ephemeral' } };
  messages[index] = { ...target, content };
  return { ...body, messages };
}

// OpenRouter reads a marker on a text content part. Tool results and tool-call turns carry no text
// part, so the mark lands on the nearest earlier message that does.
function markOpenRouterMessage(body, fromEnd) {
  if (!Array.isArray(body?.messages)) return body;
  const messages = [...body.messages];
  for (let index = messages.length - fromEnd; index >= 0; index -= 1) {
    const message = messages[index];
    if (!['user', 'system', 'assistant'].includes(message?.role)) continue;
    const parts = typeof message.content === 'string'
      ? (message.content ? [{ type: 'text', text: message.content }] : [])
      : (Array.isArray(message.content) ? [...message.content] : []);
    const last = parts.map(part => part?.type).lastIndexOf('text');
    if (last < 0) continue;
    parts[last] = { ...parts[last], cache_control: { type: 'ephemeral' } };
    messages[index] = { ...message, content: parts };
    return { ...body, messages };
  }
  return body;
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
  bedrockFormat,
  supportsNativeTools,
  applyConversation,
  applyCacheBreakpoint,
  readToolReply,
  readUsage,
  flattenConversation
};
