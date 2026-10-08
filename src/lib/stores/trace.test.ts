import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { FakeChain, serveChain } from '../testing/fakeChain';
import { isChainSearchAnswer } from '../utils/chainSearch';
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

describe('the route of a search', () => {
  afterEach(() => {
    trace.clear();
    commandLog.clear();
    vi.unstubAllGlobals();
  });

  /** global 1-3 in app.log.1, 4-5 in the active file. */
  function serveAppLog(): FakeChain {
    const chain = new FakeChain({
      name: 'app.log',
      parts: [
        { name: 'app.log.1', lines: 3 },
        { name: 'app.log', lines: 2, isActive: true },
      ],
    });
    serveChain(chain);
    return chain;
  }

  it('asks /v1/trace for a search outside chain mode', async () => {
    const chain = serveAppLog();

    await trace.search(['/l'], ['LINE 4 '], { maxResults: 10 });

    expect(chain.requests).toEqual(['/v1/trace?path=%2Fl&regexp=LINE+4+&max_results=10']);
  });

  it('asks /v1/logs/trace with the same paths, patterns and cap for a chain search', async () => {
    const chain = serveAppLog();

    await trace.searchChains(['/l'], ['LINE 4 '], { maxResults: 10 });

    expect(chain.requests).toEqual(['/v1/logs/trace?path=%2Fl&regexp=LINE+4+&max_results=10']);
  });

  it("keeps a chain search's answer with its chains, and records its command", async () => {
    serveAppLog();

    await trace.searchChains(['/l'], ['LINE 4 ']);

    const { response } = get(trace);
    if (!response || !isChainSearchAnswer(response)) throw new Error('no chain search answer');
    expect(response.chains.c1.path).toBe('/l/app.log');
    expect(response.matches.map((m) => [response.files[m.file], m.absolute_line_number])).toEqual([
      ['/l/app.log', 1],
    ]);
    expect(response.matches[0].chain_line).toBe(4);
    expect(get(commandLog)[0]).toMatchObject({
      command: 'rx logs trace /l --regexp=LINE 4 ',
      action: 'search',
    });
  });

  it('lets a chain search supersede a search still running', async () => {
    serveAppLog();

    const first = trace.search(['/l'], ['LINE 1 ']);
    const second = trace.searchChains(['/l'], ['LINE 4 ']);

    expect(await first).toBeNull();
    expect(await second).not.toBeNull();
    expect(get(trace).response?.matches).toHaveLength(1);
  });
});
