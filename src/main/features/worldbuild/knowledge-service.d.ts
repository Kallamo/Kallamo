export interface WorldbuildKnowledgeService {
  ensureAwareness(input: {
    workspaceId: string;
    ownerId: string;
    targetId: string;
    sourceType: 'manual' | 'relationship' | 'faction-membership' | 'inventory' | 'memory' | 'narrative' | 'fact' | 'statement' | 'import' | 'locality';
    sourceId: string;
    knownAs?: string;
    audienceType?: 'all-members' | 'selected-members';
  }): unknown;
  listCards(workspaceId: string, ownerId: string): any[];
  getCard(workspaceId: string, ownerId: string, targetId: string): any;
  setKnownFields(input: { workspaceId: string; ownerId: string; targetId: string; fieldKeys: string[] }): any;
  markCurrentFieldsKnown(input: { workspaceId: string; ownerId: string; targetId: string }): any;
  setKnownRelationships(input: { workspaceId: string; ownerId: string; targetId: string; relationshipIds: string[] }): any;
  removeCard(input: { workspaceId: string; ownerId: string; targetId: string }): null;
  setAudience(input: { workspaceId: string; ownerId: string; targetId: string; audienceType: 'all-members' | 'selected-members'; memberIds?: string[] }): any;
  reconcileWorkspace(workspaceId: string): void;
}

export function createWorldbuildKnowledgeService(db: unknown): WorldbuildKnowledgeService;
