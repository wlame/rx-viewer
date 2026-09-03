/**
 * The HTTP wire contract this build of the viewer was written against.
 *
 * Both backends report their own version from `GET /health` as
 * `MAJOR.MINOR`:
 *
 * - A higher MINOR is fine. The backend has fields or endpoints this
 *   viewer does not use, which is what additive means.
 * - A different MAJOR is not. A rename, a removal or a changed meaning
 *   would make this viewer misread the data, so it refuses to run rather
 *   than showing something wrong.
 *
 * Bump this together with the backends' constants
 * (`rx-go/internal/webapi/contract.go`, `rx-python/src/rx/contract.py`).
 */
export const SUPPORTED_CONTRACT_MAJOR = 1;

/** What the viewer decided about a backend's contract version. */
export type ContractCompatibility =
  | { kind: 'ok'; major: number; minor: number }
  | { kind: 'unknown' }
  | { kind: 'incompatible'; major: number; minor: number; message: string };

/**
 * Decide whether this viewer can talk to a backend reporting `version`.
 *
 * An absent or unparseable version is `unknown` rather than
 * `incompatible`: a backend released before `contract_version` existed
 * still speaks contract 1, and refusing to load against it would be worse
 * than proceeding.
 */
export function checkContractVersion(version: string | null | undefined): ContractCompatibility {
  if (!version) return { kind: 'unknown' };

  const match = /^(\d+)\.(\d+)$/.exec(version.trim());
  if (!match) return { kind: 'unknown' };

  const major = Number(match[1]);
  const minor = Number(match[2]);

  if (major === SUPPORTED_CONTRACT_MAJOR) {
    return { kind: 'ok', major, minor };
  }
  return {
    kind: 'incompatible',
    major,
    minor,
    message:
      `This viewer speaks rx API contract ${SUPPORTED_CONTRACT_MAJOR}.x, ` +
      `but the backend reports ${version}. ` +
      (major > SUPPORTED_CONTRACT_MAJOR
        ? 'Update the viewer to match the backend.'
        : 'Update the backend, or use a viewer release from its era.'),
  };
}
