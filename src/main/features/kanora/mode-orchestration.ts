import type Database from 'better-sqlite3';
import type { NarrativePosition, Perspective } from '../../../kanora/contracts';
import type { ContextCandidate } from '../../../kanora/context-planner';

export type WorkspaceExperienceMode = 'standard' | 'roleplay';

export interface KallamoContextStrategy {
  mode: WorkspaceExperienceMode;
  perspective: Perspective;
  through: NarrativePosition;
  hasActiveScene: boolean;
  prepareCandidates(candidates: ContextCandidate[]): ContextCandidate[];
}

export function getWorkspaceExperienceMode(
  db: Database.Database,
  workspaceId: string
): WorkspaceExperienceMode {
  const row = db.prepare('SELECT mode FROM workspace_experience_modes WHERE workspace_id = ?')
    .get(workspaceId) as { mode: WorkspaceExperienceMode } | undefined;
  return row?.mode === 'roleplay' ? 'roleplay' : 'standard';
}

export function setWorkspaceExperienceMode(
  db: Database.Database,
  workspaceId: string,
  mode: WorkspaceExperienceMode
): WorkspaceExperienceMode {
  if (!workspaceId || (mode !== 'standard' && mode !== 'roleplay')) {
    throw new Error('A valid workspace and experience mode are required.');
  }
  db.prepare(`
    INSERT INTO workspace_experience_modes (workspace_id, mode, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(workspace_id) DO UPDATE SET mode = excluded.mode, updated_at = excluded.updated_at
  `).run(workspaceId, mode, Date.now());
  return mode;
}

export function createStandardStrategy(through: NarrativePosition): KallamoContextStrategy {
  return {
    mode: 'standard',
    perspective: { access: 'omniscient' },
    through,
    hasActiveScene: false,
    prepareCandidates: candidates => candidates.filter(isAvailableToAi)
  };
}

export function createRoleplayStrategy(
  perspective: Perspective,
  through: NarrativePosition,
  hasActiveScene: boolean
): KallamoContextStrategy {
  return {
    mode: 'roleplay',
    perspective,
    through,
    hasActiveScene,
    prepareCandidates: candidates => candidates.filter(isNotSuppressed)
  };
}

function isAvailableToAi(candidate: ContextCandidate): boolean {
  const epistemic = candidate.epistemic;
  return !('accessibility' in epistemic)
    || (epistemic.accessibility !== 'suppressed' && epistemic.accessibility !== 'inaccessible');
}

function isNotSuppressed(candidate: ContextCandidate): boolean {
  const epistemic = candidate.epistemic;
  return !('accessibility' in epistemic) || epistemic.accessibility !== 'suppressed';
}
