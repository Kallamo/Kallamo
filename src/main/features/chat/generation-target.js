function parseIdList(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

class GenerationTargetError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'GenerationTargetError';
    this.code = code;
  }
}

function resolveWorkspaceGenerationTarget(database, chatId, targetId) {
  const chat = database.prepare('SELECT * FROM chats WHERE id = ?').get(chatId);
  if (!chat) {
    throw new GenerationTargetError('workspace-not-found', `Workspace not found: ${chatId}`);
  }
  if (!targetId) {
    throw new GenerationTargetError('target-required', 'Select an active AI Profile or Workflow before generating.');
  }

  const activeProfileIds = new Set(parseIdList(chat.activeProfiles));
  const activeWorkflowIds = new Set(parseIdList(chat.activeWorkflows));

  if (activeWorkflowIds.has(targetId)) {
    const workflow = database.prepare('SELECT * FROM workflows WHERE id = ?').get(targetId);
    if (!workflow) {
      throw new GenerationTargetError('workflow-not-found', `Active Workflow not found: ${targetId}`);
    }
    return { chat, kind: 'workflow', target: workflow };
  }

  if (activeProfileIds.has(targetId)) {
    const profile = database.prepare('SELECT * FROM writing_profiles WHERE id = ?').get(targetId);
    if (!profile) {
      throw new GenerationTargetError('profile-not-found', `Active AI Profile not found: ${targetId}`);
    }
    return { chat, kind: 'profile', target: profile };
  }

  throw new GenerationTargetError(
    'target-not-active',
    'The selected AI Profile or Workflow is not active in this workspace.'
  );
}

function applyGenerationHistory(messages, { historyEdit = null, regenerateMessageId = null } = {}) {
  if (historyEdit && regenerateMessageId) {
    throw new GenerationTargetError('invalid-history-operation', 'A generation cannot edit and regenerate history at the same time.');
  }

  if (historyEdit) {
    if (typeof historyEdit.messageId !== 'string' || typeof historyEdit.content !== 'string') {
      throw new GenerationTargetError('invalid-history-edit', 'Invalid edited message history.');
    }
    const messageIndex = messages.findIndex(message => message.id === historyEdit.messageId);
    if (messageIndex < 0 || messages[messageIndex].role !== 'user') {
      throw new GenerationTargetError('edited-message-not-found', 'Edited user message was not found in this workspace.');
    }
    return messages.slice(0, messageIndex).concat({
      ...messages[messageIndex],
      content: historyEdit.content
    });
  }

  if (regenerateMessageId) {
    const messageIndex = messages.findIndex(message => message.id === regenerateMessageId);
    if (messageIndex < 0 || messages[messageIndex].role !== 'ai') {
      throw new GenerationTargetError('regenerated-message-not-found', 'The AI response being regenerated was not found in this workspace.');
    }
    return messages.slice(0, messageIndex);
  }

  return messages;
}

module.exports = {
  applyGenerationHistory,
  GenerationTargetError,
  parseIdList,
  resolveWorkspaceGenerationTarget
};
