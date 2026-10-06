import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { LINES_PER_PAGE, STREAM_LINES_PER_PAGE, maxHeldLines } from '../utils/slidingWindow';
import { stashEntryState } from '../utils/timeStash';
import { contractGate } from '../contractGate';
import { commandLog } from './commands';
import { fileZones } from './fileZones';
import { files } from './files';
import { health } from './health';
import { notifications } from './notifications';
import { timeCursor } from './timeCursor';
import { tree } from './tree';

/** The store reads no URL; a stub keeps any stray write off the real one. */
function setLocation(search: string) {
  vi.stubGlobal('window', {
    location: { href: `http://localhost:5173/${search}`, search },
    history: {
      replaceState: (_state: unknown, _title: string, next: string) => {
        const parsed = new URL(next);
        (window as unknown as { location: { href: string; search: string } }).location = {
          href: parsed.toString(),
          search: parsed.search,
        };
      },
    },
  });
}

/**
 * Answers `/v1/samples` the way rx-go does for a file of `lineCount`
 * lines that each read `LINE <n>`: a range holds the lines it covers, a
 * line holds the lines within its context, each clamped at line 1 and at
 * the end of the file, and a window with no line of the file is null.
 * `-1` is the last line, and the answer is keyed by that line. The
 * requested context is echoed back unchanged.
 */
