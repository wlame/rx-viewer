import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { files } from './files';
import { trace } from './trace';

const MATCH = { lineNumber: 5, patternId: 'p1', pattern: 'ERROR' };

/**
 * The match highlights in the editor belong to one search. A new search
 * must not leave the previous one's lines marked in any file.
 */
describe('trace search and match highlights', () => {
  beforeEach(() => {
    // The search never answers: clearing has to happen when it starts.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    files.setMatches('/var/log/a.log', [MATCH]);
    files.setMatches('/var/log/b.log', [MATCH]);
  });

  afterEach(() => {
    trace.clear();
    vi.unstubAllGlobals();
  });

  it('clears the previous search highlights when a new search starts', () => {
    void trace.search(['/var/log'], ['WARN']);

    expect(get(files).matches.size).toBe(0);
  });

  it('clears the highlights when the search is cleared', () => {
    trace.clear();

    expect(get(files).matches.size).toBe(0);
  });
});
