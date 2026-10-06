import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { LINES_PER_PAGE, maxHeldLines } from '../utils/slidingWindow';
import { contractGate } from '../contractGate';
import { commandLog } from './commands';
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
        buildSeen.push(get(files).openFiles.find((f) => f.path === path)?.indexBuild);
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
    return { spy, buildSeen, preferSent };
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
    await health.check();
    await opening;
    await settle();

    expect(openedFile(path).timeRange).toEqual(middlewareRange(path));
    expect(rangeAsks()).toBe(1);
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
  });

  it('sends a typed value as typed and keeps the time of the line it found', async () => {
    const { timeQueries } = await serveTimes({ '2025-12-10 07:45:12.345': 2_712 });
    await files.openFile(path, { isIndexed: false });

    const outcome = await files.jumpToTime(path, '2025-12-10 07:45:12.345');

    expect(outcome).toEqual({ kind: 'found', line: 2_712 });
    expect(timeQueries[0].getAll('timestamps')).toEqual(['2025-12-10 07:45:12.345']);
    expect(openedFile(path).timeJump).toBe(stampOf(2_712));
  });

  it("returns the backend's message for a refused value and keeps the file as it was", async () => {
    const message = 'cannot read "07:61" as a time';
    await serveTimes({ '07:61': { status: 400, message } });
    await files.openFile(path, { isIndexed: false });
    const before = openedFile(path);

    const outcome = await files.jumpToTime(path, '07:61');

    expect(outcome).toEqual({ kind: 'refused', message });
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
    expect(get(notifications).map((n) => n.message)).toEqual([
      'No line at or after 2025-12-10T12:33:20.000Z in middleware.log',
    ]);
  });

  it('asks nothing of a backend that does not list samples_timestamps', async () => {
    const { timeQueries } = await serveTimes({}, []);
    await files.openFile(path, { isIndexed: false });

    expect(await files.jumpToTime(path, stampOf(10))).toEqual({ kind: 'unsupported' });
    expect(timeQueries).toHaveLength(0);
    expect(openedFile(path).loading).toBe(false);
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

describe('the shared time cursor', () => {
  /** Line n of every served file reads `LINE <n>` and was written at FIRST_MS + n seconds. */
  const FIRST_MS = 1765350000000;
  const stampOf = (line: number) => FIRST_MS + line * 1000;
  const CURSOR = stampOf(4_000);
  const LATER_CURSOR = stampOf(6_000);
  const iso = (ms: number) => new Date(ms).toISOString();

  const A = '/logs/middleware.log';
  const B = '/logs/postgresql.log';
  const C = '/logs/core.log';
  const D = '/logs/kernel.log';

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

  type Found = number | { status: number; message: string };

  /**
   * A backend listing `time_range` and `samples_timestamps` that serves
   * 10,000-line files whose line n was written at `stampOf(n)`. A time
   * query for a path is answered from `found[path]`: the line a value
   * finds, -1 for none, or a status and message to refuse it with; a
   * value not listed finds line 1. Every path has a time range unless
   * `untimed` names it; the range of a path in `heldRanges` is answered
   * when the test resolves it. `timeQueries(path)` lists the values asked.
   */
  async function serveFiles(
    found: Record<string, Record<string, Found>>,
    options: { untimed?: string[]; heldRanges?: Record<string, Promise<void>> } = {},
  ) {
    const lineCount = 10_000;
    const serveLines = serveFileOf(lineCount).getMockImplementation()!;
    const asked: { path: string; value: string }[] = [];
    const answer = (path: string, value: string, outcome: number, context: number) => {
      const first = Math.max(1, outcome - context);
      const content: string[] = [];
      if (outcome > 0) {
        for (let n = first; n <= Math.min(lineCount, outcome + context); n++)
          content.push(`LINE ${n}`);
      }
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
    };
    const spy = vi.fn(async (url: string) => {
      if (url.startsWith('/health')) {
        return jsonAnswer(200, {
          contract_version: '1.5',
          features: ['samples_timestamps', 'time_range'],
        });
      }
      const params = new URL(url, 'http://localhost').searchParams;
      const path = params.get('path') ?? '';
      if (url.includes('/v1/time-range')) {
        await options.heldRanges?.[path];
        const range = middlewareRange(path);
        return jsonAnswer(
          200,
          options.untimed?.includes(path)
            ? { ...range, format: null, example: null, first_ms: null, last_ms: null }
            : range,
        );
      }
      const value = params.get('timestamps');
      if (value === null) {
        const lines = await serveLines(url);
        const body = await lines.json();
        const [key, content] = Object.entries(body.samples as Record<string, string[] | null>)[0];
        const first = Number(content?.[0]?.slice('LINE '.length));
        return jsonAnswer(200, {
          ...body,
          line_timestamps: { [key]: content ? content.map((_, i) => stampOf(first + i)) : null },
        });
      }
      asked.push({ path, value });
      const outcome = found[path]?.[value] ?? 1;
      if (typeof outcome === 'object')
        return jsonAnswer(outcome.status, { detail: outcome.message });
      return answer(path, value, outcome, Number(params.get('context') ?? 3));
    });
    vi.stubGlobal('fetch', spy);
    await health.check();
    return {
      timeQueries: (path: string) => asked.filter((q) => q.path === path).map((q) => q.value),
    };
  }

  /** Open each file and let its window and its time range arrive. */
  async function openAll(...paths: string[]) {
    for (const path of paths) {
      await files.openFile(path, { isIndexed: false });
      await settle();
    }
  }

  it('moves a tab shown after a jump to the cursor once, and keeps a tab moved by line after it', async () => {
    const { timeQueries } = await serveFiles({
      [A]: { [iso(CURSOR)]: 4_000 },
      [B]: { [iso(CURSOR)]: 3_500 },
      [C]: { [iso(CURSOR)]: 2_500 },
    });
    await openAll(A, B, C);

    await files.goToTime(A, CURSOR);
    await files.jumpToLine(C, 77);
    await files.showTab(B);

    expect(openedFile(B).anchorLine).toBe(3_500);
    expect(openedFile(B).timeJump).toBe(CURSOR);
    expect(get(files).activeFilePath).toBe(B);

    await files.showTab(A);
    await files.showTab(B);
    await files.showTab(C);

    expect(timeQueries(B)).toEqual([iso(CURSOR)]);
    expect(timeQueries(C)).toEqual([]);
    expect(openedFile(C).anchorLine).toBe(77);
    expect(openedFile(A).anchorLine).toBe(4_000);
  });

  it('moves every tab not moved since to a second jump when it is shown', async () => {
    const { timeQueries } = await serveFiles({
      [B]: { [iso(CURSOR)]: 3_500, [iso(LATER_CURSOR)]: 5_500 },
      [C]: { [iso(LATER_CURSOR)]: 5_200 },
    });
    await openAll(A, B, C);
    await files.goToTime(A, CURSOR);
    await files.showTab(B);
    await files.jumpToLine(C, 77);

    await files.goToTime(A, LATER_CURSOR);
    await files.showTab(B);
    await files.showTab(C);

    expect(openedFile(B).anchorLine).toBe(5_500);
    expect(openedFile(C).anchorLine).toBe(5_200);
    expect(timeQueries(B)).toEqual([iso(CURSOR), iso(LATER_CURSOR)]);
    expect(timeQueries(C)).toEqual([iso(LATER_CURSOR)]);
  });

  it('opens a file at the cursor once its time range is known, and at its start without one', async () => {
    const { timeQueries } = await serveFiles({ [D]: { [iso(CURSOR)]: 4_321 } });
    await openAll(A);
    await files.goToTime(A, CURSOR);

    await openAll(D);

    expect(openedFile(D).anchorLine).toBe(4_321);
    expect(openedFile(D).timeJump).toBe(CURSOR);
    expect(timeQueries(D)).toEqual([iso(CURSOR)]);

    timeCursor.clear();
    await openAll(B);

    expect(openedFile(B).anchorLine).toBe(1);
    expect(lineNumbers(B)[0]).toBe(1);
    expect(timeQueries(B)).toEqual([]);
  });

  it('opens a file at a line it is given, not at the cursor', async () => {
    const { timeQueries } = await serveFiles({});
    await openAll(A);
    await files.goToTime(A, CURSOR);

    await files.openFile(D, { scrollToLine: 900, isIndexed: false });
    await settle();

    expect(openedFile(D).anchorLine).toBe(900);
    expect(timeQueries(D)).toEqual([]);
  });

  it('does not bring a file forward whose time range arrives while another tab is shown', async () => {
    let releaseRange = () => {};
    const heldRange = new Promise<void>((resolve) => (releaseRange = resolve));
    const { timeQueries } = await serveFiles(
      { [D]: { [iso(CURSOR)]: 4_321 } },
      { heldRanges: { [D]: heldRange } },
    );
    await openAll(A);
    await files.goToTime(A, CURSOR);
    await files.openFile(D, { isIndexed: false });
    await files.showTab(A);

    releaseRange();
    await settle();

    expect(get(files).activeFilePath).toBe(A);
    expect(timeQueries(D)).toEqual([]);

    await files.showTab(D);
    expect(openedFile(D).anchorLine).toBe(4_321);
  });

  it('clears the cursor: tabs shown then stay where they are, and no file keeps the time', async () => {
    const { timeQueries } = await serveFiles({ [A]: { [iso(CURSOR)]: 4_000 } });
    await openAll(A, B);
    await files.goToTime(A, CURSOR);

    files.clearTimeCursor();
    await files.showTab(B);

    expect(get(timeCursor)).toBeNull();
    expect(openedFile(A).timeJump).toBeNull();
    expect(openedFile(A).anchorLine).toBe(4_000);
    expect(openedFile(B).anchorLine).toBe(1);
    expect(timeQueries(B)).toEqual([]);
  });

  it('shows the message of a file that refuses a typed cursor and leaves it there; others follow', async () => {
    const message = 'a time of day needs a file of one day; this file spans 3 days';
    const { timeQueries } = await serveFiles({
      [A]: { '07:30': 4_000 },
      [B]: { '07:30': { status: 400, message } },
      [C]: { '07:30': 2_500 },
    });
    await openAll(A, B, C);
    await files.jumpToLine(B, 640);

    await files.goToTime(A, '07:30');
    await files.showTab(B);

    expect(openedFile(B).anchorLine).toBe(640);
    expect(openedFile(B).error).toBeNull();
    expect(get(notifications).map((n) => n.message)).toEqual([
      `Cannot go to the time cursor in postgresql.log: ${message}`,
    ]);

    await files.showTab(C);
    await files.showTab(B);

    expect(openedFile(C).anchorLine).toBe(2_500);
    expect(timeQueries(B)).toEqual(['07:30']);
    expect(get(timeCursor)?.instantMs).toBe(stampOf(4_000));
  });

  it('sets no cursor for a value the active file refuses, and keeps the one set before', async () => {
    const message = 'cannot read "07:61" as a time';
    const { timeQueries } = await serveFiles({
      [A]: { '07:61': { status: 400, message } },
      [B]: { [iso(CURSOR)]: 3_500 },
    });
    await openAll(A, B);
    await files.goToTime(A, CURSOR);
    const before = get(timeCursor);

    const outcome = await files.goToTime(A, '07:61');
    await files.showTab(B);

    expect(outcome).toEqual({ kind: 'refused', message });
    expect(get(timeCursor)).toEqual(before);
    expect(openedFile(A).anchorLine).toBe(1);
    expect(timeQueries(B)).toEqual([iso(CURSOR)]);
    expect(get(notifications)).toEqual([]);
  });

  it('shows the end of a tab whose last line is before the cursor, with the notice', async () => {
    await serveFiles({ [B]: { [iso(CURSOR)]: -1 } });
    await openAll(A, B);
    await files.goToTime(A, CURSOR);

    await files.showTab(B);

    expect(openedFile(B).anchorLine).toBe(10_000);
    expect(openedFile(B).reachedEnd).toBe(true);
    expect(get(notifications).map((n) => n.message)).toEqual([
      'No line at or after 2025-12-10 08:06:40.000 in postgresql.log',
    ]);
  });

  it('moves no file without timestamps and sets no cursor for a backend without time queries', async () => {
    const { timeQueries } = await serveFiles({}, { untimed: [B] });
    await openAll(A, B);
    await files.goToTime(A, CURSOR);

    await files.showTab(B);
    expect(timeQueries(B)).toEqual([]);

    timeCursor.clear();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonAnswer(200, { contract_version: '1.5' })),
    );
    await health.check();
    expect(await files.goToTime(A, CURSOR)).toEqual({ kind: 'unsupported' });
    expect(get(timeCursor)).toBeNull();
  });
});
