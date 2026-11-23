// A Roleplay turn the Narrative State holds can only leave with every turn after it, and what it
// changed is taken back, the same as when the reply is deleted.
const { markedOrigins } = require('../../database/thread-migration');

function expandStoryMove(db, chatId, messageIds, toThread) {
  const ids = [...new Set((Array.isArray(messageIds) ? messageIds : [messageIds]).filter(Boolean))];
  if (toThread !== 'chat' || !ids.length) return { ids, takeBack: [], added: 0 };
  const marked = markedOrigins(db, chatId);
  const story = db.prepare("SELECT id, role FROM messages WHERE chatId = ? AND thread = 'roleplay' ORDER BY createdAt ASC, id ASC").all(chatId);
  const selected = new Set(ids);
  // A user message belongs to the turn of the reply right after it.
  const holdsStory = index => {
    const message = story[index];
    const reply = message.role === 'user' ? story[index + 1] : message;
    return Boolean(reply && reply.role !== 'user' && marked.has(reply.id));
  };
  const first = story.findIndex((message, index) => selected.has(message.id) && holdsStory(index));
  if (first < 0) return { ids, takeBack: [], added: 0 };
  const start = story[first].role !== 'user' && first > 0 && story[first - 1].role === 'user' ? first - 1 : first;
  const turns = story.slice(start);
  const expanded = [...new Set([...ids, ...turns.map(message => message.id)])];
  return {
    ids: expanded,
    takeBack: turns.filter(message => message.role !== 'user' && marked.has(message.id)).map(message => message.id).reverse(),
    added: expanded.length - ids.length
  };
}

module.exports = { expandStoryMove };
