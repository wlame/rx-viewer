import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { CHAIN_TASK_ID, FakeChain, T0_MS, serveChain, type FakePart } from '../testing/fakeChain';
import type { ChainResponse, FileLine, OpenFile } from '../types';
import { LOCAL_NUMBERING_BASE } from '../utils/chainWindow';
import { chainViewZones, chainZonesMemo, type EditorViewZone } from '../utils/chainZones';
import { LINES_PER_PAGE, STREAM_LINES_PER_PAGE } from '../utils/slidingWindow';
import { chainKey } from '../utils/tabKey';
import { timeLayoutOf } from '../utils/timeline';
import { chainMode } from './chainMode';
import { commandLog } from './commands';
import { fileZones } from './fileZones';
import { files } from './files';
import { health } from './health';
import { notifications } from './notifications';
import { timeCursor } from './timeCursor';
import { tree } from './tree';

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

  // At the top of the held lines a wheel turns no scroll, so no scroll
  // would ever ask for the page before.
  it('loads the page beyond a held line it goes to near an edge of the held lines', async () => {
    await files.openChain(HANDLE, { position: { kind: 'global', line: 3100 } });
    expect(tab().startLine).toBe(3000);

    await files.goToChainLine(KEY, { kind: 'local', part: 'app.log.1', line: 1 });

    await vi.waitFor(() => expect(tab().startLine).toBe(1));
    expect(tab().anchorLine).toBe(3001);
    expect(requestedLines(chain).at(-1)).toBe('1-2999');
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

  it('stops reading a chain whose files change at every request, after two reads again', async () => {
    await files.openChain(HANDLE);
    const requests = chain.samplesRequests.length;
    chain.keepsChanging = true;

    await files.loadMore(KEY, 'after');

    await vi.waitFor(() => expect(tab().error).toContain('keep changing'));
    expect(chain.samplesRequests.length - requests).toBe(3);
    expect(get(notifications).filter((n) => n.message.includes('changed on disk'))).toHaveLength(2);
    expect(tab().loading).toBe(false);
  });

  // The editor writes a line's number into its gutter as markup.
  it('opens with an error and no line when an answer numbers a piece with markup', async () => {
    chain.rewritePiece = (p) => ({ ...p, first_local_line: '<b>x</b>' as unknown as number });

    await files.openChain(HANDLE);

    expect(tab().error).toContain('not a whole number');
    expect(tab().lines).toEqual([]);
    expect(tab().loading).toBe(false);
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

  it('shows no line once the index task finds the chain invalid, and its reasons once', async () => {
    vi.unstubAllGlobals();
    const reasons = [
      {
        code: 'active_not_last' as const,
        parts: ['app.log'],
        message: 'it starts first',
        overlap_ms: null,
      },
    ];
    chain = await serve({ state: 'pending', reasons });
    await files.openChain(HANDLE);

    chain.finishTask({ isValid: false });

    await vi.waitFor(() => expect(tab().chain?.description?.state).toBe('invalid'));
    expect(tab().lines).toEqual([]);
    expect(tab().chain?.invalidDetail).toBeNull();
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

  // The lines the editor shows stay shown: an error in the tab would
  // replace the editor with it.
  it('keeps the held lines and says why in a notice when a page numbers a piece with a fraction', async () => {
    await files.openChain(HANDLE);
    const held = tab().lines;
    chain.rewritePiece = (p) => ({ ...p, first_local_line: 1.5 });

    await files.loadMore(KEY, 'after');

    expect(tab().lines).toBe(held);
    expect(tab().error).toBeNull();
    expect(tab().loading).toBe(false);
    expect(get(notifications).map((n) => [n.type, n.message])).toContainEqual([
      'error',
      expect.stringContaining('not a whole number'),
    ]);
  });

  // Every scroll at the edge would ask the refused page again.
  it('pages no further that way after a refused page', async () => {
    await files.openChain(HANDLE);
    await files.loadMore(KEY, 'after');
    chain.rewritePiece = (p) => ({ ...p, first_local_line: 1.5 });
    await files.loadMore(KEY, 'after');
    const requests = chain.samplesRequests.length;

    await files.loadMore(KEY, 'after');

    expect(chain.samplesRequests.length).toBe(requests);
    expect(tab().reachedEnd).toBe(true);
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

describe('the view zones of a chain tab', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * A chain of 10,000 parts, `agent.log.10099` to `agent.log.1` without
   * the 100 numbers 50, 150, …, 9950, and the active file.
   */
  function largeParts(): { parts: FakePart[]; missing: string[] } {
    const numbers = Array.from({ length: 100 }, (_, k) => 100 * k + 50);
    const absent = new Set(numbers);
    const parts: FakePart[] = [];
    for (let n = 10_099; n >= 1; n--) {
      if (!absent.has(n)) parts.push({ name: `agent.log.${n}`, lines: 2, key: String(n) });
    }
    parts.push({ name: 'agent.log', lines: 2, isActive: true });
    return { parts, missing: numbers.map((n) => `agent.log.${n}`) };
  }

  // The editor pane builds the zones through one memo on every update of
  // its tab; a build is an update whose lines or description are new.
  it('builds them once per description and held lines of a 10,000-part chain, never on a progress tick or an anchor move', async () => {
    const chain = await serve({ name: 'agent.log', state: 'pending', ...largeParts() });
    chain.progress = [0.25, 0.5, 0.75];
    const key = chainKey(chain.handle);
    const chainTab = () => get(files).openFiles.find((f) => f.path === key)!;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    const zonesOf = chainZonesMemo();
    const updates: { inputsChanged: boolean; zones: readonly EditorViewZone[] }[] = [];
    let last: { lines: readonly FileLine[]; description: ChainResponse } | null = null;
    const stop = files.subscribe((state) => {
      const t = state.openFiles.find((f) => f.path === key);
      const description = t?.chain?.description;
      if (!t || !description) return;
      const inputsChanged =
        last === null || last.lines !== t.lines || last.description !== description;
      last = { lines: t.lines, description };
      updates.push({ inputsChanged, zones: zonesOf(t.lines, description) });
    });
    const builds = () => new Set(updates.map((u) => u.zones)).size;
    const inputChanges = () => updates.filter((u) => u.inputsChanged).length;

    try {
      await files.openChain(chain.handle);
      await vi.waitFor(() => expect(chainTab().chain?.indexTask?.progress).toBe(0.25));
      const [updatesBefore, buildsBefore] = [updates.length, builds()];

      for (const progress of [0.5, 0.75]) {
        await vi.advanceTimersByTimeAsync(1000);
        await vi.waitFor(() => expect(chainTab().chain?.indexTask?.progress).toBe(progress));
      }
      files.setAnchorLine(key, chainTab().startLine + 1);
      files.setAnchorLine(key, chainTab().startLine);

      expect(updates.length - updatesBefore).toBeGreaterThanOrEqual(4);
      expect(builds()).toBe(buildsBefore);

      chain.finishTask();
      await vi.advanceTimersByTimeAsync(1000);
      await vi.waitFor(() => expect(chainTab().chain?.numbering).toBe('global'));
      await vi.waitFor(() => expect(chainTab().loading).toBe(false));

      expect(builds()).toBeGreaterThan(buildsBefore);
      expect(builds()).toBe(inputChanges());
      expect(chainTab().chain?.description?.missing).toHaveLength(100);
    } finally {
      stop();
    }
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

  it('tells the files panel what the description said of the chain', async () => {
    const reasons = [
      { code: 'overlap' as const, parts: ['app.log.1', 'app.log'], message: 'x', overlap_ms: 5 },
    ];
    await serve({ state: 'invalid', reasons });

    await files.openChain(HANDLE);

    expect(get(tree).describedChains.get(HANDLE)).toEqual({ state: 'invalid', reasons });
  });

  it('refuses a chain key given as a file to open', async () => {
    await serve();

    await expect(files.openFile(KEY)).rejects.toThrow('chain');
    expect(get(files).openFiles).toEqual([]);
  });
});

describe('a jump by time on a chain tab', () => {
  /** app.log.2.gz 1–3000, an hour with no lines, app.log.1 3001–4500, app.log 4501–6500. */
  const GAP_PARTS: FakePart[] = [
    { name: 'app.log.2.gz', lines: 3000, compression: 'gzip' },
    { name: 'app.log.1', lines: 1500, isIndexed: true, shiftSeconds: 3600 },
    { name: 'app.log', lines: 2000, isActive: true },
  ];
  /** The first time of app.log.1, after the gap. */
  const AFTER_GAP_MS = T0_MS + 6601_000;

  let chain: FakeChain;
  beforeEach(async () => {
    chain = await serve({ state: 'ready', parts: GAP_PARTS });
    await files.openChain(HANDLE);
  });

  afterEach(() => timeCursor.clear());

  function timeQueries(): string[] {
    return chain.samplesRequests.flatMap((q) => q.getAll('timestamps'));
  }

  it("lands a time in a gap on the next part's first line, the line the backend names", async () => {
    const inGap = T0_MS + 5000_000;

    const outcome = await files.jumpToTime(KEY, inGap);

    expect(outcome).toEqual({ kind: 'found', line: 3001 });
    expect(timeQueries()).toEqual([new Date(inGap).toISOString()]);
    expect(tab().anchorLine).toBe(3001);
    expect(tab().scrollToLine).toBe(3001);
    expect(tab().chain?.anchor).toEqual({ part: 'app.log.1', line: 1, timeMs: AFTER_GAP_MS });
    expect(heldLinesAgree('global')).toBe(true);
    expect(get(timeCursor)).toBe(inGap);
    expect(get(files).activeFilePath).toBe(KEY);
  });

  it('lands a time before the chain on its first line', async () => {
    const outcome = await files.jumpToTime(KEY, T0_MS - 3600_000);

    expect(outcome).toEqual({ kind: 'found', line: 1 });
    expect(tab().anchorLine).toBe(1);
    expect(tab().chain?.anchor?.part).toBe('app.log.2.gz');
  });

  it('shows the end with a notice for a time after the chain, and makes it the time cursor', async () => {
    const after = T0_MS + 20_000_000;

    const outcome = await files.jumpToTime(KEY, after);

    expect(outcome).toEqual({ kind: 'none' });
    expect(tab().endLine).toBe(6500);
    expect(tab().reachedEnd).toBe(true);
    expect(tab().anchorLine).toBe(6500);
    expect(get(notifications).some((n) => n.message.startsWith('No line at or after'))).toBe(true);
    expect(get(timeCursor)).toBe(after);
  });

  it('sends a typed time as typed, and makes the found line its time cursor', async () => {
    const outcome = await files.jumpToTime(KEY, '2026-10-01T00:50:00');

    expect(outcome).toEqual({ kind: 'found', line: 3000 });
    expect(timeQueries()).toEqual(['2026-10-01T00:50:00']);
    expect(get(timeCursor)).toBe(T0_MS + 3000_000);
  });

  it('refuses a time of day on a chain of several days and leaves the tab where it was', async () => {
    files.closeFile(KEY);
    chain = await serve({
      state: 'ready',
      parts: [GAP_PARTS[0], { ...GAP_PARTS[1], shiftSeconds: 2 * 86_400 }, GAP_PARTS[2]],
    });
    await files.openChain(HANDLE);
    const before = tab();

    const outcome = await files.jumpToTime(KEY, '00:30');

    expect(outcome.kind).toBe('refused');
    expect(outcome.kind === 'refused' && outcome.message).toContain('on one day');
    expect(tab().lines).toBe(before.lines);
    expect(tab().anchorLine).toBe(before.anchorLine);
    expect(tab().error).toBeNull();
    expect(tab().loading).toBe(false);
    expect(get(timeCursor)).toBeNull();
  });

  it('refuses a jump on a pending chain, saying why, and asks the backend nothing', async () => {
    files.closeFile(KEY);
    chain = await serve({ state: 'pending', parts: GAP_PARTS });
    await files.openChain(HANDLE);
    const sent = chain.samplesRequests.length;

    const outcome = await files.jumpToTime(KEY, T0_MS + 5000_000);

    expect(outcome).toEqual({
      kind: 'refused',
      message: 'app.log is not ready: the line indexes of its parts are being built',
    });
    expect(chain.samplesRequests.length).toBe(sent);
  });
});

describe('the zone of a chain tab', () => {
  /** Features of a backend that reads a file in a chosen zone. */
  const FEATURES = ['log_chains', 'samples_index_build', 'file_tz', 'time_range'];

  afterEach(() => {
    fileZones.clear(KEY);
    fileZones.clear(HANDLE);
  });

  function zonesOf(chain: FakeChain, route: string): (string | null)[] {
    return chain.requests
      .filter((request) => request.startsWith(route))
      .map((request) => new URL(request, 'http://localhost').searchParams.get('file_tz'));
  }

  it('keeps apart from the zone of the file at its handle, in every request of each', async () => {
    const chain = await serve({ state: 'ready', features: FEATURES });
    await files.openChain(HANDLE);
    await files.openFile(HANDLE);
    chain.requests.length = 0;

    await files.setFileZone(KEY, '+02:00');
    await files.setFileZone(HANDLE, '-05:00');
    await vi.waitFor(() => expect(zonesOf(chain, '/v1/time-range')).toEqual(['-05:00']));

    expect(zonesOf(chain, '/v1/logs/chain')).toEqual(['+02:00']);
    expect(zonesOf(chain, '/v1/logs/samples')).toEqual(['+02:00']);
    expect(zonesOf(chain, '/v1/samples')).toEqual(['-05:00']);
    expect(fileZones.zoneOf(KEY)).toBe('+02:00');
    expect(fileZones.zoneOf(HANDLE)).toBe('-05:00');
  });

  it('writes the times of its timeline in the zone chosen for it, on the same line', async () => {
    await serve({ state: 'ready', features: FEATURES });
    await files.openChain(HANDLE, { position: { kind: 'global', line: 3500 } });

    await files.setFileZone(KEY, '+02:00');

    expect(timeLayoutOf(tab())?.display_zone).toBe('+02:00');
    expect(tab().anchorLine).toBe(3500);
  });
});

describe('a pending chain that stays pending', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Serve `chain`, and keep the time of every task status request. */
  async function serveTimed(chain: FakeChain): Promise<number[]> {
    const statusTimes: number[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (url.includes('/v1/tasks/')) statusTimes.push(Date.now());
        return chain.fetch(url, init);
      }),
    );
    await health.check();
    chainMode.set(true);
    return statusTimes;
  }

  function describes(chain: FakeChain): number {
    return chain.requests.filter((r) => r.startsWith('/v1/logs/chain?')).length;
  }

  // A description that names an index task which has already ended (or
  // ends at once) every time would otherwise be followed in a tight loop.
  it('waits longer before each next index task it follows, and stops after five with a message', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const chain = new FakeChain({ name: 'app.log', parts: PARTS, state: 'pending' });
    const statusTimes = await serveTimed(chain);
    await files.openChain(HANDLE);

    chain.finishTask({ isReady: false });
    await vi.advanceTimersByTimeAsync(120_000);

    const gaps = statusTimes.slice(1).map((time, i) => time - statusTimes[i]);
    expect(gaps).toEqual([1000, 2000, 4000, 8000, 16_000]);
    expect(describes(chain)).toBe(7);
    expect(tab().chain?.indexProblem).toContain('still pending');
    expect(tab().chain?.indexTask).toBeNull();
    expect(tab().error).toBeNull();
  });

  it('describes a chain with no index task again after a few seconds, and keeps the reason in the tab', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const chain = new FakeChain({ name: 'app.log', parts: PARTS, state: 'pending' });
    chain.refusedBuild = 'no place for its index task';
    await serveTimed(chain);
    await files.openChain(HANDLE);

    expect(describes(chain)).toBe(1);
    expect(tab().chain?.buildRefused).toBe('no place for its index task');
    expect(tab().chain?.indexTask).toBeNull();
    expect(tab().lines.length).toBeGreaterThan(0);

    await vi.advanceTimersByTimeAsync(4900);
    expect(describes(chain)).toBe(1);
    chain.refusedBuild = null;
    await vi.advanceTimersByTimeAsync(200);

    expect(describes(chain)).toBe(2);
    expect(tab().chain?.buildRefused).toBeNull();
    expect(tab().chain?.indexTask).toEqual({ taskId: CHAIN_TASK_ID, progress: null });
  });

  it('takes the reason a samples answer about one part gives for no index task', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const chain = new FakeChain({ name: 'app.log', parts: PARTS, state: 'pending' });
    await serveTimed(chain);
    await files.openChain(HANDLE);
    chain.refusedBuild = 'no place for its index task';

    await files.loadMore(KEY, 'after');

    expect(tab().chain?.buildRefused).toBe('no place for its index task');
    const before = describes(chain);
    await vi.advanceTimersByTimeAsync(5100);
    expect(describes(chain)).toBe(before + 1);
  });

  it('stops describing a chain that never gets an index task, and says why', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const chain = new FakeChain({ name: 'app.log', parts: PARTS, state: 'pending' });
    chain.refusedBuild = 'no place for its index task';
    await serveTimed(chain);
    await files.openChain(HANDLE);

    await vi.advanceTimersByTimeAsync(3_600_000);

    expect(describes(chain)).toBe(9);
    expect(tab().chain?.indexProblem).toContain('no place for its index task');
  });
});

describe('a chain the backend is too busy for', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks again after the Retry-After of a 503, keeping its lines, with a notice', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const chain = await serve({ state: 'pending' });
    await files.openChain(HANDLE);
    const held = tab().lines;
    chain.busyAnswers = 1;
    chain.retryAfter = '2';

    const moving = files.goToChainLine(KEY, { kind: 'time', ms: T0_MS + 3500_000 });
    await vi.advanceTimersByTimeAsync(1900);

    expect(get(notifications).some((n) => n.message.includes('busy'))).toBe(true);
    expect(tab().lines).toBe(held);
    expect(tab().error).toBeNull();
    const asked = chain.samplesRequests.filter((q) => q.has('timestamps')).length;
    expect(asked).toBe(1);

    await vi.advanceTimersByTimeAsync(200);
    expect(chain.samplesRequests.filter((q) => q.has('timestamps')).length).toBe(2);
    chain.finishTask();
    await vi.advanceTimersByTimeAsync(2000);
    await moving;

    expect(tab().anchorLine).toBe(3500);
    expect(tab().error).toBeNull();
  });

  it('stops after three busy answers in a row, keeping its lines, and says so', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const chain = await serve({ state: 'pending' });
    await files.openChain(HANDLE);
    const held = tab().lines;
    chain.busyAnswers = 100;
    chain.retryAfter = null;

    const moving = files.goToChainLine(KEY, { kind: 'time', ms: T0_MS + 3500_000 });
    // Three waits of 5 s: the notice of the fourth answer is still on screen.
    await vi.advanceTimersByTimeAsync(15_100);
    await moving;

    expect(chain.samplesRequests.filter((q) => q.has('timestamps')).length).toBe(4);
    expect(tab().lines).toBe(held);
    expect(tab().loading).toBe(false);
    expect(tab().error).toBeNull();
    expect(get(notifications).some((n) => n.message.includes('still busy'))).toBe(true);
  });
});

