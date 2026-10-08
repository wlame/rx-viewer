import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { CHAIN_TASK_ID, FakeChain, T0_MS, serveChain, type FakePart } from '../testing/fakeChain';
import type { OpenFile } from '../types';
import { LOCAL_NUMBERING_BASE } from '../utils/chainWindow';
import { chainViewZones } from '../utils/chainZones';
import { LINES_PER_PAGE, STREAM_LINES_PER_PAGE } from '../utils/slidingWindow';
import { chainKey } from '../utils/tabKey';
import { chainMode } from './chainMode';
import { commandLog } from './commands';
import { files } from './files';
import { health } from './health';
import { notifications } from './notifications';

/** global 1-3000 in a gzip part, 3001-4500 in a plain one, 4501-6500 in the active file. */
const PARTS: FakePart[] = [
  { name: 'app.log.2.gz', lines: 3000, compression: 'gzip' },
  { name: 'app.log.1', lines: 1500, isIndexed: true },
  { name: 'app.log', lines: 2000, isActive: true },
];

const HANDLE = '/l/app.log';
const KEY = chainKey(HANDLE);

async function serve(options: Partial<ConstructorParameters<typeof FakeChain>[0]> = {}) {
  const chain = new FakeChain({ name: 'app.log', parts: PARTS, ...options });
  serveChain(chain);
  await health.check();
  chainMode.set(true);
  return chain;
}

function tab(): OpenFile {
  const found = get(files).openFiles.find((f) => f.path === KEY);
  if (!found) throw new Error('the chain tab is not open');
  return found;
}

/** The global numbers the held lines' text names, in order. */
function namedGlobals(): number[] {
  return tab().lines.map((line) => Number(/LINE (\d+)/.exec(line.content)?.[1]));
}

/**
 * Whether every held line's part and local line are the ones its text
 * names, and its position is its global number (`global`) or its part's
 * base plus its local line (`local`), one apart from the line before.
 */
function heldLinesAgree(numbering: 'global' | 'local'): boolean {
  const { lines, chain } = tab();
  return lines.every((line, i) => {
    const [, n, part, local] = /LINE (\d+) part=(\S+) local=(\d+)/.exec(line.content) ?? [];
    const position =
      numbering === 'global' ? Number(n) : (chain?.bases.get(part) ?? NaN) + Number(local);
    const isNext = i === 0 || line.lineNumber === lines[i - 1].lineNumber + 1;
    return (
      line.part === part &&
      line.localLine === Number(local) &&
      line.lineNumber === position &&
      isNext
    );
  });
}

function requestedLines(chain: FakeChain): string[] {
  return chain.samplesRequests.map((q) =>
    [q.get('part'), q.get('lines')].filter(Boolean).join(' '),
  );
}

afterEach(() => {
  for (const file of get(files).openFiles) files.closeFile(file.path);
  for (const shown of get(notifications)) notifications.dismiss(shown.id);
  commandLog.clear();
  chainMode.set(false);
  vi.unstubAllGlobals();
});

