import type Database from 'better-sqlite3';
import {
  SubjectKnowledgeRepository,
  type SubjectKnowledgeRecord
} from './individual-knowledge';
import {
  NarrativeMemoryRepository,
  type NarrativeMemoryRecord
} from './narrative-memory';
import {
  BeliefRepository,
  type BeliefProjectionRecord
} from './perspective-state';

export interface SubjectKnowledgeProjection {
  projectId: string;
  subjectId: string;
  known: SubjectKnowledgeRecord[];
  beliefs: BeliefProjectionRecord[];
  memories: NarrativeMemoryRecord[];
}

export interface SubjectKnowledgeProjectionOptions {
  accessibleOnly?: boolean;
  throughSequence?: number;
}

export class SubjectKnowledgeProjectionRepository {
  private readonly knowledge: SubjectKnowledgeRepository;
  private readonly beliefs: BeliefRepository;
  private readonly memories: NarrativeMemoryRepository;

  constructor(db: Database.Database) {
    this.knowledge = new SubjectKnowledgeRepository(db);
    this.beliefs = new BeliefRepository(db);
    this.memories = new NarrativeMemoryRepository(db);
  }

  get(
    projectId: string,
    subjectId: string,
    options: SubjectKnowledgeProjectionOptions = {}
  ): SubjectKnowledgeProjection {
    return {
      projectId,
      subjectId,
      known: this.knowledge.listCurrentForSubject(projectId, subjectId, options),
      beliefs: this.beliefs.listCurrentForSubject(projectId, subjectId, options),
      memories: this.memories.listCurrentForSubject(projectId, subjectId, options)
    };
  }
}
