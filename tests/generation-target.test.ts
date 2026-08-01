import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';
import {
  isGenerationEventForWorkspace,
  resolveActiveGenerationTarget
} from '../src/renderer/features/chat/generation-target';

const require = createRequire(import.meta.url);
const {
  GenerationTargetError,
  resolveWorkspaceGenerationTarget
} = require('../src/main/features/chat/generation-target');

function createDatabase({ chat, profiles = [], workflows = [] }: any) {
  return {
    prepare(query: string) {
      if (query.includes('FROM chats')) return { get: (id: string) => id === chat?.id ? chat : undefined };
      if (query.includes('FROM writing_profiles')) return { get: (id: string) => profiles.find((item: any) => item.id === id) };
      if (query.includes('FROM workflows')) return { get: (id: string) => workflows.find((item: any) => item.id === id) };
      throw new Error(`Unexpected query: ${query}`);
    }
  };
}

describe('main-process generation target validation', () => {
  const chat = {
    id: 'workspace-1',
    activeProfiles: JSON.stringify(['profile-1']),
    activeWorkflows: JSON.stringify(['workflow-1'])
  };
  const profiles = [{ id: 'profile-1' }, { id: 'profile-2' }];
  const workflows = [{ id: 'workflow-1', steps: JSON.stringify([{ profileId: 'profile-2' }]) }];

  test('allows a direct profile active in the workspace', () => {
    expect(resolveWorkspaceGenerationTarget(
      createDatabase({ chat, profiles, workflows }),
      chat.id,
      'profile-1'
    )).toMatchObject({ kind: 'profile', target: profiles[0] });
  });

  test('rejects a direct profile that is not active in the workspace', () => {
    expect(() => resolveWorkspaceGenerationTarget(
      createDatabase({ chat, profiles, workflows }),
      chat.id,
      'profile-2'
    )).toThrowError(expect.objectContaining<Partial<InstanceType<typeof GenerationTargetError>>>({
      code: 'target-not-active'
    }));
  });

  test('allows an active workflow to use an internally configured inactive profile', () => {
    expect(resolveWorkspaceGenerationTarget(
      createDatabase({ chat, profiles, workflows }),
      chat.id,
      'workflow-1'
    )).toMatchObject({ kind: 'workflow', target: workflows[0] });
  });

  test('does not fall back when no target is provided', () => {
    expect(() => resolveWorkspaceGenerationTarget(
      createDatabase({ chat, profiles, workflows }),
      chat.id,
      ''
    )).toThrowError(expect.objectContaining({ code: 'target-required' }));
  });
});

describe('renderer generation target resolution', () => {
  const input = {
    activeProfileIds: ['profile-1'],
    activeWorkflowIds: ['workflow-1'],
    profiles: [{ id: 'profile-1' }, { id: 'profile-2' }],
    workflows: [{ id: 'workflow-1' }]
  };

  test('replaces a stale selection with an active target', () => {
    expect(resolveActiveGenerationTarget({ ...input, selectedTargetId: 'profile-2' })?.id).toBe('profile-1');
  });

  test('keeps an active workflow target valid', () => {
    expect(resolveActiveGenerationTarget({ ...input, selectedTargetId: 'workflow-1' })?.id).toBe('workflow-1');
  });

  test('rejects events emitted for another workspace', () => {
    expect(isGenerationEventForWorkspace({ chatId: 'workspace-2' }, 'workspace-1')).toBe(false);
    expect(isGenerationEventForWorkspace({}, 'workspace-1')).toBe(false);
    expect(isGenerationEventForWorkspace({ chatId: 'workspace-1' }, 'workspace-1')).toBe(true);
  });
});
