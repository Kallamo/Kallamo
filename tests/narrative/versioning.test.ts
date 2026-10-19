import { describe, expect, test } from 'vitest';
import { getContractCompatibility, isSupportedContractVersion } from '../../src/narrative/versioning';

describe('Contract v1 compatibility', () => {
  test('accepts the current draft Contract v1 version', () => {
    expect(getContractCompatibility('1.0')).toBe('compatible');
    expect(isSupportedContractVersion('1.0')).toBe(true);
  });

  test.each(['1.1', '2.0', '0.9'])('rejects an unimplemented version: %s', version => {
    expect(getContractCompatibility(version)).toBe('unsupported');
    expect(isSupportedContractVersion(version)).toBe(false);
  });

  test.each([undefined, null, 1, 'v1', '1'])('rejects a malformed version: %s', version => {
    expect(getContractCompatibility(version)).toBe('invalid');
  });
});