describe('the files of a chain that keep changing', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stops at the third change within a minute, even with lines read between them', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const chain = await serve({ state: 'ready' });
    await files.openChain(HANDLE);

    for (let change = 1; change <= 3; change++) {
      chain.rotateTo([...chain.parts]);
      await files.jumpToEnd(KEY);
      await vi.waitFor(() => expect(tab().loading).toBe(false));
      vi.advanceTimersByTime(10_000);
    }

    expect(tab().error).toContain('keep changing');
    expect(get(notifications).filter((n) => n.message.includes('changed on disk'))).toHaveLength(2);
  });

  it('reads the chain again at each change more than a minute after the two before', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const chain = await serve({ state: 'ready' });
    await files.openChain(HANDLE);

    for (let change = 1; change <= 3; change++) {
      chain.rotateTo([...chain.parts]);
      await files.jumpToEnd(KEY);
      await vi.waitFor(() => expect(tab().loading).toBe(false));
      vi.advanceTimersByTime(31_000);
    }

    expect(tab().error).toBeNull();
    expect(get(notifications).filter((n) => n.message.includes('changed on disk'))).toHaveLength(3);
  });
});

describe('the zone of a chain tab the backend refuses', () => {
  const FEATURES = ['log_chains', 'samples_index_build', 'file_tz', 'time_range'];

  afterEach(() => {
    fileZones.clear(KEY);
  });

  it('drops the zone with a notice and reads the chain as its lines write times', async () => {
    const chain = await serve({ state: 'ready', features: FEATURES });
    chain.refusedZones.add('+02:00');
    await files.openChain(HANDLE, { position: { kind: 'global', line: 3500 } });

    await files.setFileZone(KEY, '+02:00');

    expect(fileZones.zoneOf(KEY)).toBeNull();
    expect(get(notifications).some((n) => n.message.includes('zone +02:00'))).toBe(true);
    expect(tab().error).toBeNull();
    expect(tab().anchorLine).toBe(3500);
    expect(chain.samplesRequests.at(-1)?.has('file_tz')).toBe(false);
  });
});

