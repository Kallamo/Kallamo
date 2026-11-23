// What the Writing Desk reads of the workspace's conversations, in one line for the Invoke dialog.
const SOURCES = ['none', 'chat', 'roleplay', 'both'];

export const deskHistorySource = chat => (SOURCES.includes(chat?.wdHistorySource)
  ? chat.wdHistorySource
  : (chat?.wdUseChatHistory === 0 ? 'none' : 'chat'));

export function deskHistoryNote(chat) {
  if (!chat) return '';
  const source = deskHistorySource(chat);
  if (source === 'none') return 'Reads no conversation history';
  const share = Number(chat.wdHistoryShare) || 25;
  const what = source === 'both' ? 'roleplay and chat' : source;
  return `Reads ${what} history, ${share}%`;
}