describe('a ready chain tab', () => {
  let chain: FakeChain;
  beforeEach(async () => {
    chain = await serve({ state: 'ready' });
  });

  it('opens at line 1 with global numbers, the first page sized by its gzip part', async () => {
    await files.openChain(HANDLE);

    const t = tab();
    expect(t.name).toBe('app.log');
    expect(t.chain?.numbering).toBe('global');
    expect(t.startLine).toBe(1);
    expect(t.endLine).toBe(STREAM_LINES_PER_PAGE);
    expect(heldLinesAgree('global')).toBe(true);
    expect(t.totalLines).toBe(6500);
    expect(t.isIndexed).toBe(true);
    expect(requestedLines(chain)).toEqual([`1-${STREAM_LINES_PER_PAGE}`]);
  });

  it('scrolls down across two part edges with continuous numbers and pages sized by part', async () => {
    await files.openChain(HANDLE);
    await files.loadMore(KEY, 'after');
    await files.loadMore(KEY, 'after');

    expect(namedGlobals()).toEqual(Array.from({ length: 6500 }, (_, i) => i + 1));
    expect(heldLinesAgree('global')).toBe(true);
    expect(tab().reachedEnd).toBe(true);
    expect(requestedLines(chain)).toEqual([
      `1-${STREAM_LINES_PER_PAGE}`,
      `5001-${5000 + LINES_PER_PAGE}`,
      `6001-${6000 + LINES_PER_PAGE}`,
    ]);
  });

  it('scrolls up from the end across two part edges', async () => {
    await files.openChain(HANDLE);
    await files.jumpToEnd(KEY);
    for (let i = 0; i < 4; i++) await files.loadMore(KEY, 'before');

    const t = tab();
    expect(t.startLine).toBe(1);
    expect(t.endLine).toBe(6500);
    expect(t.reachedStart).toBe(true);
    expect(heldLinesAgree('global')).toBe(true);
    expect(requestedLines(chain).slice(1)).toEqual([
      '-1',
      '5400-6399',
      '4400-5399',
      '3400-4399',
      '1-3399',
    ]);
  });

  it('puts a view zone above the first line of each part it holds, and none elsewhere', async () => {
    await files.openChain(HANDLE);
    await files.loadMore(KEY, 'after');

    const t = tab();
    const zones = chainViewZones(t.lines, t.chain!.description!);
    expect(zones.map((z) => [z.afterLineNumber, z.text.split(' · ')[0]])).toEqual([
      [0, 'app.log.2.gz'],
      [3000, 'app.log.1'],
      [4500, 'app.log'],
    ]);
  });

  it('goes to a global line, and to a line of a part, by global number', async () => {
    await files.openChain(HANDLE);

    await files.goToChainLine(KEY, { kind: 'global', line: 6000 });
    expect(tab().anchorLine).toBe(6000);
    expect(tab().chain?.anchor).toEqual({ part: 'app.log', line: 1500, timeMs: T0_MS + 6000_000 });

    await files.goToChainLine(KEY, { kind: 'local', part: 'app.log.1', line: 500 });
    expect(tab().anchorLine).toBe(3500);
    expect(tab().scrollToLine).toBe(3500);
  });

  it('sends the fingerprint it holds with every samples request', async () => {
    await files.openChain(HANDLE);
    await files.loadMore(KEY, 'after');

    expect(chain.samplesRequests.map((q) => q.get('fingerprint'))).toEqual([
      chain.fingerprint,
      chain.fingerprint,
    ]);
  });

  it('records the chain command of the window it opened, with each piece command under it', async () => {
    await files.openChain(HANDLE);

    const sent = chain.samplesRequests[0];
    expect(get(commandLog)[0]).toMatchObject({
      action: 'file',
      command: `rx logs samples ${HANDLE} --lines=${sent.get('lines')}`,
      details: [
        'rx samples /l/app.log.2.gz --lines=1-3000',
        'rx samples /l/app.log.1 --lines=1-1500',
        `rx samples /l/app.log --lines=1-${STREAM_LINES_PER_PAGE - 4500}`,
      ],
    });
  });

  it('reads the chain again by the anchor time when its files changed on disk', async () => {
    await files.openChain(HANDLE);
    files.setAnchorLine(KEY, 3500);
    chain.rotate();

    await files.loadMore(KEY, 'after');

    await vi.waitFor(() => expect(tab().loading).toBe(false));
    expect(get(notifications).some((n) => n.message.includes('changed on disk'))).toBe(true);
    expect(chain.samplesRequests.at(-1)?.getAll('timestamps')).toEqual([
      new Date(T0_MS + 3500_000).toISOString(),
    ]);
    expect(tab().anchorLine).toBe(3500);
  });

  it('shows the reasons of a chain that became invalid, and no lines', async () => {
    await files.openChain(HANDLE);
    chain.state = 'invalid';

    await files.jumpToEnd(KEY);

    expect(tab().lines).toEqual([]);
    expect(tab().chain?.invalidDetail).toContain('the chain is invalid');
  });
});

