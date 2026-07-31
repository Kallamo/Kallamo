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

module.exports = {
  GenerationTargetError,
  parseIdList,
  resolveWorkspaceGenerationTarget
};
