import { NARRATIVE_CONTRACT_VERSION, type NarrativeContractVersion } from './contracts';

export type ContractCompatibility = 'compatible' | 'unsupported' | 'invalid';

export const NARRATIVE_COMPATIBILITY_POLICY = {
  releaseStatus: 'draft',
  versionFormat: 'major.minor',
  acceptance: 'exact-version',
  additiveChangesRequire: 'minor-version',
  breakingChangesRequire: 'major-version',
  releasedVersionsAreImmutable: true,
  compatibilityGuaranteedAfter: 'first-public-release'
} as const;

const VERSION_PATTERN = /^(\d+)\.(\d+)$/;

export function getContractCompatibility(version: unknown): ContractCompatibility {
  if (typeof version !== 'string' || !VERSION_PATTERN.test(version)) return 'invalid';
  return version === NARRATIVE_CONTRACT_VERSION ? 'compatible' : 'unsupported';
}

export function isSupportedContractVersion(version: unknown): version is NarrativeContractVersion {
  return getContractCompatibility(version) === 'compatible';
}
