// Moves first, then replaces each summary that covers both sides with one per side.
// A rebuild that fails leaves that summary as it was, so the move itself always stands.
export async function moveBetweenThreads(electronAPI, { chatId, plan, rebuildMixed, profileId }) {
  const result = await electronAPI.moveMessagesToThread({ chatId, messageIds: plan.requested, toThread: plan.target });
  if (!result?.success || !rebuildMixed || !result.mixedSummaries?.length) return { result, failed: [] };
  const rebuild = await electronAPI.splitMixedSummaries({ chatId, blockIds: result.mixedSummaries.map(summary => summary.id), profileId });
  const failed = (rebuild?.results || []).filter(entry => !entry.success);
  if (!rebuild?.results?.length && !rebuild?.success) failed.push({ title: '', error: rebuild?.error || '' });
  return { result, failed };
}

export function rebuildFailureMessage(failed) {
  const named = failed.length === 1 && failed[0].title ? `“${failed[0].title}”` : `${failed.length} summaries`;
  const reason = failed.length === 1 && failed[0].error ? ` ${failed[0].error}` : '';
  return `Moved, but ${named} could not be rebuilt, so ${failed.length === 1 ? 'it stays' : 'they stay'} as before.${reason}`;
}

export const firstActiveProfile = chat => {
  let list = chat?.activeProfiles;
  if (typeof list === 'string') {
    try { list = JSON.parse(list); } catch { list = []; }
  }
  if (!Array.isArray(list)) list = [];
  return list.find(id => id && id !== 'undefined') || '';
};
