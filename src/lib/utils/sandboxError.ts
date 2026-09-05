import type { ParsedSandboxError } from '../types';

/**
 * The machine code both backends put in a sandbox refusal's `error` and
 * `detail`. Branch on this rather than on the sentence, which is meant
 * for a person.
 */
export const SANDBOX_ERROR_CODE = 'path_outside_search_root';

/**
 * Read a 403 body as a sandbox refusal, or return null when it is
 * something else.
 *
 * Both backends answer a path outside every `--search-root` with the same
 * five fields, so one panel covers both. Every other 403 — a hidden entry,
 * a directory the process cannot read — keeps the ordinary `{detail}`
 * envelope and belongs in the ordinary error path, because the fix for it
 * is different: `--hidden`, or file permissions, not a different root.
 */
export function parseSandboxError(body: string): ParsedSandboxError | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    // A proxy's HTML page, or a truncated response. Not ours.
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const { detail, error, message, path, roots } = parsed as Record<string, unknown>;
  if (error !== SANDBOX_ERROR_CODE) return null;
  if (typeof detail !== 'string' || typeof message !== 'string' || typeof path !== 'string') {
    return null;
  }
  if (!Array.isArray(roots) || roots.some((root) => typeof root !== 'string')) return null;

  return { detail, error, message, path, roots: roots as string[] };
}

/**
 * The sentence to show for a sandbox refusal.
 *
 * The backend's own `message` names the flag rather than what the reader
 * can do about it, so this names the path that was refused and lists the
 * roots that would have been accepted instead.
 */
export function describeSandboxError(sandbox: ParsedSandboxError): string {
  const allowed =
    sandbox.roots.length > 0
      ? `Allowed: ${sandbox.roots.join(', ')}`
      : 'No search root is configured.';
  return `${sandbox.path} is outside the search roots this server was started with. ${allowed}`;
}
