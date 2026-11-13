export function parseMessageContent(content) {
  if (!content) return { thinking: '', response: '' };

  const thinkingRegex = /<(think(?:ing)?|reasoning)>([\s\S]*?)<\/\1>/i;
  const match = thinkingRegex.exec(content);
  if (match) {
    return {
      thinking: match[2].trim(),
      response: content.replace(thinkingRegex, '').trim()
    };
  }

  const partialMatch = content.match(/<(?:think(?:ing)?|reasoning)>/i);
  if (partialMatch) {
    const [before = '', thinking = ''] = content.split(partialMatch[0]);
    return { thinking: thinking.trim(), response: before.trim() };
  }

  return { thinking: '', response: content };
}

// What a message costs in the conversation the model reads: reasoning is shown, never sent.
export function estimateMessageTokens(content) {
  return Math.ceil(parseMessageContent(String(content || '')).response.length / 4);
}