function serveFileOf(lineCount: number, { withCommand = false, compressed = false } = {}) {
  const spy = vi.fn(async (url: string) => {
    const params = new URL(url, 'http://localhost').searchParams;
    const lines = params.get('lines') ?? '';
    const context = Number(params.get('context') ?? 3);

    let key = lines;
    let first: number;
    let last: number;
    const range = /^(\d+)-(\d+)$/.exec(lines);
    if (range) {
      first = Number(range[1]);
      last = Number(range[2]);
    } else {
      const line = lines === '-1' ? Math.max(1, lineCount) : Number(lines);
      key = String(line);
      first = Math.max(1, line - context);
      last = line + context;
    }

    const content: string[] = [];
    for (let n = first; n <= Math.min(last, lineCount); n++) content.push(`LINE ${n}`);

    const body = {
      path: params.get('path'),
      samples: { [key]: content.length > 0 ? content : null },
      before_context: context,
      after_context: context,
      lines: {},
      offsets: {},
      is_compressed: compressed,
      compression_format: compressed ? 'gzip' : null,
      cli_command: withCommand ? `rx samples ${params.get('path')} --lines=${lines}` : null,
    };
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => body,
      text: async () => '',
    };
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

function openedFile(path: string) {
  const file = get(files).openFiles.find((f) => f.path === path);
  if (!file) throw new Error(`${path} is not open`);
  return file;
}

function lineNumbers(path: string): number[] {
  return openedFile(path).lines.map((l) => l.lineNumber);
}

function everyLineReadsItsNumber(path: string): boolean {
  return openedFile(path).lines.every((l) => l.content === `LINE ${l.lineNumber}`);
}

describe('the file window against samples answers', () => {
  beforeEach(() => setLocation(''));

  afterEach(() => {
    for (const file of get(files).openFiles) files.closeFile(file.path);
    vi.unstubAllGlobals();
  });

  it('stops paging at a null sample past the end', async () => {
    const fetchSpy = serveFileOf(1000);
    await files.openFile('/logs/thousand.log', { isIndexed: false });
    expect(openedFile('/logs/thousand.log').reachedEnd).toBe(false);

    await files.loadMore('/logs/thousand.log', 'after');
    const callsAtTheEnd = fetchSpy.mock.calls.length;
    await files.loadMore('/logs/thousand.log', 'after');

    const file = openedFile('/logs/thousand.log');
    expect(file.error).toBeNull();
    expect(file.reachedEnd).toBe(true);
    expect(file.endLine).toBe(1000);
    expect(file.totalLines).toBe(1000);
    expect(fetchSpy.mock.calls.length).toBe(callsAtTheEnd);
  });

  it('opens an empty file with no lines and does not page', async () => {
    const fetchSpy = serveFileOf(0);
    await files.openFile('/logs/empty.log', { isIndexed: false });
    await files.loadMore('/logs/empty.log', 'after');

    const file = openedFile('/logs/empty.log');
    expect(file.error).toBeNull();
    expect(file.lines).toEqual([]);
    expect(file.reachedEnd).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it.each([
    { lineCount: 7, first: 1 },
    { lineCount: 300, first: 200 },
    { lineCount: 10_000, first: 9_900 },
  ])(
    'jumps to the end of a $lineCount-line file from line $first',
    async ({ lineCount, first }) => {
      serveFileOf(lineCount);
      const path = `/logs/lines-${lineCount}.log`;
      await files.openFile(path, { isIndexed: false });

      await files.jumpToEnd(path);

      const numbers = lineNumbers(path);
      expect(numbers[0]).toBe(first);
      expect(numbers.at(-1)).toBe(lineCount);
      expect(numbers).toHaveLength(lineCount - first + 1);
      expect(everyLineReadsItsNumber(path)).toBe(true);
      expect(openedFile(path).totalLines).toBe(lineCount);
    },
  );

  it('shows the end of the file for a line far past it', async () => {
    serveFileOf(7);
    await files.openFile('/logs/seven.log', { scrollToLine: 100_000, isIndexed: false });

    const file = openedFile('/logs/seven.log');
    expect(file.error).toBeNull();
    expect(lineNumbers('/logs/seven.log')).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(file.scrollToLine).toBe(7);
  });

  it('pages down again after a jump from the end back into the middle', async () => {
    serveFileOf(10_000);
    await files.openFile('/logs/long.log', { isIndexed: false });
    await files.jumpToEnd('/logs/long.log');

    await files.jumpToLine('/logs/long.log', 5_000);

    const file = openedFile('/logs/long.log');
    expect(file.startLine).toBe(4_900);
    expect(file.endLine).toBe(5_100);
    expect(file.reachedEnd).toBe(false);
    expect(everyLineReadsItsNumber('/logs/long.log')).toBe(true);
  });
});

/**
 * An open file holds a window of at most `maxHeldLines` lines: paging
 * one way drops the lines at the other end, and paging back loads them
 * again. The default page is 1,000 lines, so the cap is 5,000.
 */
describe('the held window while paging', () => {
  const path = '/logs/long.log';
  const cap = maxHeldLines(LINES_PER_PAGE);

  beforeEach(() => setLocation(''));

  afterEach(() => {
    for (const file of get(files).openFiles) files.closeFile(file.path);
    vi.unstubAllGlobals();
  });

  async function page(direction: 'before' | 'after', times: number) {
    for (let i = 0; i < times; i++) await files.loadMore(path, direction);
  }

  it('holds at most the cap after paging forward 50 times', async () => {
    serveFileOf(100_000);
    await files.openFile(path, { isIndexed: false });

    await page('after', 50);

    const file = openedFile(path);
    expect(file.lines.length).toBe(cap);
    expect(file.endLine).toBe(51_000);
    expect(file.startLine).toBe(51_000 - cap + 1);
    expect(file.reachedStart).toBe(false);
    expect(file.reachedEnd).toBe(false);
    expect(everyLineReadsItsNumber(path)).toBe(true);
  });

  it('reloads the dropped pages when paging back, with their numbers', async () => {
    serveFileOf(100_000);
    await files.openFile(path, { isIndexed: false });
    await page('after', 50);

    await page('before', 10);

    const file = openedFile(path);
    expect(file.lines.length).toBe(cap);
    expect(file.startLine).toBe(51_000 - cap + 1 - 10_000);
    expect(file.endLine).toBe(file.startLine + cap - 1);
    expect(everyLineReadsItsNumber(path)).toBe(true);
    // The pages after the window were dropped, so paging forward goes on.
    expect(file.reachedEnd).toBe(false);
  });

  it('reaches the start again after paging back all the way', async () => {
    serveFileOf(100_000);
    await files.openFile(path, { isIndexed: false });
    await page('after', 20);

    await page('before', 30);

    const file = openedFile(path);
    expect(file.startLine).toBe(1);
    expect(file.reachedStart).toBe(true);
    expect(file.lines.length).toBe(cap);
    expect(everyLineReadsItsNumber(path)).toBe(true);
  });

  it('keeps the end of the file known after dropping the lines near it', async () => {
    serveFileOf(12_000);
    await files.openFile(path, { isIndexed: false });
    await page('after', 20);
    expect(openedFile(path).reachedEnd).toBe(true);

    await page('before', 3);

    const file = openedFile(path);
    expect(file.reachedEnd).toBe(false);
    expect(file.totalLines).toBe(12_000);
    expect(file.lines.length).toBe(cap);
    expect(everyLineReadsItsNumber(path)).toBe(true);
  });
});

describe('the page size of a file', () => {
  beforeEach(() => setLocation(''));

  afterEach(() => {
    for (const file of get(files).openFiles) files.closeFile(file.path);
    vi.unstubAllGlobals();
  });

  /**
   * A file of `LINE <n>` lines whose samples answers name `format`
   * (null for a plain file) and whose `GET /v1/index` answers an index
   * of `fileType`, or 404 without one. `asked` lists the `lines` value of
   * every samples request.
   */
  function serveKind(options: {
    lineCount: number;
    format: string | null;
    fileType?: 'text' | 'compressed' | 'seekable_zstd';
  }) {
    const { lineCount, format, fileType } = options;
    const serveLines = serveFileOf(lineCount).getMockImplementation()!;
    const asked: string[] = [];
    const spy = vi.fn(async (url: string) => {
      const params = new URL(url, 'http://localhost').searchParams;
      if (url.includes('/v1/index')) {
        if (!fileType) return jsonAnswer(404, { detail: 'no index' });
        return jsonAnswer(200, { file_type: fileType, line_count: lineCount, anomalies: null });
      }
      asked.push(params.get('lines') ?? '');
      const answer = await serveLines(url);
      const body = await answer.json();
      return jsonAnswer(200, {
        ...body,
        is_compressed: format !== null,
        compression_format: format,
      });
    });
    vi.stubGlobal('fetch', spy);
    return asked;
  }

  async function pageAfter(path: string, times: number) {
    for (let i = 0; i < times; i++) await files.loadMore(path, 'after');
  }

  it.each([
    { name: 'big.log.gz', format: 'gzip' },
    { name: 'big.log.bz2', format: 'bz2' },
    { name: 'big.log.xz', format: 'xz' },
  ])('asks lines=1-5000 and pages of 5,000 for $name', async ({ name, format }) => {
    const path = `/logs/${name}`;
    const asked = serveKind({ lineCount: 100_000, format });

    await files.openFile(path, { isIndexed: false, compressionFormat: format });
    await pageAfter(path, 2);

    expect(asked).toEqual(['1-5000', '5001-10000', '10001-15000']);
    expect(openedFile(path).endLine).toBe(15_000);
  });

  it('holds five pages of 5,000 lines of a compressed stream', async () => {
    const path = '/logs/long.log.gz';
    serveKind({ lineCount: 100_000, format: 'gzip' });
    await files.openFile(path, { isIndexed: false, compressionFormat: 'gzip' });

    await pageAfter(path, 10);

    const file = openedFile(path);
    expect(file.lines.length).toBe(maxHeldLines(STREAM_LINES_PER_PAGE));
    expect(file.lines.length).toBe(25_000);
    expect(file.endLine).toBe(55_000);
    expect(everyLineReadsItsNumber(path)).toBe(true);
  });

  it('asks lines=1-1000 and pages of 1,000 for a plain file', async () => {
    const path = '/logs/big.log';
    const asked = serveKind({ lineCount: 100_000, format: null });

    await files.openFile(path, { isIndexed: false });
    await pageAfter(path, 2);

    expect(asked).toEqual(['1-1000', '1001-2000', '2001-3000']);
  });

  it('pages a seekable zstd file by 1,000 once its index says it is seekable', async () => {
    const path = '/logs/big.log.zst';
    const asked = serveKind({ lineCount: 100_000, format: 'zstd', fileType: 'seekable_zstd' });

    await files.openFile(path, { isIndexed: true, compressionFormat: 'zstd' });
    await settle();
    await pageAfter(path, 2);

    expect(openedFile(path).fileType).toBe('seekable_zstd');
    expect(asked).toEqual(['1-1000', '1001-2000', '2001-3000']);
  });

  it('pages a zstd stream by 5,000 once its index says it is not seekable', async () => {
    const path = '/logs/stream.log.zst';
    const asked = serveKind({ lineCount: 100_000, format: 'zstd', fileType: 'compressed' });

    await files.openFile(path, { isIndexed: true, compressionFormat: 'zstd' });
    await settle();
    await pageAfter(path, 1);

    expect(asked).toEqual(['1-1000', '1001-6000']);
  });

  it('pages by 5,000 a gzip file opened from a link once its first answer names gzip', async () => {
    const path = '/logs/linked.log.gz';
    const asked = serveKind({ lineCount: 100_000, format: 'gzip' });

    await files.openFile(path, { isIndexed: false });
    await pageAfter(path, 1);

    expect(asked).toEqual(['1-1000', '1001-6000']);
  });
});

describe('the filter of a file', () => {
  beforeEach(() => setLocation(''));

  afterEach(() => {
    for (const file of get(files).openFiles) files.closeFile(file.path);
    vi.unstubAllGlobals();
  });

  it('applies a pattern to a file that has no filter yet', async () => {
    serveFileOf(100);
    await files.openFile('/logs/a.log', { isIndexed: false });

    files.updateRegexFilter('/logs/a.log', 'LINE 1\\d', 'show');

    const filter = openedFile('/logs/a.log').regexFilter;
    expect(filter?.enabled).toBe(true);
    expect(filter?.pattern).toBe('LINE 1\\d');
    expect(filter?.mode).toBe('show');
    expect(filter?.compiledRegex).not.toBeNull();
  });

  it('keeps the filter of each file when another file gets one', async () => {
    serveFileOf(100);
    await files.openFile('/logs/a.log', { isIndexed: false });
    await files.openFile('/logs/b.log', { isIndexed: false });

    files.updateRegexFilter('/logs/a.log', 'ERROR', 'hide');
    files.updateRegexFilter('/logs/b.log', 'WARN', 'highlight');

    expect(openedFile('/logs/a.log').regexFilter?.pattern).toBe('ERROR');
    expect(openedFile('/logs/b.log').regexFilter?.pattern).toBe('WARN');
  });
});

/**
 * A file's anchor is the line the URL names for it. It is the line the
 * user went to, and a line the file does not have is moved to the last
 * line the backend's answer shows.
 */
describe('the anchor line', () => {
  beforeEach(() => setLocation(''));

  afterEach(() => {
    for (const file of get(files).openFiles) files.closeFile(file.path);
    vi.unstubAllGlobals();
  });

  it('anchors a file opened without a line on line 1', async () => {
    serveFileOf(1000);
    await files.openFile('/logs/a.log', { isIndexed: false });
    expect(openedFile('/logs/a.log').anchorLine).toBe(1);
  });

  it('anchors a file opened at a line on that line', async () => {
    serveFileOf(1000);
    await files.openFile('/logs/a.log', { scrollToLine: 169, isIndexed: false });
    expect(openedFile('/logs/a.log').anchorLine).toBe(169);
  });

  it('anchors a jump on its target, loaded or not', async () => {
    serveFileOf(10_000);
    await files.openFile('/logs/a.log', { isIndexed: false });

    await files.jumpToLine('/logs/a.log', 50);
    expect(openedFile('/logs/a.log').anchorLine).toBe(50);

    await files.jumpToLine('/logs/a.log', 7_000);
    expect(openedFile('/logs/a.log').anchorLine).toBe(7_000);
  });

  it('anchors the end of the file on its last line', async () => {
    serveFileOf(300);
    await files.openFile('/logs/a.log', { isIndexed: false });
    await files.jumpToEnd('/logs/a.log');
    expect(openedFile('/logs/a.log').anchorLine).toBe(300);
  });

  it.each([1_200, 10 ** 12])(
    'moves a line %i past the end of a 1000-line file to line 1000',
    async (line) => {
      serveFileOf(1000);
      await files.openFile('/logs/a.log', { scrollToLine: line, isIndexed: false });

      const file = openedFile('/logs/a.log');
      expect(file.anchorLine).toBe(1000);
      expect(file.scrollToLine).toBe(1000);
    },
  );

  it('takes an anchor the editor reports after a scroll', async () => {
    serveFileOf(1000);
    await files.openFile('/logs/a.log', { isIndexed: false });
    files.setAnchorLine('/logs/a.log', 415);
    expect(openedFile('/logs/a.log').anchorLine).toBe(415);
  });
});

/** rx-go refuses a samples request with more than 100 context lines on a side (422). */
describe('the context of a jump', () => {
  beforeEach(() => setLocation(''));

  afterEach(() => {
    for (const file of get(files).openFiles) files.closeFile(file.path);
    vi.unstubAllGlobals();
  });

  it('asks for at most 100 context lines around a line, a link target and the end', async () => {
    const fetchSpy = serveFileOf(10_000);
    await files.openFile('/logs/a.log', { scrollToLine: 4_000, isIndexed: false });
    await files.jumpToLine('/logs/a.log', 9_000);
    await files.jumpToEnd('/logs/a.log');

    const contexts = fetchSpy.mock.calls
      .map(([url]) => new URL(url, 'http://localhost').searchParams.get('context'))
      .filter((context) => context !== null)
      .map(Number);
    expect(contexts).toHaveLength(3);
    expect(Math.max(...contexts)).toBeLessThanOrEqual(100);
    expect(openedFile('/logs/a.log').anchorLine).toBe(10_000);
  });
});

/** Opening, jumping and the end of the file are actions; paging while scrolling is not. */
describe('the equivalent command of a file window', () => {
  beforeEach(() => setLocation(''));

  afterEach(() => {
    for (const file of get(files).openFiles) files.closeFile(file.path);
    commandLog.clear();
    vi.unstubAllGlobals();
  });

  const commands = () => get(commandLog).map((entry) => entry.command);

  it('records the command of each window the user asked for', async () => {
    serveFileOf(10_000, { withCommand: true });
    await files.openFile('/logs/a.log', { isIndexed: false });
    await files.jumpToLine('/logs/a.log', 5_000);
    await files.jumpToEnd('/logs/a.log');

    expect(commands()).toEqual([
      'rx samples /logs/a.log --lines=-1',
      'rx samples /logs/a.log --lines=5000',
      'rx samples /logs/a.log --lines=1-1000',
    ]);
    expect(get(commandLog)[0].action).toBe('file');
  });

  it('records nothing for the pages loaded while scrolling', async () => {
    serveFileOf(10_000, { withCommand: true });
    await files.openFile('/logs/a.log', { isIndexed: false });
    await files.loadMore('/logs/a.log', 'after');

    expect(commands()).toEqual(['rx samples /logs/a.log --lines=1-1000']);
  });
});

describe('a file whose line index is being built', () => {
  beforeEach(() => setLocation(''));

  afterEach(() => {
    for (const file of get(files).openFiles) files.closeFile(file.path);
    vi.unstubAllGlobals();
  });

  /**
   * Answers as rx-go 1.4 does for a large file without an index: the
   * first samples request gets 202 with the build's task, the task is
   * complete at the first poll, and the request asked again gets the
   * lines. `buildSeen` records what the open file showed while the task
   * was polled.
   */
  async function serveAfterABuild(path: string, lineCount: number) {
    const serveLines = serveFileOf(lineCount).getMockImplementation()!;
    const buildSeen: unknown[] = [];
    const pendingSeen: unknown[] = [];
    let samplesAsked = 0;
    const json = (status: number, body: unknown) => ({
      ok: true,
      status,
      statusText: status === 202 ? 'Accepted' : 'OK',
      json: async () => body,
      text: async () => JSON.stringify(body),
    });
    const preferSent: (string | undefined)[] = [];
    const spy = vi.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
      if (url.startsWith('/health')) {
        return json(200, { contract_version: '1.5', features: ['samples_index_build'] });
      }
      if (url.includes('/v1/tasks/')) {
        const waiting = get(files).openFiles.find((f) => f.path === path);
        buildSeen.push(waiting?.indexBuild);
        pendingSeen.push(waiting?.pendingIndex);
        return json(200, {
          task_id: 't1',
          status: 'completed',
          path,
          operation: 'index',
          started_at: null,
          completed_at: null,
          error: null,
          progress: 1,
          result: { line_index: [[1, 0]], line_count: lineCount, anomalies: null },
        });
      }
      if (url.includes('/v1/samples')) preferSent.push(init?.headers?.Prefer);
      if (url.includes('/v1/samples') && samplesAsked++ === 0) {
        return json(202, {
          task_id: 't1',
          status: 'running',
          message: 'Building the line index',
          path,
          started_at: null,
        });
      }
      return serveLines(url);
    });
    vi.stubGlobal('fetch', spy);
    await health.check();
    return { spy, buildSeen, pendingSeen, preferSent };
  }

  it('shows the build while it runs, then loads the window', async () => {
    const path = '/logs/big.log.gz';
    const { buildSeen, preferSent } = await serveAfterABuild(path, 50);

    await files.openFile(path, { isIndexed: false });

    expect(buildSeen).toEqual([{ taskId: 't1', progress: null }]);
    const file = openedFile(path);
    expect(file.error).toBeNull();
    expect(file.loading).toBe(false);
    expect(file.indexBuild).toBeNull();
    expect(lineNumbers(path)[0]).toBe(1);
    expect(everyLineReadsItsNumber(path)).toBe(true);
    expect(preferSent).toEqual(['respond-async', 'respond-async']);
  });

  it('keeps the time features off while it waits for the build, and on after', async () => {
    const path = '/logs/big.log.gz';
    const { pendingSeen } = await serveAfterABuild(path, 50);

    await files.openFile(path, { isIndexed: false });

    expect(pendingSeen).toEqual(['building']);
    expect(openedFile(path).pendingIndex).toBeNull();
  });

  it('takes the line count and the indexed mark from the index the build made', async () => {
    const path = '/logs/huge.log.gz';
    await serveAfterABuild(path, 5000);
    const markIndexed = vi.spyOn(tree, 'markIndexed');

    await files.openFile(path, { isIndexed: false });

    const file = openedFile(path);
    expect(file.isIndexed).toBe(true);
    expect(file.totalLines).toBe(5000);
    expect(markIndexed).toHaveBeenCalledWith(path, 5000);
    markIndexed.mockRestore();
  });
});

/** A JSON answer as `fetch` gives it. */
function jsonAnswer(status: number, body: unknown) {
  return {
    ok: status < 400,
    status,
    statusText: status === 202 ? 'Accepted' : status < 400 ? 'OK' : 'Internal Server Error',
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

/** rx-go's `GET /v1/time-range` answer for the playground's middleware.log, under `path`. */
function middlewareRange(path: string, source: 'index' | 'scan' | 'none' = 'scan') {
  const known = source !== 'none';
  return {
    path,
    format: 'iso',
    has_zone: false,
    day_first: null,
    display_zone: 'UTC',
    example: '2025-12-10 07:00:04.574',
    first_ms: known ? 1765350004574 : null,
    last_ms: known ? 1765353604390 : null,
    source,
    cli_command: `rx time-range ${path}`,
  };
}

/** Lets every pending answer and the store updates after it run. */
function settle() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('the time range of an open file', () => {
  beforeEach(() => setLocation(''));

  afterEach(async () => {
    for (const file of get(files).openFiles) files.closeFile(file.path);
    // The health store is shared: leave it with no features for the next test.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonAnswer(200, { contract_version: '1.5' })),
    );
    await health.check();
    contractGate.reset();
    vi.unstubAllGlobals();
  });

  /**
   * A backend listing `features` that serves a file of `lineCount`
   * `LINE <n>` lines, its line index build when `building`, and each
   * `GET /v1/time-range` with the next of `ranges` (the last one
   * repeats). `rangeAsks` counts the time-range requests.
   */
  async function serveBackend(options: {
    features: string[];
    ranges: (path: string) => { status: number; body: unknown }[];
    lineCount?: number;
    compressed?: boolean;
    building?: boolean;
    /** Whether /health is asked now; false leaves the first answer to the test. */
    answerHealth?: boolean;
  }) {
    const {
      features,
      ranges,
      lineCount = 50,
      compressed = false,
      building = false,
      answerHealth = true,
    } = options;
    const serveLines = serveFileOf(lineCount, { compressed }).getMockImplementation()!;
    let rangeAsks = 0;
    let samplesAsked = 0;
    const spy = vi.fn(async (url: string) => {
      if (url.startsWith('/health')) return jsonAnswer(200, { contract_version: '1.5', features });
      const params = new URL(url, 'http://localhost').searchParams;
      const path = params.get('path') ?? '';
      if (url.includes('/v1/time-range')) {
        const answers = ranges(path);
        const { status, body } = answers[Math.min(rangeAsks++, answers.length - 1)];
        return jsonAnswer(status, body);
      }
      if (url.includes('/v1/tasks/')) {
        return jsonAnswer(200, {
          task_id: 't1',
          status: 'completed',
          path,
          operation: 'index',
          started_at: null,
          completed_at: null,
          error: null,
          progress: 1,
          result: { line_index: [[1, 0]], line_count: lineCount, anomalies: null },
        });
      }
      if (url.includes('/v1/samples') && building && samplesAsked++ === 0) {
        return jsonAnswer(202, {
          task_id: 't1',
          status: 'running',
          message: 'Building the line index',
          path,
          started_at: null,
        });
      }
      return serveLines(url);
    });
    vi.stubGlobal('fetch', spy);
    if (answerHealth) await health.check();
    return { spy, rangeAsks: () => rangeAsks };
  }

  it('asks for the range once when the file opens and keeps it on the file', async () => {
    const path = '/logs/middleware.log';
    const { rangeAsks } = await serveBackend({
      features: ['time_range'],
      ranges: (p) => [{ status: 200, body: middlewareRange(p) }],
    });

    await files.openFile(path, { isIndexed: false });
    await settle();
    await files.openFile(path);
    await settle();

    expect(openedFile(path).timeRange).toEqual(middlewareRange(path));
    expect(rangeAsks()).toBe(1);
  });

  it('asks nothing of a backend that does not list time_range', async () => {
    const path = '/logs/middleware.log';
    const { rangeAsks } = await serveBackend({
      features: ['samples_index_build'],
      ranges: (p) => [{ status: 200, body: middlewareRange(p) }],
    });

    await files.openFile(path, { isIndexed: false });
    await settle();

    expect(openedFile(path).timeRange).toBeNull();
    expect(openedFile(path).isReadingTimeRange).toBe(false);
    expect(rangeAsks()).toBe(0);
  });

  it('leaves the range null and opens the file when the call fails', async () => {
    const path = '/logs/middleware.log';
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    await serveBackend({
      features: ['time_range'],
      ranges: () => [{ status: 500, body: { detail: 'boom' } }],
    });

    await files.openFile(path, { isIndexed: false });
    await settle();

    const file = openedFile(path);
    expect(file.timeRange).toBeNull();
    expect(file.isReadingTimeRange).toBe(false);
    expect(file.error).toBeNull();
    expect(lineNumbers(path)[0]).toBe(1);
    expect(debug).toHaveBeenCalledWith(
      'File time range fetch failed (non-critical):',
      path,
      expect.anything(),
    );
    debug.mockRestore();
  });

  it('asks again when a line index build for the file ends', async () => {
    const path = '/logs/big.log';
    const { rangeAsks } = await serveBackend({
      features: ['time_range', 'samples_index_build'],
      ranges: (p) => [
        { status: 200, body: middlewareRange(p, 'scan') },
        { status: 200, body: middlewareRange(p, 'index') },
      ],
      building: true,
    });

    await files.openFile(path, { isIndexed: false });
    await settle();

    expect(openedFile(path).timeRange?.source).toBe('index');
    expect(rangeAsks()).toBe(2);
  });

  it('asks again after the first window of a compressed file whose range waited for its index', async () => {
    // The backend indexes every compressed file it reads; a small one is
    // indexed inside the samples answer, with no build to follow.
    const path = '/logs/small.log.gz';
    const { rangeAsks } = await serveBackend({
      features: ['time_range', 'samples_index_build'],
      ranges: (p) => [
        { status: 200, body: middlewareRange(p, 'none') },
        { status: 200, body: middlewareRange(p, 'index') },
      ],
      compressed: true,
    });

    await files.openFile(path, { isIndexed: false });
    await settle();

    expect(openedFile(path).timeRange).toEqual(middlewareRange(path, 'index'));
    expect(rangeAsks()).toBe(2);
  });

  it('asks once for a compressed file whose range is already known', async () => {
    const path = '/logs/app.log.zst';
    const { rangeAsks } = await serveBackend({
      features: ['time_range'],
      ranges: (p) => [{ status: 200, body: middlewareRange(p, 'scan') }],
      compressed: true,
    });

    files.openFile(path, { isIndexed: false });
    await settle();
    await settle();

    expect(openedFile(path).timeRange?.source).toBe('scan');
    expect(rangeAsks()).toBe(1);
  });

  it('asks for the range of a file opened before the first /health answer', async () => {
    // A file named in the link opens while the app's first /health is out.
    const path = '/logs/middleware.log';
    contractGate.hold();
    const { rangeAsks } = await serveBackend({
      features: ['time_range'],
      ranges: (p) => [{ status: 200, body: middlewareRange(p) }],
      answerHealth: false,
    });

    const opening = files.openFile(path, { isIndexed: false });
    await settle();
    expect(rangeAsks()).toBe(0);
    expect(openedFile(path).isReadingTimeRange).toBe(true);
    await health.check();
    await opening;
    await settle();

    expect(openedFile(path).timeRange).toEqual(middlewareRange(path));
    expect(openedFile(path).isReadingTimeRange).toBe(false);
    expect(rangeAsks()).toBe(1);
  });
});

describe('a line index built in the background', () => {
  /** An instant inside middleware.log's range. */
  const INSIDE_MS = 1765351000000;

  beforeEach(() => setLocation(''));

  afterEach(async () => {
    for (const file of get(files).openFiles) files.closeFile(file.path);
    for (const shown of get(notifications)) notifications.dismiss(shown.id);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonAnswer(200, { contract_version: '1.5' })),
    );
    await health.check();
    contractGate.reset();
    vi.unstubAllGlobals();
  });

  /**
   * rx-go answering from the head of a large file: every samples answer
   * names the build `t9` until the test ends it with `endBuild`, and the
   * first status request of the task waits for that end. The time range
   * comes from a scan (`none` for a compressed file) until the build
   * ends, and from the index after.
   */
  async function serveBuildInBackground(options: { compressed?: boolean; lineCount?: number }) {
    const { compressed = false, lineCount = 50 } = options;
    const serveLines = serveFileOf(lineCount, { compressed }).getMockImplementation()!;
    let isBuilt = false;
    let rangeAsks = 0;
    const taskSignals: AbortSignal[] = [];
    let endTask: (status: 'completed' | 'failed') => void = () => {};
    const taskEnded = new Promise<'completed' | 'failed'>((resolve) => (endTask = resolve));

    const spy = vi.fn(async (url: string, init?: { signal?: AbortSignal }) => {
      const params = new URL(url, 'http://localhost').searchParams;
      const path = params.get('path') ?? '';
      if (url.startsWith('/health')) {
        return jsonAnswer(200, {
          contract_version: '1.6',
          features: ['samples_index_build', 'time_range', 'samples_timestamps'],
        });
      }
      if (url.includes('/v1/index')) return jsonAnswer(404, { detail: 'no index' });
      if (url.includes('/v1/time-range')) {
        rangeAsks++;
        const source = isBuilt ? 'index' : compressed ? 'none' : 'scan';
        return jsonAnswer(200, middlewareRange(path, source));
      }
      if (url.includes('/v1/tasks/')) {
        if (init?.signal) taskSignals.push(init.signal);
        const status = await taskEnded;
        isBuilt = status === 'completed';
        return jsonAnswer(200, {
          task_id: 't9',
          status,
          path: '/logs/core.log',
          operation: 'index',
          started_at: null,
          completed_at: null,
          error: status === 'failed' ? 'no space left on device' : null,
          progress: 1,
          result:
            status === 'completed'
              ? { line_index: [[1, 0]], line_count: 42_554_368, anomalies: null, file_type: 'text' }
              : null,
        });
      }
      const answer = await serveLines(url);
      const body = await answer.json();
      const indexBuild = isBuilt
        ? null
        : {
            task_id: 't9',
            status: 'running',
            path,
            started_at: null,
            message: `Building the line index of ${path} in the background`,
          };
      return jsonAnswer(200, { ...body, index_build: indexBuild });
    });
    vi.stubGlobal('fetch', spy);
    await health.check();
    return {
      spy,
      taskSignals,
      rangeAsks: () => rangeAsks,
      endBuild: async (status: 'completed' | 'failed') => {
        endTask(status);
        await settle();
        await settle();
      },
    };
  }

  function stashInside(path: string) {
    return stashEntryState(INSIDE_MS, openedFile(path), true);
  }

  it('shows the lines at once, follows the build and keeps the time features off', async () => {
    const path = '/logs/core.log';
    const { taskSignals } = await serveBuildInBackground({});

    await files.openFile(path, { isIndexed: false });
    await settle();

    const file = openedFile(path);
    expect(lineNumbers(path)[0]).toBe(1);
    expect(file.loading).toBe(false);
    expect(file.indexBuild).toBeNull();
    expect(file.pendingIndex).toBe('building');
    expect(file.backgroundIndexBuild).toEqual({ taskId: 't9', progress: null });
    expect(file.timeRange?.source).toBe('scan');
    expect(taskSignals).toHaveLength(1);
    expect(stashInside(path)).toEqual({
      isEnabled: false,
      reason: 'The line index of core.log is being built',
    });
  });

  it('applies the index when the build ends, asks the range again and turns the time features on', async () => {
    const path = '/logs/core.log';
    const markIndexed = vi.spyOn(tree, 'markIndexed');
    const { rangeAsks, endBuild } = await serveBuildInBackground({});
    await files.openFile(path, { isIndexed: false });
    await settle();

    await endBuild('completed');

    const file = openedFile(path);
    expect(file.isIndexed).toBe(true);
    expect(file.totalLines).toBe(42_554_368);
    expect(file.fileType).toBe('text');
    expect(file.pendingIndex).toBeNull();
    expect(file.backgroundIndexBuild).toBeNull();
    expect(markIndexed).toHaveBeenCalledWith(path, 42_554_368);
    expect(file.timeRange?.source).toBe('index');
    expect(rangeAsks()).toBe(2);
    expect(stashInside(path)).toEqual({ isEnabled: true });
    markIndexed.mockRestore();
  });

  it('says so quietly when the build fails, and keeps the file readable and the time features off', async () => {
    const path = '/logs/core.log';
    const { endBuild } = await serveBuildInBackground({});
    await files.openFile(path, { isIndexed: false });
    await settle();

    await endBuild('failed');

    const file = openedFile(path);
    expect(file.pendingIndex).toBe('failed');
    expect(file.backgroundIndexBuild).toBeNull();
    expect(file.error).toBeNull();
    expect(lineNumbers(path)[0]).toBe(1);
    expect(get(notifications).map((n) => [n.type, n.message])).toEqual([
      ['info', 'The line index of core.log could not be built: no space left on device'],
    ]);
    expect(stashInside(path)).toEqual({
      isEnabled: false,
      reason: 'The line index of core.log could not be built',
    });
  });

  it('stops following the build when the file is closed', async () => {
    const path = '/logs/core.log';
    const markIndexed = vi.spyOn(tree, 'markIndexed');
    const { taskSignals, endBuild } = await serveBuildInBackground({});
    await files.openFile(path, { isIndexed: false });
    await settle();

    files.closeFile(path);
    await endBuild('completed');

    expect(taskSignals[0].aborted).toBe(true);
    expect(markIndexed).not.toHaveBeenCalled();
    expect(get(notifications)).toEqual([]);
    markIndexed.mockRestore();
  });

  it('keeps the time features off for a file opened again from a link while its build runs', async () => {
    // A reload: the answer joins the build that is already running, and
    // the range from the scan arrives as usual.
    const path = '/logs/core.log';
    const { endBuild } = await serveBuildInBackground({ lineCount: 5000 });

    await files.openFile(path, { scrollToLine: 2500 });
    await settle();

    expect(openedFile(path).timeRange?.source).toBe('scan');
    expect(openedFile(path).pendingIndex).toBe('building');
    expect(stashInside(path).isEnabled).toBe(false);

    await endBuild('completed');
    expect(stashInside(path)).toEqual({ isEnabled: true });
  });

  it("asks a compressed file's range again only when its build ends", async () => {
    const path = '/logs/core.log.gz';
    const { rangeAsks, endBuild } = await serveBuildInBackground({ compressed: true });
    await files.openFile(path, { isIndexed: false, compressionFormat: 'gzip' });
    await settle();
    expect(rangeAsks()).toBe(1);

    await endBuild('completed');

    expect(rangeAsks()).toBe(2);
    expect(openedFile(path).timeRange?.source).toBe('index');
  });

  it('follows the build once while pages arrive during it', async () => {
    const path = '/logs/core.log';
    const { taskSignals } = await serveBuildInBackground({ lineCount: 100_000 });
    await files.openFile(path, { isIndexed: false });
    await settle();

    await files.loadMore(path, 'after');
    await files.loadMore(path, 'after');
    await settle();

    expect(taskSignals).toHaveLength(1);
    expect(openedFile(path).endLine).toBe(3000);
  });
});

describe('a jump by time', () => {
  const path = '/logs/middleware.log';
  /** Line n of the served file reads `LINE <n>` and was written at FIRST_MS + n seconds. */
  const FIRST_MS = 1765350000000;
  const stampOf = (line: number) => FIRST_MS + line * 1000;

  beforeEach(() => setLocation(''));

  afterEach(async () => {
    for (const file of get(files).openFiles) files.closeFile(file.path);
    timeCursor.clear();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonAnswer(200, { contract_version: '1.5' })),
    );
    await health.check();
    contractGate.reset();
    for (const notice of get(notifications)) notifications.dismiss(notice.id);
    vi.unstubAllGlobals();
  });

  /**
   * A backend of a 10,000-line file whose line n was written at
   * `stampOf(n)`. A `timestamps` query is answered from `found`: the line
   * a value finds, -1 for none, or a status and message to refuse it
   * with. Every samples answer carries `line_timestamps`.
   */
  async function serveTimes(
    found: Record<string, number | { status: number; message: string }>,
    features: string[] = ['samples_timestamps'],
  ) {
    const lineCount = 10_000;
    const serveLines = serveFileOf(lineCount).getMockImplementation()!;
    const timeQueries: URLSearchParams[] = [];
    const spy = vi.fn(async (url: string) => {
      if (url.startsWith('/health')) return jsonAnswer(200, { contract_version: '1.5', features });
      const params = new URL(url, 'http://localhost').searchParams;
      const value = params.get('timestamps');
      if (value === null) {
        const answer = await serveLines(url);
        const body = await answer.json();
        const [key, content] = Object.entries(body.samples as Record<string, string[] | null>)[0];
        const first = Number(content?.[0]?.slice('LINE '.length));
        return jsonAnswer(200, {
          ...body,
          line_timestamps: { [key]: content ? content.map((_, i) => stampOf(first + i)) : null },
        });
      }
      timeQueries.push(params);
      const outcome = found[value];
      if (typeof outcome === 'object')
        return jsonAnswer(outcome.status, { detail: outcome.message });
      const context = Number(params.get('context') ?? 3);
      const content: string[] = [];
      if (outcome > 0) {
        for (
          let n = Math.max(1, outcome - context);
          n <= Math.min(lineCount, outcome + context);
          n++
        )
          content.push(`LINE ${n}`);
      }
      const first = Math.max(1, outcome - context);
      return jsonAnswer(200, {
        path,
        samples: { [value]: outcome > 0 ? content : null },
        line_timestamps: {
          [value]: outcome > 0 ? content.map((_, i) => stampOf(first + i)) : null,
        },
        timestamps: { [value]: outcome },
        before_context: context,
        after_context: context,
        lines: {},
        offsets: {},
        is_compressed: false,
        compression_format: null,
        cli_command: `rx samples ${path} --timestamps=${value}`,
      });
    });
    vi.stubGlobal('fetch', spy);
    await health.check();
    return { timeQueries };
  }

  it('asks once for an instant, as RFC 3339 with ms and Z, and anchors the found line', async () => {
    const instant = stampOf(4_200) - 400;
    const { timeQueries } = await serveTimes({ '2025-12-10T08:09:59.600Z': 4_200 });
    await files.openFile(path, { isIndexed: false });

    const outcome = await files.jumpToTime(path, instant);

    expect(outcome).toEqual({ kind: 'found', line: 4_200 });
    expect(timeQueries).toHaveLength(1);
    expect(timeQueries[0].get('context')).toBe('100');
    const file = openedFile(path);
    expect(file.anchorLine).toBe(4_200);
    expect(file.scrollToLine).toBe(4_200);
    expect(file.startLine).toBe(4_100);
    expect(file.lines.find((l) => l.lineNumber === 4_200)?.timestampMs).toBe(stampOf(4_200));
    expect(file.timeJump).toBe(instant);
    expect(file.loading).toBe(false);
    expect(get(timeCursor)).toBe(instant);
  });

  it('sends a typed value as typed and keeps the time of the line it found', async () => {
    const { timeQueries } = await serveTimes({ '2025-12-10 07:45:12.345': 2_712 });
    await files.openFile(path, { isIndexed: false });

    const outcome = await files.jumpToTime(path, '2025-12-10 07:45:12.345');

    expect(outcome).toEqual({ kind: 'found', line: 2_712 });
    expect(timeQueries[0].getAll('timestamps')).toEqual(['2025-12-10 07:45:12.345']);
    expect(openedFile(path).timeJump).toBe(stampOf(2_712));
    expect(get(timeCursor)).toBe(stampOf(2_712));
  });

  it("returns the backend's message for a refused value and keeps the file and the cursor as they were", async () => {
    const message = 'cannot read "07:61" as a time';
    await serveTimes({ '07:61': { status: 400, message } });
    await files.openFile(path, { isIndexed: false });
    const before = openedFile(path);
    timeCursor.set(stampOf(77));

    const outcome = await files.jumpToTime(path, '07:61');

    expect(outcome).toEqual({ kind: 'refused', message });
    expect(get(timeCursor)).toBe(stampOf(77));
    const file = openedFile(path);
    expect(file.error).toBeNull();
    expect(file.loading).toBe(false);
    expect(file.lines).toEqual(before.lines);
    expect(file.anchorLine).toBe(before.anchorLine);
  });

  it('shows the last window and a notice for a time after the last line', async () => {
    const instant = stampOf(20_000);
    await serveTimes({ [new Date(instant).toISOString()]: -1 });
    await files.openFile(path, { isIndexed: false });

    const outcome = await files.jumpToTime(path, instant);

    expect(outcome).toEqual({ kind: 'none' });
    const file = openedFile(path);
    expect(file.anchorLine).toBe(10_000);
    expect(file.reachedEnd).toBe(true);
    expect(file.timeJump).toBe(instant);
    expect(get(timeCursor)).toBe(instant);
    expect(get(notifications).map((n) => n.message)).toEqual([
      'No line at or after 2025-12-10T12:33:20.000Z in middleware.log',
    ]);
  });

  it('keeps the cursor for a typed value with no line at or after it', async () => {
    await serveTimes({ '23:59': -1 });
    await files.openFile(path, { isIndexed: false });
    timeCursor.set(stampOf(77));

    expect(await files.jumpToTime(path, '23:59')).toEqual({ kind: 'none' });

    expect(openedFile(path).anchorLine).toBe(10_000);
    expect(get(timeCursor)).toBe(stampOf(77));
  });

  it('asks nothing of a backend that does not list samples_timestamps', async () => {
    const { timeQueries } = await serveTimes({}, []);
    await files.openFile(path, { isIndexed: false });

    expect(await files.jumpToTime(path, stampOf(10))).toEqual({ kind: 'unsupported' });
    expect(timeQueries).toHaveLength(0);
    expect(openedFile(path).loading).toBe(false);
    expect(get(timeCursor)).toBeNull();
  });

  it('moves only the file it jumps: another file shown after it stays where it was', async () => {
    const other = '/logs/postgresql.log';
    const { timeQueries } = await serveTimes({ [new Date(stampOf(500)).toISOString()]: 500 });
    await files.openFile(path, { isIndexed: false });
    await files.openFile(other, { isIndexed: false });
    await files.jumpToLine(other, 77);

    await files.jumpToTime(path, stampOf(500));
    files.setActiveFile(other);
    await settle();

    expect(get(files).activeFilePath).toBe(other);
    expect(get(timeCursor)).toBe(stampOf(500));
    expect(openedFile(other).anchorLine).toBe(77);
    expect(openedFile(other).timeJump).toBeNull();
    expect(timeQueries.map((q) => q.get('path'))).toEqual([path]);

    await files.openFile('/logs/core.log', { isIndexed: false });
    await settle();
    expect(openedFile('/logs/core.log').anchorLine).toBe(1);
    expect(timeQueries).toHaveLength(1);
  });

  it('clears the cursor and every time jump, and leaves each file where it is', async () => {
    await serveTimes({ [new Date(stampOf(500)).toISOString()]: 500 });
    await files.openFile(path, { isIndexed: false });
    await files.jumpToTime(path, stampOf(500));

    files.clearTimeCursor();

    expect(get(timeCursor)).toBeNull();
    expect(openedFile(path).timeJump).toBeNull();
    expect(openedFile(path).anchorLine).toBe(500);
  });

  it('forgets the time jump when the file then moves by line', async () => {
    await serveTimes({ [new Date(stampOf(500)).toISOString()]: 500 });
    await files.openFile(path, { isIndexed: false });
    await files.jumpToTime(path, stampOf(500));

    files.setAnchorLine(path, 500);
    expect(openedFile(path).timeJump).toBe(stampOf(500));

    files.setAnchorLine(path, 640);
    expect(openedFile(path).timeJump).toBeNull();

    await files.jumpToTime(path, stampOf(500));
    await files.jumpToLine(path, 20);
    expect(openedFile(path).timeJump).toBeNull();

    await files.jumpToTime(path, stampOf(500));
    await files.jumpToEnd(path);
    expect(openedFile(path).timeJump).toBeNull();
  });
});