describe('a pending chain tab', () => {
  let chain: FakeChain;
  beforeEach(async () => {
    chain = await serve({ state: 'pending' });
  });

  it('opens at line 1 of its first part with part-local numbers', async () => {
    await files.openChain(HANDLE);

    const t = tab();
    expect(t.chain?.numbering).toBe('local');
    expect(t.lines[0]).toMatchObject({ part: 'app.log.2.gz', localLine: 1 });
    expect(t.startLine).toBe(LOCAL_NUMBERING_BASE + 1);
    expect(heldLinesAgree('local')).toBe(true);
    expect(t.totalLines).toBeNull();
    expect(requestedLines(chain)).toEqual([`app.log.2.gz 1-${STREAM_LINES_PER_PAGE}`]);
    expect(t.chain?.indexTask).toEqual({ taskId: CHAIN_TASK_ID, progress: null });
  });

  it('crosses into the next part at the edge, by pages of that part', async () => {
    await files.openChain(HANDLE);
    await files.loadMore(KEY, 'after');

    expect(namedGlobals()).toEqual(Array.from({ length: 4000 }, (_, i) => i + 1));
    expect(heldLinesAgree('local')).toBe(true);
    expect(requestedLines(chain).at(-1)).toBe(`app.log.1 1-${LINES_PER_PAGE}`);
  });

  it('pages back into an earlier part whose count it learns from its last lines', async () => {
    await files.openChain(HANDLE, { position: { kind: 'local', part: 'app.log.1', line: 1 } });
    await files.loadMore(KEY, 'before');
    await files.loadMore(KEY, 'before');

    expect(requestedLines(chain).slice(1)).toEqual(['app.log.2.gz -1', 'app.log.2.gz 1-2899']);
    expect(heldLinesAgree('local')).toBe(true);
    expect(namedGlobals()[0]).toBe(1);
    expect(tab().reachedStart).toBe(true);
  });

  it('switches to global numbers when the index task ends, on the same line', async () => {
    await files.openChain(HANDLE);
    await files.loadMore(KEY, 'after');
    const base = tab().chain!.bases.get('app.log.1')!;
    files.setAnchorLine(KEY, base + 20);
    expect(tab().chain?.anchor).toMatchObject({ part: 'app.log.1', line: 20 });

    chain.finishTask();

    await vi.waitFor(() => expect(tab().chain?.numbering).toBe('global'));
    await vi.waitFor(() => expect(tab().loading).toBe(false));
    expect(tab().anchorLine).toBe(3020);
    expect(tab().scrollToLine).toBe(3020);
    expect(heldLinesAgree('global')).toBe(true);
    expect(tab().chain?.indexTask).toBeNull();
  });

  // The backend drops a finished task from its table: a 404 means it ended.
  it('reads a 404 from the followed task as its end, and describes the chain again', async () => {
    vi.unstubAllGlobals();
    chain = await serve({ state: 'pending', taskEnd: 'gone' });
    await files.openChain(HANDLE);

    chain.finishTask();

    await vi.waitFor(() => expect(tab().chain?.numbering).toBe('global'));
  });

  it('stops following a task that is gone while the chain still names it', async () => {
    vi.unstubAllGlobals();
    chain = await serve({ state: 'pending', taskEnd: 'gone' });
    await files.openChain(HANDLE);

    chain.finishTask({ isReady: false });

    await vi.waitFor(() => expect(tab().chain?.indexProblem).toContain('cannot be followed'));
    expect(tab().chain?.indexTask).toBeNull();
    expect(tab().chain?.numbering).toBe('local');
  });

  it('goes to a line of a part before the chain is ready', async () => {
    await files.openChain(HANDLE);
    const requests = chain.samplesRequests.length;

    await files.goToChainLine(KEY, { kind: 'local', part: 'app.log', line: 7 });

    expect(chain.samplesRequests.length).toBe(requests + 1);
    expect(tab().lines.find((l) => l.lineNumber === tab().anchorLine)).toMatchObject({
      part: 'app.log',
      localLine: 7,
    });
  });
});

describe('opening a chain tab', () => {
  it('opens nothing, with a notice, while chain mode is off', async () => {
    await serve();
    chainMode.set(false);

    await files.openChain(HANDLE);

    expect(get(files).openFiles).toEqual([]);
    expect(get(notifications).length).toBe(1);
  });

  it('shows an invalid chain with its reasons and reads no line', async () => {
    const chain = await serve({
      state: 'invalid',
      reasons: [
        {
          code: 'overlap',
          parts: ['app.log.1', 'app.log'],
          message: 'they overlap',
          overlap_ms: 5,
        },
      ],
    });

    await files.openChain(HANDLE);

    expect(tab().chain?.description?.state).toBe('invalid');
    expect(tab().lines).toEqual([]);
    expect(tab().loading).toBe(false);
    expect(chain.samplesRequests).toEqual([]);
  });

  it('refuses a chain key given as a file to open', async () => {
    await serve();

    await expect(files.openFile(KEY)).rejects.toThrow('chain');
    expect(get(files).openFiles).toEqual([]);
  });
});
