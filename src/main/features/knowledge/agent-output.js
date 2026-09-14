// Reads one turn of the retrieval planner. Models vary in how they write the tags, so
// parsing is tolerant of quoting, ordering and argument naming.

const { stripReasoning } = require('../chat/message-text');
const { TOOL_NAMES } = require('./planner-tools');

const KNOWN_TOOLS = TOOL_NAMES;

// Accepts double quotes, single quotes, or unquoted values, in any order.
function parseAttrs(attrStr) {
  const attrs = {};
  const attrRegex = /([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match;
  while ((match = attrRegex.exec(attrStr)) !== null) {
    attrs[match[1].toLowerCase()] = (match[2] ?? match[3] ?? match[4] ?? '').trim();
  }
  return attrs;
}

// Each opening tag is read on its own. A call whose argument sits in the inner text is
// closed by the next </tool_call>, but only when no other call starts first: otherwise a
// single paired call further down swallows every self-closing call before it.
function parseToolCalls(text) {
  const source = String(text || '');
  const calls = [];
  const openRegex = /<tool_call\b([^>]*?)(\/)?>/gi;
  let open;
  while ((open = openRegex.exec(source)) !== null) {
    const attrs = parseAttrs(open[1] || '');
    const name = (attrs.name || '').toLowerCase();
    let arg = attrs.query ?? attrs.filename ?? attrs.file ?? attrs.q ?? attrs.term ?? attrs.arg ?? '';
    if (!arg && !open[2]) {
      const rest = source.slice(openRegex.lastIndex);
      const close = rest.search(/<\/tool_call>/i);
      const next = rest.search(/<tool_call\b/i);
      if (close !== -1 && (next === -1 || close < next)) arg = rest.slice(0, close).trim();
    }
    if (KNOWN_TOOLS.includes(name) && arg) calls.push({ name, arg });
  }
  return calls;
}

function parseFinish(text) {
  const block = /<finish\b([^>]*)>([\s\S]*?)<\/finish>/i.exec(String(text || ''));
  if (!block) return null;
  return { sources: parseAttrs(block[1] || '').sources || '', body: block[2] };
}

// A reply that calls a tool cannot also be done: the results it claims to have read were
// never delivered. The calls run, and the finish waits for a turn that has seen them.
// Reasoning is the model thinking aloud, so a call or finish written there was considered,
// not chosen; only the reply outside it is read.
function parseAgentTurn(text) {
  const reply = stripReasoning(text);
  const toolCalls = parseToolCalls(reply);
  const finish = toolCalls.length ? null : parseFinish(reply);
  return { toolCalls, finish, imaginedFinish: toolCalls.length > 0 && parseFinish(reply) !== null, reply };
}

module.exports = { KNOWN_TOOLS, parseAttrs, parseToolCalls, parseFinish, parseAgentTurn };
