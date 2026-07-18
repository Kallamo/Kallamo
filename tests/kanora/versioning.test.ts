import { describe, expect, test } from 'vitest';
import { KANORA_COMPATIBILITY_POLICY, getContractCompatibility, isSupportedContractVersion } from '../../src/kanora/versioning';

describe('Contract v1 compatibility', () => {
  test('accepts the frozen Contract v1 version', () => {
    expect(getContractCompatibility('1.0')).toBe('compatible');
    expect(isSupportedContractVersion('1.0')).toBe(true);
  });

  test('publishes immutable exact-version compatibility rules', () => {
    expect(KANORA_COMPATIBILITY_POLICY).toEqual({
      versionFormat: 'major.minor',
      acceptance: 'exact-version',
      additiveChangesRequire: 'minor-version',
      breakingChangesRequire: 'major-version',
      releasedVersionsAreImmutable: true
    });
  });

  test.each(['1.1', '2.0', '0.9'])('rejects an unimplemented version: %s', version => {
    expect(getContractCompatibility(version)).toBe('unsupported');
    expect(isSupportedContractVersion(version)).toBe(false);
  });

  test.each([undefined, null, 1, 'v1', '1'])('rejects a malformed version: %s', version => {
    expect(getContractCompatibility(version)).toBe('invalid');
  });
});
