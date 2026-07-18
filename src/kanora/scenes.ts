import type Database from 'better-sqlite3';
import type { Scene } from './contracts';
import { VALIDATION_ISSUE_CODES, validateScene, type ValidationIssue } from './validation';

interface SceneRow {
  workspace_id: string;
  scene_id: string;
  status: Scene['status'];
  location_id: string | null;
  perspective_access: Scene['perspective']['access'];
  focal_subject_id: string | null;
  allowed_subject_ids_json: string | null;
  narrative_sequence: number;
  narrative_timestamp: string | null;
  origin_type: NonNullable<Scene['origin']>['originType'] | null;
  origin_id: string | null;
}

interface EntityRow {
  entity_id: string;
}

export class NarrativeSceneValidationError extends Error {
  constructor(readonly issues: ValidationIssue[]) {
    super('Scene is not a valid Kanora Contract v1 payload.');
    this.name = 'NarrativeSceneValidationError';
  }
}

export class NarrativeSceneConflictError extends Error {
  constructor(readonly code: 'ACTIVE_SCENE_EXISTS', message: string) {
    super(message);
    this.name = 'NarrativeSceneConflictError';
  }
}

export class NarrativeSceneRepository {
  private readonly insertScene;
  private readonly insertParticipant;
  private readonly insertObserver;
  private readonly selectScene;
  private readonly selectParticipants;
  private readonly selectObservers;
  private readonly selectActive;
  private readonly selectAll;
  private readonly completeScene;

  constructor(private readonly db: Database.Database) {
    this.insertScene = db.prepare(`
      INSERT INTO kanora_scenes (
        workspace_id, scene_id, status, location_id, perspective_access,
        focal_subject_id, allowed_subject_ids_json, narrative_sequence,
        narrative_timestamp, origin_type, origin_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.insertParticipant = db.prepare(`
      INSERT INTO kanora_scene_participants (workspace_id, scene_id, ordinal, entity_id)
      VALUES (?, ?, ?, ?)
    `);
    this.insertObserver = db.prepare(`
      INSERT INTO kanora_scene_possible_observers (workspace_id, scene_id, ordinal, entity_id)
      VALUES (?, ?, ?, ?)
    `);
    this.selectScene = db.prepare('SELECT * FROM kanora_scenes WHERE workspace_id = ? AND scene_id = ?');
    this.selectParticipants = db.prepare(`
      SELECT entity_id FROM kanora_scene_participants
      WHERE workspace_id = ? AND scene_id = ? ORDER BY ordinal
    `);
    this.selectObservers = db.prepare(`
      SELECT entity_id FROM kanora_scene_possible_observers
      WHERE workspace_id = ? AND scene_id = ? ORDER BY ordinal
    `);
    this.selectActive = db.prepare("SELECT * FROM kanora_scenes WHERE workspace_id = ? AND status = 'active'");
    this.selectAll = db.prepare(`
      SELECT * FROM kanora_scenes WHERE workspace_id = ?
      ORDER BY narrative_sequence, scene_id
    `);
    this.completeScene = db.prepare(`
      UPDATE kanora_scenes SET status = 'completed'
      WHERE workspace_id = ? AND scene_id = ? AND status = 'active'
    `);
  }

  save(scene: Scene): Scene {
    this.validate(scene);
    try {
      this.db.transaction(() => {
        this.insertScene.run(
          scene.projectId,
          scene.id,
          scene.status,
          scene.locationId ?? null,
          scene.perspective.access,
          scene.perspective.focalSubjectId ?? null,
          scene.perspective.allowedSubjectIds ? JSON.stringify(scene.perspective.allowedSubjectIds) : null,
          scene.position.sequence,
          scene.position.timestamp ?? null,
          scene.origin?.originType ?? null,
          scene.origin?.originId ?? null
        );
        scene.participantIds.forEach((entityId, ordinal) => {
          this.insertParticipant.run(scene.projectId, scene.id, ordinal, entityId);
        });
        scene.possibleObserverIds.forEach((entityId, ordinal) => {
          this.insertObserver.run(scene.projectId, scene.id, ordinal, entityId);
        });
      })();
    } catch (cause) {
      if (scene.status === 'active' && this.getActive(scene.projectId)) {
        throw new NarrativeSceneConflictError('ACTIVE_SCENE_EXISTS', 'The project already has an active scene.');
      }
      throw cause;
    }
    return this.get(scene.projectId, scene.id)!;
  }

  get(projectId: string, sceneId: string): Scene | undefined {
    const row = this.selectScene.get(projectId, sceneId) as SceneRow | undefined;
    return row ? this.hydrate(row) : undefined;
  }

  getActive(projectId: string): Scene | undefined {
    const row = this.selectActive.get(projectId) as SceneRow | undefined;
    return row ? this.hydrate(row) : undefined;
  }

  list(projectId: string): Scene[] {
    return (this.selectAll.all(projectId) as SceneRow[]).map(row => this.hydrate(row));
  }

  complete(projectId: string, sceneId: string): Scene {
    if (this.completeScene.run(projectId, sceneId).changes !== 1) {
      throw new Error('Active scene was not found.');
    }
    return this.get(projectId, sceneId)!;
  }

  private validate(scene: Scene): void {
    const validation = validateScene(scene);
    const issues = validation.success ? [] : validation.issues;
    for (const [key, ids] of [
      ['participantIds', scene.participantIds],
      ['possibleObserverIds', scene.possibleObserverIds]
    ] as const) {
      if (new Set(ids).size !== ids.length) {
        issues.push({
          code: VALIDATION_ISSUE_CODES.INVALID_VALUE,
          path: `$.${key}`,
          message: 'Entity IDs must be unique.'
        });
      }
    }
    if (issues.length) throw new NarrativeSceneValidationError(issues);
  }

  private hydrate(row: SceneRow): Scene {
    const focalSubjectId = row.focal_subject_id ?? undefined;
    const allowedSubjectIds = row.allowed_subject_ids_json
      ? JSON.parse(row.allowed_subject_ids_json) as string[]
      : undefined;
    return {
      id: row.scene_id,
      projectId: row.workspace_id,
      status: row.status,
      ...(row.location_id ? { locationId: row.location_id } : {}),
      participantIds: this.getEntityIds(this.selectParticipants, row.workspace_id, row.scene_id),
      possibleObserverIds: this.getEntityIds(this.selectObservers, row.workspace_id, row.scene_id),
      perspective: {
        access: row.perspective_access,
        ...(focalSubjectId ? { focalSubjectId } : {}),
        ...(allowedSubjectIds ? { allowedSubjectIds } : {})
      },
      position: {
        sequence: row.narrative_sequence,
        ...(row.narrative_timestamp ? { timestamp: row.narrative_timestamp } : {})
      },
      ...(row.origin_type && row.origin_id
        ? { origin: { originType: row.origin_type, originId: row.origin_id } }
        : {})
    };
  }

  private getEntityIds(statement: Database.Statement, projectId: string, sceneId: string): string[] {
    return (statement.all(projectId, sceneId) as EntityRow[]).map(row => row.entity_id);
  }
}
