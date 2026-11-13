// Reasoning stored as <think>, <thinking> or <reasoning> is display-only: never history, archive, or query text.
// Mirrors the renderer's split (message-content.js): an unclosed block runs to the end.
const CLOSED_REASONING = /<(think(?:ing)?|reasoning)>[\s\S]*?<\/\1>/gi;
const OPEN_REASONING = /<(?:think(?:ing)?|reasoning)>[\s\S]*$/i;

function stripReasoning(text) {
  const value = String(text ?? '');
  if (!/<(?:think|reasoning)/i.test(value)) return value;
  return value.replace(CLOSED_REASONING, '').replace(OPEN_REASONING, '').trim();
}

module.exports = { stripReasoning };
