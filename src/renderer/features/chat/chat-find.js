import { parseMarkdownCached } from '../../utils/markdown';
import { parseMessageContent } from './message-content';

// The searched text is the rendered text, so a count in the data matches the highlights on screen.
const textCache = new Map();

function renderedText(markdown) {
  const cached = textCache.get(markdown);
  if (cached !== undefined) return cached;
  const element = document.createElement('div');
  element.innerHTML = parseMarkdownCached(markdown, { dialogue: true });
  const text = element.textContent || '';
  if (textCache.size > 4000) textCache.clear();
  textCache.set(markdown, text);
  return text;
}

function isAttachmentNote(message) {
  let files = message.attachedFiles;
  if (typeof files === 'string') {
    try { files = JSON.parse(files); } catch { files = []; }
  }
  return Array.isArray(files) && files.length > 0
    && message.content === `Attached files: ${files.map(file => file.name).join(', ')}`;
}

export function searchableText(message) {
  if (message.role === 'user') return isAttachmentNote(message) ? '' : renderedText(message.content || '');
  return renderedText(parseMessageContent(message.content).response || '');
}

const fold = (text, caseSensitive) => (caseSensitive ? text : text.toLocaleLowerCase());

function offsetsIn(text, query, caseSensitive) {
  const haystack = fold(text, caseSensitive);
  const needle = fold(query, caseSensitive);
  const offsets = [];
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) offsets.push(at);
  return offsets;
}

/** Every occurrence in the chat, oldest first, as { messageId, occurrence }. */
export function findInMessages(messages, query, caseSensitive) {
  if (!query) return [];
  return messages.flatMap(message => offsetsIn(searchableText(message), query, caseSensitive)
    .map((_, occurrence) => ({ messageId: message.id, occurrence })));
}

/** Ranges over a rendered message, spanning the inline spans markdown and dialogue colouring add. */
export function rangesIn(element, query, caseSensitive) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let text = '';
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    nodes.push({ node, start: text.length });
    text += node.data;
  }
  const locate = offset => {
    let index = nodes.length - 1;
    while (index > 0 && nodes[index].start > offset) index -= 1;
    return { node: nodes[index].node, offset: offset - nodes[index].start };
  };
  return offsetsIn(text, query, caseSensitive).map(at => {
    const start = locate(at);
    const end = locate(at + query.length - 1);
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset + 1);
    return range;
  });
}
