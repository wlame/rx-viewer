/**
 * Render a version string the way a git tag is written.
 *
 * `dist/version.json` is produced by the build recipe from
 * `git describe --tags`, so the value normally already starts with "v".
 * Templates that prepend their own "v" turn `v0.2.0` into `vv0.2.0`,
 * which also breaks the release URL built from the same value.
 *
 * The prefix is added only to something that already looks like a
 * version number. A backend that has not been built from a tag reports
 * `dev`, and `git describe --always` can fall back to a bare commit, and
 * neither is improved by calling it `vdev`.
 */
export function formatVersionTag(version: string): string {
  const trimmed = version.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('v')) return trimmed;
  return /^\d/.test(trimmed) ? `v${trimmed}` : trimmed;
}