describe('a time jump on a chain tab whose zone changes', () => {
  const FEATURES = ['log_chains', 'samples_index_build', 'file_tz', 'time_range'];

  afterEach(() => {
    fileZones.clear(KEY);
    timeCursor.clear();
  });

  it('is cancelled by the zone change and asked once more in the new zone', async () => {
    const chain = await serve({ state: 'ready', features: FEATURES });
    await files.openChain(HANDLE);
    chain.holdSamples();

    const jump = files.jumpToTime(KEY, '2026-10-01T00:50:00');
    await vi.waitFor(() =>
      expect(chain.requests.filter((r) => r.includes('timestamps='))).toHaveLength(1),
    );
    const zoned = files.setFileZone(KEY, '+02:00');
    chain.releaseSamples();
    await zoned;

    const outcome = await jump;

    expect(outcome).toEqual({ kind: 'found', line: 3000 });
    const timeQueries = chain.samplesRequests.filter((q) => q.has('timestamps'));
    expect(timeQueries.at(-1)?.get('file_tz')).toBe('+02:00');
    expect(tab().anchorLine).toBe(3000);
  });
});

describe('a rotation while a chain tab is open', () => {
  /**
   * Three files whose lines keep their text and times under any name:
   * A (3000 lines from second 1), B (1500 from 3001) and C, the active
   * file (2000 lines from 4450, so its first lines share times with B's
   * last ones).
   */
  const A: FakePart = {
    name: 'app.log.2.gz',
    lines: 3000,
    compression: 'gzip',
    text: 'A',
    startSecond: 1,
    size: 60_000,
    modifiedAt: '2026-10-01T00:50:00.000000Z',
  };
  const B: FakePart = {
    name: 'app.log.1',
    lines: 1500,
    text: 'B',
    startSecond: 3001,
    size: 90_000,
    modifiedAt: '2026-10-01T01:15:00.000000Z',
  };
  const C: FakePart = {
    name: 'app.log',
    lines: 2000,
    isActive: true,
    text: 'C',
    startSecond: 4450,
    size: 120_000,
    modifiedAt: '2026-10-01T01:47:00.000000Z',
  };
  /** The rotation: A deleted, B compressed into app.log.2.gz, C renamed app.log.1, a new D. */
  const ROTATED: FakePart[] = [
    { ...B, name: 'app.log.2.gz', compression: 'gzip', size: 30_000 },
    { ...C, name: 'app.log.1', isActive: false },
    {
      name: 'app.log',
      lines: 10,
      isActive: true,
      text: 'D',
      startSecond: 6500,
      size: 600,
      modifiedAt: '2026-10-01T02:00:00.000000Z',
    },
  ];

  let chain: FakeChain;
  beforeEach(async () => {
    chain = await serve({ state: 'ready', parts: [A, B, C] });
  });

  /** The text of the line the tab is anchored on. */
  function anchorText(): string | undefined {
    const t = tab();
    return t.lines[t.anchorLine - t.startLine]?.content;
  }

  it('says what changed and shows the same line in the renamed part while the chain is pending', async () => {
    await files.openChain(HANDLE, { position: { kind: 'local', part: 'app.log.1', line: 500 } });
    const before = anchorText();
    expect(before).toContain('B local=500');

    chain.rotateTo(ROTATED, 'pending');
    await files.loadMore(KEY, 'after');
    await vi.waitFor(() => expect(tab().loading).toBe(false));

    expect(get(notifications).map((n) => n.message)).toContain(
      'Files of app.log changed on disk (renamed 2, new 1, removed 1); chain reloaded',
    );
    expect(anchorText()).toBe(before);
    expect(tab().chain?.anchor).toMatchObject({ part: 'app.log.2.gz', line: 500 });
    expect(chain.samplesRequests.at(-1)?.get('part')).toBe('app.log.2.gz');
  });

  // The time of the anchor line names the first line at or after it: a
  // line of B with the same time; the anchor's own text is 51 lines on.
  it('finds the anchor line again by its time and its text once the chain is ready', async () => {
    await files.openChain(HANDLE, { position: { kind: 'local', part: 'app.log', line: 20 } });
    const before = anchorText();
    expect(before).toContain('C local=20');

    chain.rotateTo(ROTATED, 'ready');
    await files.loadMore(KEY, 'after');
    await vi.waitFor(() => expect(tab().loading).toBe(false));

    expect(chain.samplesRequests.at(-1)?.getAll('timestamps')).toHaveLength(1);
    expect(anchorText()).toBe(before);
    expect(tab().anchorLine).toBe(1520);
    expect(tab().scrollToLine).toBe(1520);
    expect(tab().chain?.anchor).toMatchObject({ part: 'app.log.1', line: 20 });
  });

  it('becomes the file tab of the renamed part at its line when the chain is invalid after the change', async () => {
    await files.openChain(HANDLE, { position: { kind: 'local', part: 'app.log.1', line: 500 } });
    const before = anchorText();

    chain.rotateTo(ROTATED, 'invalid');
    await files.loadMore(KEY, 'after');

    await vi.waitFor(() =>
      expect(get(files).openFiles.map((f) => f.path)).toEqual(['/l/app.log.2.gz']),
    );
    const file = get(files).openFiles[0];
    await vi.waitFor(() => expect(get(files).openFiles[0].loading).toBe(false));
    const shown = get(files).openFiles[0];
    expect(shown.lines[shown.anchorLine - shown.startLine]?.content).toBe(before);
    expect(file.anchorLine).toBe(500);
    expect(get(notifications).some((n) => n.message.includes('no longer a valid log chain'))).toBe(
      true,
    );
  });

  it('closes with a notice when the chain is invalid and the file that held its line is gone', async () => {
    await files.openChain(HANDLE, { position: { kind: 'local', part: 'app.log.2.gz', line: 5 } });

    chain.rotateTo(ROTATED, 'invalid');
    await files.loadMore(KEY, 'after');

    await vi.waitFor(() => expect(get(files).openFiles).toEqual([]));
    expect(get(notifications).some((n) => n.message.includes('is gone'))).toBe(true);
  });

  it('becomes the file tab of its part when the handle names no chain any more', async () => {
    await files.openChain(HANDLE, { position: { kind: 'local', part: 'app.log', line: 20 } });
    const before = anchorText();

    chain.rotateTo([C]);
    chain.isGone = true;
    await files.loadMore(KEY, 'after');

    await vi.waitFor(() => expect(get(files).openFiles.map((f) => f.path)).toEqual(['/l/app.log']));
    await vi.waitFor(() => expect(get(files).openFiles[0].loading).toBe(false));
    const shown = get(files).openFiles[0];
    expect(shown.anchorLine).toBe(20);
    expect(shown.lines[shown.anchorLine - shown.startLine]?.content).toBe(before);
  });

  it('closes with a notice when the handle names no chain and its part is gone', async () => {
    await files.openChain(HANDLE, { position: { kind: 'local', part: 'app.log.1', line: 20 } });

    chain.rotateTo([C]);
    chain.isGone = true;
    await files.loadMore(KEY, 'after');

    await vi.waitFor(() => expect(get(files).openFiles).toEqual([]));
    expect(get(notifications).some((n) => n.message.includes('app.log.1 is gone'))).toBe(true);
  });

  it('becomes the file tab of its part when a jump by time finds the handle names no chain', async () => {
    await files.openChain(HANDLE, { position: { kind: 'local', part: 'app.log', line: 20 } });
    const before = anchorText();
    chain.rotateTo([C]);
    chain.isGone = true;

    const outcome = await files.jumpToTime(KEY, T0_MS + 4469_000);

    expect(outcome.kind).toBe('refused');
    await vi.waitFor(() => expect(get(files).openFiles.map((f) => f.path)).toEqual(['/l/app.log']));
    await vi.waitFor(() => expect(get(files).openFiles[0].loading).toBe(false));
    const shown = get(files).openFiles[0];
    expect(shown.lines[shown.anchorLine - shown.startLine]?.content).toBe(before);
  });

  it('asks a jump by time once more after the files changed, at the time asked', async () => {
    await files.openChain(HANDLE);
    chain.rotateTo(ROTATED, 'ready');

    const outcome = await files.jumpToTime(KEY, T0_MS + 4469_000);

    expect(outcome).toEqual({ kind: 'found', line: 1469 });
    expect(tab().anchorLine).toBe(1469);
    expect(get(notifications).some((n) => n.message.includes('changed on disk'))).toBe(true);
    timeCursor.clear();
  });

  it('says so in the box when the chain is pending after the change, and shows its line', async () => {
    await files.openChain(HANDLE, { position: { kind: 'local', part: 'app.log.1', line: 500 } });
    const before = anchorText();
    chain.rotateTo(ROTATED, 'pending');

    const outcome = await files.jumpToTime(KEY, T0_MS + 4469_000);

    expect(outcome.kind).toBe('refused');
    expect(outcome.kind === 'refused' && outcome.message).toContain('not ready');
    await vi.waitFor(() => expect(tab().loading).toBe(false));
    expect(anchorText()).toBe(before);
    timeCursor.clear();
  });
});
