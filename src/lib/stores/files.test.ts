import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { LINES_PER_PAGE, maxHeldLines } from '../utils/slidingWindow';
import { commandLog } from './commands';
import { files } from './files';

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
function serveFileOf(lineCount: number, { withCommand = false } = {}) {
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
      is_compressed: false,
      compression_format: null,
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
    await files.openFile('/logs/thousand.log', undefined, null, undefined, false);
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
    await files.openFile('/logs/empty.log', undefined, null, undefined, false);
    await files.loadMore('/logs/empty.log', 'after');

    const file = openedFile('/logs/empty.log');
    expect(file.error).toBeNull();
    expect(file.lines).toEqual([]);
    expect(file.reachedEnd).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it.each([
    { lineCount: 7, first: 1 },
    { lineCount: 300, first: 1 },
    { lineCount: 10_000, first: 9_500 },
  ])(
    'jumps to the end of a $lineCount-line file from line $first',
    async ({ lineCount, first }) => {
      serveFileOf(lineCount);
      const path = `/logs/lines-${lineCount}.log`;
      await files.openFile(path, undefined, null, undefined, false);

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
    await files.openFile('/logs/seven.log', 100_000, null, undefined, false);

    const file = openedFile('/logs/seven.log');
    expect(file.error).toBeNull();
    expect(lineNumbers('/logs/seven.log')).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(file.scrollToLine).toBe(7);
  });

  it('pages down again after a jump from the end back into the middle', async () => {
    serveFileOf(10_000);
    await files.openFile('/logs/long.log', undefined, null, undefined, false);
    await files.jumpToEnd('/logs/long.log');

    await files.jumpToLine('/logs/long.log', 5_000);

    const file = openedFile('/logs/long.log');
    expect(file.startLine).toBe(4_500);
    expect(file.endLine).toBe(5_500);
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
    await files.openFile(path, undefined, null, undefined, false);

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
    await files.openFile(path, undefined, null, undefined, false);
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
    await files.openFile(path, undefined, null, undefined, false);
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
    await files.openFile(path, undefined, null, undefined, false);
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
    await files.openFile('/logs/a.log', undefined, null, undefined, false);

    files.updateRegexFilter('/logs/a.log', 'LINE 1\\d', 'show');

    const filter = openedFile('/logs/a.log').regexFilter;
    expect(filter?.enabled).toBe(true);
    expect(filter?.pattern).toBe('LINE 1\\d');
    expect(filter?.mode).toBe('show');
    expect(filter?.compiledRegex).not.toBeNull();
  });

  it('keeps the filter of each file when another file gets one', async () => {
    serveFileOf(100);
    await files.openFile('/logs/a.log', undefined, null, undefined, false);
    await files.openFile('/logs/b.log', undefined, null, undefined, false);

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
    await files.openFile('/logs/a.log', undefined, null, undefined, false);
    expect(openedFile('/logs/a.log').anchorLine).toBe(1);
  });

  it('anchors a file opened at a line on that line', async () => {
    serveFileOf(1000);
    await files.openFile('/logs/a.log', 169, null, undefined, false);
    expect(openedFile('/logs/a.log').anchorLine).toBe(169);
  });

  it('anchors a jump on its target, loaded or not', async () => {
    serveFileOf(10_000);
    await files.openFile('/logs/a.log', undefined, null, undefined, false);

    await files.jumpToLine('/logs/a.log', 50);
    expect(openedFile('/logs/a.log').anchorLine).toBe(50);

    await files.jumpToLine('/logs/a.log', 7_000);
    expect(openedFile('/logs/a.log').anchorLine).toBe(7_000);
  });

  it('anchors the end of the file on its last line', async () => {
    serveFileOf(300);
    await files.openFile('/logs/a.log', undefined, null, undefined, false);
    await files.jumpToEnd('/logs/a.log');
    expect(openedFile('/logs/a.log').anchorLine).toBe(300);
  });

  it.each([1_200, 10 ** 12])(
    'moves a line %i past the end of a 1000-line file to line 1000',
    async (line) => {
      serveFileOf(1000);
      await files.openFile('/logs/a.log', line, null, undefined, false);

      const file = openedFile('/logs/a.log');
      expect(file.anchorLine).toBe(1000);
      expect(file.scrollToLine).toBe(1000);
    },
  );

  it('takes an anchor the editor reports after a scroll', async () => {
    serveFileOf(1000);
    await files.openFile('/logs/a.log', undefined, null, undefined, false);
    files.setAnchorLine('/logs/a.log', 415);
    expect(openedFile('/logs/a.log').anchorLine).toBe(415);
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
    await files.openFile('/logs/a.log', undefined, null, undefined, false);
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
    await files.openFile('/logs/a.log', undefined, null, undefined, false);
    await files.loadMore('/logs/a.log', 'after');

    expect(commands()).toEqual(['rx samples /logs/a.log --lines=1-1000']);
  });
});
