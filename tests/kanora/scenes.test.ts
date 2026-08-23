import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runDatabaseMigrations } from '../../src/main/database/migrations.js';
import type { Scene } from '../../src/kanora/contracts';
import { NarrativeSceneRepository, NarrativeSceneValidationError } from '../../src/kanora/scenes';
import { openTestDatabase } from '../sqlite-test-database';

const firstScene: Scene = {
  id: 'scene-courtyard',
  projectId: 'project-example',
  status: 'active',
  locationId: 'courtyard',
  participantIds: ['mara', 'elias'],
  possibleObserverIds: ['guard'],
  perspective: { access: 'subjective', focalSubjectId: 'elias' },
  position: { sequence: 10 },
  origin: { originType: 'writing-document', originId: 'chapter-one' }
};

describe('narrative scene persistence', () => {
  let directory: string;
  let db: Database.Database;
  let scenes: NarrativeSceneRepository;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'kanora-scenes-'));
    db = openTestDatabase(join(directory, 'scenes.db'));
    db.pragma('foreign_keys = ON');
    runDatabaseMigrations(db);
    scenes = new NarrativeSceneRepository(db);
  });

  afterEach(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  test('reconstructs a scene with participants, possible observers, perspective, and origin', () => {
    scenes.save(firstScene);

    expect(scenes.get(firstScene.projectId, firstScene.id)).toEqual(firstScene);
    expect(scenes.getActive(firstScene.projectId)).toEqual(firstScene);
  });

  test('allows only one active scene in a project', () => {
    scenes.save(firstScene);
    const secondScene = { ...firstScene, id: 'scene-library', position: { sequence: 20 } };

    expect(() => scenes.save(secondScene)).toThrowError(expect.objectContaining({ code: 'ACTIVE_SCENE_EXISTS' }));
    expect(scenes.list(firstScene.projectId)).toEqual([firstScene]);
  });

  test('keeps completed scenes in narrative order and permits the next active scene', () => {
    scenes.save(firstScene);
    scenes.complete(firstScene.projectId, firstScene.id);
    const secondScene = { ...firstScene, id: 'scene-library', locationId: 'library', position: { sequence: 20 } };
    scenes.save(secondScene);

    expect(scenes.list(firstScene.projectId)).toEqual([
      { ...firstScene, status: 'completed' },
      secondScene
    ]);
    expect(scenes.getActive(firstScene.projectId)).toEqual(secondScene);
  });

  test('isolates active scenes by project', () => {
    scenes.save(firstScene);
    scenes.save({ ...firstScene, projectId: 'project-other' });

    expect(scenes.getActive(firstScene.projectId)?.projectId).toBe(firstScene.projectId);
    expect(scenes.getActive('project-other')?.projectId).toBe('project-other');
  });

  test('rejects malformed scenes before writing', () => {
    const invalid = { ...firstScene, participantIds: ['mara', 'mara'] };

    expect(() => scenes.save(invalid)).toThrow(NarrativeSceneValidationError);
    expect(scenes.list(firstScene.projectId)).toEqual([]);
  });
});
