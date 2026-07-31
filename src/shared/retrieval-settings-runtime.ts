import contract from './retrieval-settings.json';

type RetrievalDefinition = {
  defaultValue: number;
  min: number;
  max: number;
  step: number;
  legacyKey?: string;
};

export type NormalizedRetrievalSettings = {
  profileKnowledgeTopK: number;
  workspaceDocumentsTopK: number;
  longTermMemoryTopK: number;
  worldbuildEntityLimit: number;
  retrievalStrictness: number;
  worldbuildBreadth: 'focused' | 'balanced' | 'broad';
};

function clampNumber(value: unknown, definition: RetrievalDefinition): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return definition.defaultValue;
  const clamped = Math.min(definition.max, Math.max(definition.min, parsed));
  const steps = Math.round((clamped - definition.min) / definition.step);
  return Number((definition.min + steps * definition.step).toFixed(4));
}

export function normalizeRetrievalSettings(
  advanced: Record<string, unknown> = {}
): NormalizedRetrievalSettings {
  const normalized = Object.fromEntries(
    Object.entries(contract.definitions).map(([key, rawDefinition]) => {
      const definition: RetrievalDefinition = rawDefinition;
      return [
        key,
        clampNumber(
          advanced[key] ?? (definition.legacyKey ? advanced[definition.legacyKey] : undefined),
          definition
        )
      ];
    })
  ) as Omit<NormalizedRetrievalSettings, 'worldbuildBreadth'>;
  const breadth = String(advanced.worldbuildBreadth ?? '');
  return {
    ...normalized,
    worldbuildBreadth: contract.worldbuildBreadthValues.includes(breadth)
      ? breadth as NormalizedRetrievalSettings['worldbuildBreadth']
      : contract.defaultWorldbuildBreadth as NormalizedRetrievalSettings['worldbuildBreadth']
  };
}
