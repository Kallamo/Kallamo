import type Database from 'better-sqlite3';
import { getUmweltBridge, UmweltRequestError } from './bridge';
import { removeWorldFile, worldFile } from './world-files';

/** Every workspace file holds one project; the file itself is the workspace. */
export const STORY_PROJECT = 'story';
/** The world calendar, in minutes; turns are the main axis. */
export const STORY_AXIS = 'story';

export type StoryEntityType = 'agent' | 'group' | 'thing';

// Locations hold what their locals know, so they are holders like factions.
const ENTITY_TYPES = [
  { id: 'agent', name: 'Agent', kind: 'agent' },
  { id: 'group', name: 'Group', kind: 'group' },
  { id: 'thing', name: 'Thing', kind: 'other' }
] as const;

export function storyEntityType(kallamoType: unknown): StoryEntityType {
  const type = String(kallamoType ?? '');
  if (type === 'Characters' || type === 'Creatures') return 'agent';
  if (type === 'Factions' || type === 'Locations') return 'group';
  return 'thing';
}

interface EntityRow { id: string; type: string; canonicalName: string }

const WORLDS_KEY = Symbol.for('kallamo.umwelt.worlds');
const worlds: WeakMap<Database.Database, Map<string, NarrativeWorld>> = ((globalThis as Record<symbol, WeakMap<Database.Database, Map<string, NarrativeWorld>>>)[WORLDS_KEY] ??= new WeakMap());

/** One workspace's story, kept in its own Umwelt file. */
export class NarrativeWorld {
  readonly file: string;
  private ready = false;
  private readonly known = new Map<string, StoryEntityType>();

  private constructor(readonly db: Database.Database, readonly workspaceId: string) {
    this.file = worldFile(db, workspaceId);
  }

  static of(db: Database.Database, workspaceId: string): NarrativeWorld {
    let byWorkspace = worlds.get(db);
    if (!byWorkspace) {
      byWorkspace = new Map();
      worlds.set(db, byWorkspace);
    }
    let world = byWorkspace.get(workspaceId);
    if (!world) {
      world = new NarrativeWorld(db, workspaceId);
      byWorkspace.set(workspaceId, world);
    }
    return world;
  }

  /** Deletes the workspace's story for good. */
  static remove(db: Database.Database, workspaceId: string): boolean {
    worlds.get(db)?.delete(workspaceId);
    return removeWorldFile(db, workspaceId);
  }

  /** One engine operation on this world's project. */
  call<T>(op: string, payload: Record<string, unknown> = {}): T {
    this.prepare();
    return getUmweltBridge().call<T>(this.file, op, { projectId: STORY_PROJECT, ...payload });
  }

  /** An operation whose payload names its project elsewhere (`commitBatch`, `transmitBatch`). */
  raw<T>(op: string, payload: Record<string, unknown>): T {
    this.prepare();
    return getUmweltBridge().call<T>(this.file, op, payload);
  }

  /**
   * Registers the Worldbuild entities a write names and returns the ids the engine knows. An id
   * with no entity in the workspace is left out: the caller drops what refers to it.
   */
  ensureEntities(ids: Iterable<string>): Map<string, StoryEntityType> {
    this.prepare();
    const wanted = [...new Set([...ids].filter(id => typeof id === 'string' && id))];
    const missing = wanted.filter(id => !this.known.has(id));
    if (missing.length) {
      const rows = this.db.prepare(`
        SELECT id, type, canonicalName FROM entities
        WHERE workspaceId = ? AND id IN (${missing.map(() => '?').join(', ')})
      `).all(this.workspaceId, ...missing) as EntityRow[];
      if (rows.length) this.declare(rows);
    }
    return new Map(wanted.filter(id => this.known.has(id)).map(id => [id, this.known.get(id)!]));
  }

  /** The engine type of an entity this world registered, if it did. */
  typeOf(id: string): StoryEntityType | undefined {
    return this.ensureEntities([id]).get(id);
  }

  private declare(rows: EntityRow[]): void {
    const entities = rows.map(row => ({ id: row.id, typeId: storyEntityType(row.type), name: row.canonicalName || row.id }));
    try {
      this.ensureWorld(entities);
    } catch (error) {
      // An entity whose Worldbuild type moved to another kind keeps its first one in the story.
      if (!(error instanceof UmweltRequestError) || error.code !== 'CONFLICT') throw error;
      const divergent = new Set(((error.details as { divergences?: Array<{ kind: string; id: string }> } | undefined)?.divergences ?? [])
        .filter(item => item.kind === 'entity').map(item => item.id));
      const rest = entities.filter(entity => !divergent.has(entity.id));
      if (rest.length) this.ensureWorld(rest);
      for (const id of divergent) {
        const stored = getUmweltBridge().call<{ typeId: StoryEntityType }>(this.file, 'entity.get', { projectId: STORY_PROJECT, entityId: id });
        this.known.set(id, stored.typeId);
      }
      for (const entity of rest) this.known.set(entity.id, entity.typeId);
      return;
    }
    for (const entity of entities) this.known.set(entity.id, entity.typeId);
  }

  private ensureWorld(entities: Array<{ id: string; typeId: StoryEntityType; name: string }>): void {
    getUmweltBridge().call(this.file, 'world.ensure', {
      project: { id: STORY_PROJECT, name: 'Story', timescale: 'turn', vocabularyMode: 'open' },
      entityTypes: ENTITY_TYPES,
      entities,
      axes: [{ id: STORY_AXIS, label: 'Story time (minutes)' }]
    });
  }

  private prepare(): void {
    if (this.ready) return;
    this.ensureWorld([]);
    this.ready = true;
  }
}