describe('a time zone chosen for a file', () => {
  const path = '/logs/middleware.log';
  const other = '/logs/postgresql.log';
  const HOUR = 3_600_000;
  const BERLIN_WINTER_OFFSET = HOUR;

  beforeEach(() => setLocation(''));

  afterEach(async () => {
    for (const file of get(files).openFiles) files.closeFile(file.path);
    fileZones.replace([]);
    timeCursor.clear();
    commandLog.clear();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonAnswer(200, { contract_version: '1.5' })),
    );
    await health.check();
    contractGate.reset();
    for (const notice of get(notifications)) notifications.dismiss(notice.id);
    vi.unstubAllGlobals();
  });

  /**
   * A backend listing `features` that serves 10,000 `LINE <n>` lines and
   * answers `GET /v1/time-range` for middleware.log the way rx-go does:
   * under `file_tz=Europe/Berlin` its zone-less wall clock is an hour
   * earlier as an instant, and a zone in `refused` is answered 400.
   * Every request's parameters are kept, by endpoint.
   */
  async function serveZones(
    options: { features?: string[]; refused?: string[]; answerHealth?: boolean } = {},
  ) {
    const {
      features = ['time_range', 'file_tz', 'samples_timestamps'],
      refused = [],
      answerHealth = true,
    } = options;
    const serveLines = serveFileOf(10_000, { withCommand: true }).getMockImplementation()!;
    const samples: URLSearchParams[] = [];
    const ranges: URLSearchParams[] = [];
    const spy = vi.fn(async (url: string) => {
      if (url.startsWith('/health')) return jsonAnswer(200, { contract_version: '1.6', features });
      const params = new URL(url, 'http://localhost').searchParams;
      const zone = params.get('file_tz');
      const isRangeAsk = url.includes('/v1/time-range');
      (isRangeAsk ? ranges : samples).push(params);
      if (zone !== null && refused.includes(zone)) {
        return jsonAnswer(400, { detail: `Invalid file_tz "${zone}": not a zone name` });
      }
      if (isRangeAsk) {
        const range = middlewareRange(params.get('path') ?? '');
        if (zone !== 'Europe/Berlin') return jsonAnswer(200, range);
        return jsonAnswer(200, {
          ...range,
          display_zone: zone,
          first_ms: range.first_ms! - BERLIN_WINTER_OFFSET,
          last_ms: range.last_ms! - BERLIN_WINTER_OFFSET,
          cli_command: `${range.cli_command} --file-tz=${zone}`,
        });
      }
      const value = params.get('timestamps');
      if (value !== null) {
        // Every time finds line 420; its window is lines 320 to 520.
        const content = Array.from({ length: 201 }, (_, i) => `LINE ${320 + i}`);
        return jsonAnswer(200, {
          path: params.get('path'),
          samples: { [value]: content },
          line_timestamps: { [value]: null },
          timestamps: { [value]: 420 },
          before_context: 100,
          after_context: 100,
          lines: {},
          offsets: {},
          is_compressed: false,
          compression_format: null,
          cli_command: null,
        });
      }
      const answer = await serveLines(url);
      const body = await answer.json();
      const suffix = zone === null ? '' : ` --file-tz=${zone}`;
      return jsonAnswer(200, { ...body, cli_command: `${body.cli_command}${suffix}` });
    });
    vi.stubGlobal('fetch', spy);
    if (answerHealth) await health.check();
    const zonesOf = (asked: URLSearchParams[], file: string) =>
      asked.filter((p) => p.get('path') === file).map((p) => p.get('file_tz'));
    return {
      samplesZones: (file: string) => zonesOf(samples, file),
      rangeZones: (file: string) => zonesOf(ranges, file),
    };
  }

  it('asks for the range again in the chosen zone, and without a zone after a reset', async () => {
    const { rangeZones } = await serveZones();
    await files.openFile(path, { isIndexed: false });
    await settle();

    await files.setFileZone(path, 'Europe/Berlin');
    await settle();
    expect(openedFile(path).timeRange?.display_zone).toBe('Europe/Berlin');
    expect(openedFile(path).timeRange?.first_ms).toBe(1765350004574 - BERLIN_WINTER_OFFSET);

    await files.setFileZone(path, null);
    await settle();
    expect(openedFile(path).timeRange?.display_zone).toBe('UTC');
    expect(rangeZones(path)).toEqual([null, 'Europe/Berlin', null]);
  });

  it('sends file_tz on every samples request of that file and on no other file', async () => {
    const { samplesZones } = await serveZones();
    await files.openFile(other, { isIndexed: false });
    await files.openFile(path, { isIndexed: false });

    await files.setFileZone(path, '+02:00');
    await files.loadMore(path, 'after');
    await files.jumpToLine(path, 5_000);
    await files.jumpToEnd(path);
    await files.jumpToLine(other, 5_000);

    expect(samplesZones(path)).toEqual([null, '+02:00', '+02:00', '+02:00', '+02:00']);
    expect(samplesZones(other)).toEqual([null, null]);
  });

  it('loads the window again in the zone, so the status bar shows its command', async () => {
    await serveZones();
    await files.openFile(path, { isIndexed: false });
    await files.jumpToLine(path, 420);

    await files.setFileZone(path, 'Europe/Berlin');

    const file = openedFile(path);
    expect(file.anchorLine).toBe(420);
    expect(file.startLine).toBe(320);
    expect(get(commandLog)[0].command).toBe(
      `rx samples ${path} --lines=420 --file-tz=Europe/Berlin`,
    );
  });

  it('keeps the zone of a file that is not open and uses it when the file opens', async () => {
    const { samplesZones, rangeZones } = await serveZones();

    await files.setFileZone(path, 'Europe/Berlin');
    await files.openFile(path, { isIndexed: false });
    await settle();

    expect(samplesZones(path)).toEqual(['Europe/Berlin']);
    expect(rangeZones(path)).toEqual(['Europe/Berlin']);
  });

  it('sends the zone of a file opened from a link before the first /health answer', async () => {
    contractGate.hold();
    const { samplesZones, rangeZones } = await serveZones({ answerHealth: false });
    fileZones.replace([{ path, zone: 'Europe/Berlin' }]);

    const opening = files.openFile(path, { isIndexed: false });
    await settle();
    await health.check();
    await opening;
    await settle();

    expect(samplesZones(path)).toEqual(['Europe/Berlin']);
    expect(rangeZones(path)).toEqual(['Europe/Berlin']);
  });

  it('sends no file_tz to a backend that does not list it', async () => {
    const { samplesZones, rangeZones } = await serveZones({ features: ['time_range'] });
    fileZones.replace([{ path, zone: 'Europe/Berlin' }]);

    await files.openFile(path, { isIndexed: false });
    await settle();

    expect(samplesZones(path)).toEqual([null]);
    expect(rangeZones(path)).toEqual([null]);
  });

  it('drops a zone the backend refuses and reads the file as its lines write times', async () => {
    const { rangeZones } = await serveZones({ refused: ['Asia/Kolkata'] });
    await files.openFile(path, { isIndexed: false });
    await settle();

    await files.setFileZone(path, 'Asia/Kolkata');
    // The file is read again in the background after the refusal.
    await vi.waitFor(() => {
      expect(rangeZones(path)).toEqual([null, 'Asia/Kolkata', null]);
      expect(openedFile(path).loading).toBe(false);
    });

    expect(get(fileZones)).toEqual([]);
    expect(openedFile(path).timeRange?.display_zone).toBe('UTC');
    expect(openedFile(path).error).toBeNull();
    expect(get(notifications).map((n) => n.message)).toEqual([
      expect.stringContaining('Asia/Kolkata'),
    ]);
  });

  it('enables the stash entries inside the range read in the chosen zone', async () => {
    await serveZones();
    await files.openFile(path, { isIndexed: false });
    await settle();
    const beforeFirstUtc = Date.UTC(2025, 11, 10, 6, 30);
    const afterFirstUtc = Date.UTC(2025, 11, 10, 7, 30);
    const enabled = () =>
      [beforeFirstUtc, afterFirstUtc].map(
        (ms) => stashEntryState(ms, openedFile(path), true).isEnabled,
      );
    expect(enabled()).toEqual([false, true]);

    await files.setFileZone(path, 'Europe/Berlin');
    await settle();

    expect(enabled()).toEqual([true, false]);
  });

  it('ends a jump by time of the file and keeps its line when the zone changes', async () => {
    await serveZones();
    await files.openFile(path, { isIndexed: false });
    await files.jumpToTime(path, Date.UTC(2025, 11, 10, 7, 30));
    expect(openedFile(path).timeJump).not.toBeNull();

    await files.setFileZone(path, 'Europe/Berlin');

    expect(openedFile(path).timeJump).toBeNull();
    expect(openedFile(path).anchorLine).toBe(420);
  });
});
