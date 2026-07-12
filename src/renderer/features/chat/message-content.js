export function parseMessageContent(content) {
  if (!content) return { thinking: '', response: '' };

  const thinkingRegex = /<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/i;
  const match = thinkingRegex.exec(content);
  if (match) {
    return {
      thinking: match[1].trim(),
      response: content.replace(thinkingRegex, '').trim()
    };
  }

  const partialMatch = content.match(/<think(?:ing)?>/i);
  if (partialMatch) {
    const [before = '', thinking = ''] = content.split(partialMatch[0]);
    return { thinking: thinking.trim(), response: before.trim() };
  }

  return { thinking: '', response: content };
}
