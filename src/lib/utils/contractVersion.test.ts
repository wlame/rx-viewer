import { describe, expect, it } from 'vitest';

import { checkContractVersion, SUPPORTED_CONTRACT_MAJOR } from './contractVersion';

describe('checkContractVersion', () => {
  it('accepts the contract major this viewer was built against', () => {
    expect(checkContractVersion(`${SUPPORTED_CONTRACT_MAJOR}.0`)).toEqual({
      kind: 'ok',
      major: SUPPORTED_CONTRACT_MAJOR,
      minor: 0,
    });
  });

  it('accepts a higher minor, because additive changes do not break a client', () => {
    expect(checkContractVersion(`${SUPPORTED_CONTRACT_MAJOR}.7`)).toEqual({
      kind: 'ok',
      major: SUPPORTED_CONTRACT_MAJOR,
      minor: 7,
    });
  });

  it('refuses a newer major and says to update the viewer', () => {
    const result = checkContractVersion(`${SUPPORTED_CONTRACT_MAJOR + 1}.0`);

    expect(result.kind).toBe('incompatible');
    if (result.kind !== 'incompatible') return;
    expect(result.message).toContain('Update the viewer');
  });

  it('refuses an older major and says to update the backend', () => {
    const result = checkContractVersion('0.9');

    expect(result.kind).toBe('incompatible');
    if (result.kind !== 'incompatible') return;
    expect(result.message).toContain('Update the backend');
  });

  it('treats a missing version as unknown, not incompatible', () => {
    // A backend released before contract_version existed still speaks
    // contract 1; refusing to load would be worse than proceeding.
    expect(checkContractVersion(undefined)).toEqual({ kind: 'unknown' });
    expect(checkContractVersion(null)).toEqual({ kind: 'unknown' });
    expect(checkContractVersion('')).toEqual({ kind: 'unknown' });
  });

  it('treats an unparseable version as unknown', () => {
    for (const bad of ['1', '1.2.3', 'v1.0', 'one.zero', '1.x']) {
      expect(checkContractVersion(bad)).toEqual({ kind: 'unknown' });
    }
  });

  it('tolerates surrounding whitespace', () => {
    expect(checkContractVersion(` ${SUPPORTED_CONTRACT_MAJOR}.2 `).kind).toBe('ok');
  });
});
