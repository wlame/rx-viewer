import { describe, it, expect } from 'vitest';
import { parseSandboxError, describeSandboxError } from './sandboxError';

// Both backends answer a path outside the search roots with the same
// five-field body, so the panel is built once and rendered the same way
// whichever backend served the request.
const goBody = JSON.stringify({
  detail: 'path_outside_search_root',
  error: 'path_outside_search_root',
  message: 'path "/outside/x.log" is not within any configured --search-root',
  path: '/outside/x.log',
  roots: ['/srv/data', '/var/log'],
});

const pythonBody = JSON.stringify({
  detail: 'path_outside_search_root',
  error: 'path_outside_search_root',
  message: 'path "/outside/x.log" is not within any configured --search-root',
  path: '/outside/x.log',
  roots: ['/srv/data', '/var/log'],
});

describe('parseSandboxError', () => {
  it('reads the sandbox body from either backend', () => {
    expect(parseSandboxError(goBody)).toEqual(parseSandboxError(pythonBody));
    expect(parseSandboxError(goBody)).toEqual({
      detail: 'path_outside_search_root',
      error: 'path_outside_search_root',
      message: 'path "/outside/x.log" is not within any configured --search-root',
      path: '/outside/x.log',
      roots: ['/srv/data', '/var/log'],
    });
  });

  it('returns null for an ordinary error envelope', () => {
    expect(parseSandboxError(JSON.stringify({ detail: 'File not found' }))).toBeNull();
  });

  it('returns null for a refusal that is not the sandbox', () => {
    const hidden = JSON.stringify({
      detail: "Access denied: path '/var/log/.ssh/id_rsa' contains hidden component '.ssh'",
    });
    expect(parseSandboxError(hidden)).toBeNull();
  });

  it('returns null for a body that is not JSON', () => {
    expect(parseSandboxError('<html>502 Bad Gateway</html>')).toBeNull();
  });

  it('rejects a body whose roots are not strings', () => {
    const wrong = JSON.stringify({
      detail: 'path_outside_search_root',
      error: 'path_outside_search_root',
      message: 'x',
      path: '/x',
      roots: [1, 2],
    });
    expect(parseSandboxError(wrong)).toBeNull();
  });
});

describe('describeSandboxError', () => {
  it('names the path and the roots that would have been accepted', () => {
    const parsed = parseSandboxError(goBody)!;
    expect(describeSandboxError(parsed)).toBe(
      '/outside/x.log is outside the search roots this server was started with. ' +
        'Allowed: /srv/data, /var/log',
    );
  });

  it('says so plainly when no root is configured', () => {
    const parsed = parseSandboxError(
      JSON.stringify({
        detail: 'path_outside_search_root',
        error: 'path_outside_search_root',
        message: 'path "/x" is not within any configured --search-root',
        path: '/x',
        roots: [],
      }),
    )!;
    expect(describeSandboxError(parsed)).toBe(
      '/x is outside the search roots this server was started with. ' +
        'No search root is configured.',
    );
  });

  it('produces the same sentence from either backend', () => {
    expect(describeSandboxError(parseSandboxError(goBody)!)).toBe(
      describeSandboxError(parseSandboxError(pythonBody)!),
    );
  });
});
