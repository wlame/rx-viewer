import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { chainMode } from './stores/chainMode';
import { files } from './stores/files';
import { health } from './stores/health';
import { notifications } from './stores/notifications';
import { trace } from './stores/trace';
import { FakeChain, serveChain, type FakePart } from './testing/fakeChain';
import { openChainAt, openFileAtLine, openTreeFile } from './fileOpening';
import {
  chainMatchedLines,
  chainPlaceOf,
  chainPositionOf,
  chainTabMatches,
  isChainSearchAnswer,
} from './utils/chainSearch';
import { chainKey } from './utils/tabKey';
import type { ChainTraceResponse, OpenFile, TreeNode } from './types';

/** A file entry as the tree lists it. */
function treeFile(path: string, fields: Partial<TreeNode> = {}): TreeNode {
  return {
    path,
    name: path.split('/').pop() ?? path,
    type: 'file',
    children_count: null,
    compression_format: null,
    is_compressed: false,
    is_indexed: false,
    is_text: true,
    line_count: null,
    modified_at: null,
    size: 100,
    size_human: null,
    level: 1,
    expanded: false,
    loading: false,
    children: [],
    ...fields,
  };
}

/** The part of a `fetch` response the API client reads. */
interface FakeResponse {
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}

/** Answers every request with a seven-line sample; counts the requests. */
function serveSamples() {
  const spy = vi.fn(async (url: string): Promise<FakeResponse> => {
    const lines = new URL(url, 'http://localhost').searchParams.get('lines') ?? '1-7';
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        path: '',
        samples: { [lines]: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] },
        before_context: 0,
        after_context: 0,
        lines: {},
        offsets: {},
        is_compressed: false,
        compression_format: null,
        cli_command: null,
      }),
      text: async () => '',
    };
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

describe('openTreeFile', () => {
  afterEach(() => {
    for (const file of get(files).openFiles) files.closeFile(file.path);
    for (const shown of get(notifications)) notifications.dismiss(shown.id);
    vi.unstubAllGlobals();
  });

  // rx-go answers a binary file's bytes as lines; the tree's is_text is
  // what says the file is not text.
  it('does not open a file the tree marks as not text, and says why', async () => {
    const fetchSpy = serveSamples();

    await openTreeFile(treeFile('/logs/core.bin', { is_text: false }));

    expect(get(files).openFiles).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(get(notifications).map((n) => [n.type, n.message])).toEqual([
      ['error', 'Cannot open binary file: core.bin'],
    ]);
  });

  it('opens a text file with what the tree knows about it', async () => {
    serveSamples();

    await openTreeFile(treeFile('/logs/app.log', { size: 5 * 1024 * 1024, line_count: 7 }));

    const opened = get(files).openFiles.find((f) => f.path === '/logs/app.log');
    expect(opened?.fileSize).toBe(5 * 1024 * 1024);
    expect(opened?.syntaxHighlighting).toBe(false);
    expect(opened?.totalLines).toBe(7);
  });

  it('asks the first 5,000 lines of a gzip file the tree lists', async () => {
    const fetchSpy = serveSamples();

    await openTreeFile(
      treeFile('/logs/app.log.gz', { is_compressed: true, compression_format: 'gzip' }),
    );

    const asked = new URL(fetchSpy.mock.calls[0][0], 'http://localhost').searchParams;
    expect(asked.get('lines')).toBe('1-5000');
  });
});

/**
 * Answers `/v1/tree` for `/logs` with `entries`, and every other request
 * with a seven-line sample.
 */
function serveDirectory(entries: TreeNode[]) {
  const samples = serveSamples();
  const spy = vi.fn(async (url: string): Promise<FakeResponse> => {
    if (!url.startsWith('/v1/tree')) return samples(url);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        path: '/logs',
        parent: null,
        is_search_root: true,
        entries,
        total_entries: entries.length,
        total_size: null,
        total_size_human: null,
      }),
      text: async () => '',
    };
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

describe('openFileAtLine', () => {
  afterEach(() => {
    for (const file of get(files).openFiles) files.closeFile(file.path);
    vi.unstubAllGlobals();
  });

  // A search result names a path only; without its size the file would
  // open with highlighting whatever its size.
  it('opens a large file from a search result without highlighting', async () => {
    serveDirectory([treeFile('/logs/big.log', { size: 5 * 1024 * 1024 })]);

    await openFileAtLine('/logs/big.log', 3);

    const opened = get(files).openFiles.find((f) => f.path === '/logs/big.log');
    expect(opened?.fileSize).toBe(5 * 1024 * 1024);
    expect(opened?.syntaxHighlighting).toBe(false);
  });

  it('opens a file the listing does not name with the unknown-size default', async () => {
    serveDirectory([]);

    await openFileAtLine('/logs/gone.log', 3);

    const opened = get(files).openFiles.find((f) => f.path === '/logs/gone.log');
    expect(opened?.fileSize).toBeNull();
    expect(opened?.syntaxHighlighting).toBe(true);
  });

  it('moves an open file to the line without asking for the listing', async () => {
    const fetchSpy = serveDirectory([treeFile('/logs/big.log', { size: 5 * 1024 * 1024 })]);
    await openFileAtLine('/logs/big.log', 3);
    const treeRequests = () => fetchSpy.mock.calls.filter(([url]) => url.startsWith('/v1/tree'));
    const before = treeRequests().length;

    await openFileAtLine('/logs/big.log', 5);

    expect(treeRequests().length).toBe(before);
    expect(get(files).openFiles.find((f) => f.path === '/logs/big.log')?.anchorLine).toBe(5);
  });
});

