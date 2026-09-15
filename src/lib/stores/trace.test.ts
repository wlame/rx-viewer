import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { commandLog } from './commands';
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

describe('the equivalent command of a search', () => {
  afterEach(() => {
    trace.clear();
    commandLog.clear();
    vi.unstubAllGlobals();
  });

  function answerWith(cliCommand: string | null) {
    const body = { cli_command: cliCommand, matches: [], files: {}, patterns: {}, time: 0.1 };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body }),
    );
  }

  it('records the command the answer carries', async () => {
    answerWith('rx trace /var/log --regexp=WARN --max-results=100');
    await trace.search(['/var/log'], ['WARN']);
    expect(get(commandLog)[0]).toMatchObject({
      command: 'rx trace /var/log --regexp=WARN --max-results=100',
      action: 'search',
    });
  });

  it('records nothing for an answer without a command', async () => {
    answerWith(null);
    await trace.search(['/var/log'], ['WARN']);
    expect(get(commandLog)).toEqual([]);
  });
});
