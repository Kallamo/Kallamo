import { KANORA_CONTRACT_VERSION, type KanoraContractVersion } from './contracts';

export type ContractCompatibility = 'compatible' | 'unsupported' | 'invalid';

export const KANORA_COMPATIBILITY_POLICY = {
  versionFormat: 'major.minor',
  acceptance: 'exact-version',
  additiveChangesRequire: 'minor-version',
  breakingChangesRequire: 'major-version',
  releasedVersionsAreImmutable: true
} as const;

const VERSION_PATTERN = /^(\d+)\.(\d+)$/;

export function getContractCompatibility(version: unknown): ContractCompatibility {
  if (typeof version !== 'string' || !VERSION_PATTERN.test(version)) return 'invalid';
  return version === KANORA_CONTRACT_VERSION ? 'compatible' : 'unsupported';
}

export function isSupportedContractVersion(version: unknown): version is KanoraContractVersion {
  return getContractCompatibility(version) === 'compatible';
}