describe('openChainAt', () => {
  /** global 1-3000 in a gzip part, 3001-4500 in a plain one, 4501-6500 in the active file. */
  const PARTS: FakePart[] = [
    { name: 'app.log.2.gz', lines: 3000, compression: 'gzip' },
    { name: 'app.log.1', lines: 1500 },
    { name: 'app.log', lines: 2000, isActive: true },
  ];
  const KEY = chainKey('/l/app.log');
  /** Line 500 of app.log.1, global line 3500, and line 7 of the active file, global 4507. */
  const PATTERN = 'part=app\\.log(\\.1 local=500| local=7)$';

  async function serve(state: 'ready' | 'pending'): Promise<FakeChain> {
    const chain = new FakeChain({ name: 'app.log', parts: PARTS, state });
    serveChain(chain);
    await health.check();
    chainMode.set(true);
    return chain;
  }

  async function searchChain(): Promise<ChainTraceResponse> {
    const answer = await trace.searchChains(['/l/app.log'], [PATTERN]);
    if (!answer || !isChainSearchAnswer(answer)) throw new Error('no chain search answer');
    return answer;
  }

  /** Open the chain's tab at the first match of `answer`, marking every match, as a click does. */
  async function openFirstMatch(answer: ChainTraceResponse): Promise<void> {
    const match = answer.matches[0];
    const place = chainPlaceOf(match, answer);
    if (!place) throw new Error('the match is in no chain');
    const marks = chainTabMatches(answer, place.handle, (m) => m.absolute_line_number);
    await openChainAt(place.handle, chainPositionOf(place, match.absolute_line_number), marks);
  }

  function tab(): OpenFile {
    const found = get(files).openFiles.find((f) => f.path === KEY);
    if (!found) throw new Error('the chain tab is not open');
    return found;
  }

  /** The texts of the held lines the search marks. */
  function markedTexts(): string[] {
    const held = tab();
    const marks = get(files).matches.get(KEY) ?? [];
    return chainMatchedLines(held.lines, marks).map(
      (position) => held.lines[position - held.startLine].content,
    );
  }

  afterEach(() => {
    for (const file of get(files).openFiles) files.closeFile(file.path);
    for (const shown of get(notifications)) notifications.dismiss(shown.id);
    trace.clear();
    chainMode.set(false);
    vi.unstubAllGlobals();
  });

  it("opens a ready chain's tab at the match's global line and marks the matched lines", async () => {
    await serve('ready');
    const answer = await searchChain();
    expect(answer.matches.map((m) => m.chain_line)).toEqual([3500, 4507]);

    await openFirstMatch(answer);

    expect(tab().chain?.numbering).toBe('global');
    expect(tab().anchorLine).toBe(3500);
    expect(tab().scrollToLine).toBe(3500);
    expect(tab().lines[3500 - tab().startLine].content).toContain(
      'LINE 3500 part=app.log.1 local=500',
    );
    expect(tab().chain?.anchor).toMatchObject({ part: 'app.log.1', line: 500 });
    expect(get(files).matches.get(KEY)).toEqual([
      { lineNumber: 500, part: 'app.log.1', patternId: 'p1', pattern: PATTERN },
      { lineNumber: 7, part: 'app.log', patternId: 'p1', pattern: PATTERN },
    ]);
    // The window around 3500 holds 3400-3600: the second match is not held.
    expect(markedTexts()).toEqual([expect.stringContaining('LINE 3500 part=app.log.1 local=500')]);
  });

  it("opens a pending chain's tab at the part's own line, and keeps the mark on it once ready", async () => {
    const chain = await serve('pending');
    const answer = await searchChain();
    expect(answer.matches.map((m) => m.chain_line)).toEqual([-1, -1]);

    await openFirstMatch(answer);

    expect(tab().chain?.numbering).toBe('local');
    expect(tab().chain?.anchor).toMatchObject({ part: 'app.log.1', line: 500 });
    expect(tab().lines[tab().anchorLine - tab().startLine].content).toContain(
      'part=app.log.1 local=500',
    );
    expect(markedTexts()).toContainEqual(
      expect.stringContaining('LINE 3500 part=app.log.1 local=500'),
    );

    chain.finishTask();
    await vi.waitFor(() => expect(tab().chain?.numbering).toBe('global'));
    await vi.waitFor(() => expect(tab().loading).toBe(false));

    expect(tab().anchorLine).toBe(3500);
    expect(markedTexts()).toContainEqual(
      expect.stringContaining('LINE 3500 part=app.log.1 local=500'),
    );
  });

  it('moves an open chain tab to the next match, in the same tab', async () => {
    await serve('ready');
    const answer = await searchChain();
    await openFirstMatch(answer);

    const second = answer.matches[1];
    const place = chainPlaceOf(second, answer);
    if (!place) throw new Error('the match is in no chain');
    await openChainAt(place.handle, chainPositionOf(place, second.absolute_line_number), []);

    expect(get(files).openFiles.filter((f) => f.path === KEY)).toHaveLength(1);
    expect(tab().anchorLine).toBe(4507);
    expect(tab().chain?.anchor).toMatchObject({ part: 'app.log', line: 7 });
    expect(tab().lines[4507 - tab().startLine].content).toContain('LINE 4507 part=app.log local=7');
  });
});
