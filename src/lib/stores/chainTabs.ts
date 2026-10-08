/**
 * The tabs of log chains: open one, read its description, follow its
 * index task, load and page its lines in both states, and go to a line.
 *
 * A chain's tab is an open tab like a file's, keyed `chain:<handle>`
 * (`utils/tabKey.ts`), with its own fields in `OpenFile.chain`. Its
 * lines come from `/v1/logs/samples`: by global line once the chain is
 * ready, by a part's own lines before (`utils/chainWindow.ts` says how
 * they are numbered). The files store builds these functions with access
 * to its state (`createChainTabs`), and its own functions hand a chain's
 * key to them, so a module that moves a tab does not need to know which
 * kind of tab it moves.
 *
 * A chain feature acts only while chain mode is on and the backend
 * serves log chains (`chainModeOn`).
 */
import { get } from 'svelte/store';
import { api, ApiError, type LogSamplesAnswer, type LogSamplesParams } from '../api';
import { contractGate } from '../contractGate';
import type {
  ChainAnchor,
  ChainPart,
  ChainResponse,
  ChainSamplesResponse,
  ChainTab,
  FileLine,
  IndexBuild,
  OpenFile,
} from '../types';
import { isChainIndexed, neighbourPartWithLines } from '../utils/chainParts';
import {
  LOCAL_NUMBERING_BASE,
  anchorAt,
  chainPageSize,
  flattenPieces,
  globalPage,
  learnCounts,
  pageBase,
  pendingEnds,
  pendingPage,
  piecesOf,
  readChainTimeAnswer,
  readGlobalWindow,
} from '../utils/chainWindow';
import { defaultSyntaxHighlighting } from '../utils/highlighting';
import { LatestRequestMap, SUPERSEDED, isAbortError } from '../utils/latestRequest';
import type { SampleWindow } from '../utils/sampleWindow';
import { addPage, maxHeldLines } from '../utils/slidingWindow';
import { chainHandleOf, chainKey, type TabKey } from '../utils/tabKey';
import { watchTask } from '../utils/taskPolling';
import { chainMode, isChainModeOn } from './chainMode';
import { commandLog } from './commands';
import { requestZoneOf } from './fileZones';
import { health } from './health';
import { notifications } from './notifications';

/** Where a chain's tab goes: its start or end, a global line, a part's line, or a time. */
export type ChainPosition =
  | { kind: 'start' }
  | { kind: 'end' }
  | { kind: 'global'; line: number }
  | { kind: 'local'; part: string; line: number; timeMs?: number | null }
  | { kind: 'time'; ms: number };

/** What the files store hands the chain tabs: its tabs, and its request slot per tab. */
export interface ChainTabDeps {
  getTab(key: TabKey): OpenFile | undefined;
  /** Add a tab and make it the active one. */
  addTab(tab: OpenFile): void;
  /** Set some fields of an open tab; a closed tab is left alone. */
  patchTab(key: TabKey, fields: (tab: OpenFile) => Partial<OpenFile>): void;
  closeTab(key: TabKey): void;
  setActive(key: TabKey): void;
  /** The window loads of every tab, a newer one superseding an older one. */
  loads: LatestRequestMap;
  /** Open a file's tab at a line: a chain that is no longer one falls back to its part. */
  openFileAt(path: string, line: number): Promise<void>;
}

export interface OpenChainOptions {
  position?: ChainPosition;
  /** Highlighting as a link gives it, in place of the size-based default. */
  syntaxHighlighting?: boolean;
}

/** Lines asked before and after the target of a jump: the most the backend serves on a side. */
const JUMP_CONTEXT = 100;

/** 202 answers a load waits through before it gives up; each one is a task followed to its end. */
const MAX_WAITS = 3;

/** How long a notice about a chain stays on screen. */
const NOTICE_MS = 5000;

/** The statuses of a task that has not ended. */
const RUNNING_STATUSES: ReadonlySet<string> = new Set(['queued', 'running']);

const HTTP_NOT_FOUND = 404;

/** `Omit` over each member of a union, so the union stays one. */
type OmitEach<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A request of a chain's lines, without the handle: by lines (of a part), or by times. */
type ChainRequest = OmitEach<LogSamplesParams, 'handle'>;

/** The name of a chain from its handle: the last element of the path. */
function nameOf(handle: string): string {
  return handle.slice(handle.lastIndexOf('/') + 1);
}

/** The directory of a chain from its handle. */
function directoryOf(handle: string): string {
  return handle.slice(0, handle.lastIndexOf('/')) || '/';
}

/** The anchor a position names before its line is read: only a part's line names one. */
function anchorOfPosition(position: ChainPosition): ChainAnchor | null {
  if (position.kind !== 'local') return null;
  return { part: position.part, line: position.line, timeMs: position.timeMs ?? null };
}

/** A new chain tab, loading, with nothing known of the chain yet. */
function newChainTab(
  handle: string,
  position: ChainPosition,
  syntaxHighlighting: boolean,
): OpenFile {
  const chain: ChainTab = {
    handle,
    description: null,
    numbering: 'local',
    bases: new Map(),
    counts: new Map(),
    anchor: anchorOfPosition(position),
    indexTask: null,
    indexProblem: null,
    invalidDetail: null,
  };
  return {
    path: chainKey(handle),
    name: nameOf(handle),
    lines: [],
    totalLines: null,
    startLine: 1,
    endLine: 0,
    loading: true,
    error: null,
    isCompressed: false,
    compressionFormat: null,
    fileType: null,
    reachedStart: false,
    reachedEnd: false,
    syntaxHighlighting,
    fileSize: null,
    regexFilter: null,
    showInvisibleChars: false,
    wordWrap: false,
    isIndexed: false,
    anomalies: null,
    anomalySummary: null,
    selectedAnomalyCategory: null,
    anchorLine: 1,
    indexBuild: null,
    pendingIndex: null,
    backgroundIndexBuild: null,
    timeRange: null,
    isReadingTimeRange: false,
    timeJump: null,
    chain,
  };
}

/** The line counts a description gives: each frozen part's that is known, and 0 for an empty part. */
function countsOf(chain: ChainResponse): Map<string, number> {
  const counts = new Map<string, number>();
  for (const part of chain.parts) {
    if (part.size === 0) counts.set(part.name, 0);
    else if (!part.is_active && part.line_count !== null) counts.set(part.name, part.line_count);
  }
  return counts;
}

/** The position a target names in a chain as described: a gone part falls back to its time. */
function resolvePosition(position: ChainPosition, chain: ChainResponse): ChainPosition {
  if (position.kind !== 'local') return position;
  if (chain.parts.some((part) => part.name === position.part)) return position;
  const timeMs = position.timeMs ?? null;
  return timeMs === null ? { kind: 'start' } : { kind: 'time', ms: timeMs };
}

export function createChainTabs(deps: ChainTabDeps) {
  /** The description request of each chain tab; a newer one supersedes an older one. */
  const describes = new LatestRequestMap();
  /** The task each chain tab follows. */
  const follows = new Map<TabKey, { taskId: string; controller: AbortController }>();
  /** The task each chain tab last saw gone; a description that names it again is not followed. */
  const goneTasks = new Map<TabKey, string>();
  /** The chain tabs whose highlighting a link gave, which the size-based default leaves alone. */
  const highlightGiven = new Set<TabKey>();

  function chainOf(key: TabKey): ChainTab | undefined {
    return deps.getTab(key)?.chain;
  }

  function setChain(key: TabKey, fields: Partial<ChainTab>): void {
    deps.patchTab(key, (tab) => (tab.chain ? { chain: { ...tab.chain, ...fields } } : {}));
  }

  function handleOf(key: TabKey): string {
    const handle = chainHandleOf(key);
    if (handle === null) throw new Error(`${key} is not a log chain's tab`);
    return handle;
  }

  /** Show a failure in the tab, as a file's tab shows one. */
  function showError(key: TabKey, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    deps.patchTab(key, () => ({ loading: false, error: message, indexBuild: null }));
    console.error('Failed to read the log chain:', key, error);
  }

  /**
   * Why chain features cannot act now, or null when they can: chain mode
   * is off, or the backend does not serve log chains.
   */
  function refusal(): string | null {
    if (isChainModeOn(get(chainMode), get(health))) return null;
    return get(chainMode)
      ? 'This backend does not serve log chains'
      : 'Log chains are off: turn on chain mode to open one';
  }

  /** Stop following the task of the tab `key`; the backend's task runs on. */
  function stopFollow(key: TabKey): void {
    follows.get(key)?.controller.abort();
    follows.delete(key);
  }

  /**
   * Follow the chain's index task (or a part's build) that a description
   * or an answer names, and describe the chain again when it ends,
   * however it ends: completed, failed, or gone (404) from the backend's
   * table. A task that is not running is not followed, and neither is a
   * task the tab saw gone that a description names again.
   */
  function follow(key: TabKey, build: { task_id: string; status: string } | null): void {
    if (build === null || !RUNNING_STATUSES.has(build.status)) return;
    const taskId = build.task_id;
    if (follows.get(key)?.taskId === taskId) return;
    if (goneTasks.get(key) === taskId) {
      setChain(key, {
        indexTask: null,
        indexProblem: `The index task of ${nameOf(handleOf(key))} cannot be followed: the backend no longer knows it`,
      });
      return;
    }
    stopFollow(key);
    const entry = { taskId, controller: new AbortController() };
    follows.set(key, entry);
    const isCurrent = () => follows.get(key) === entry;
    setChain(key, { indexTask: { taskId, progress: null }, indexProblem: null });

    watchTask(taskId, {
      fetchStatus: (id, signal) => api.getTaskStatus(id, { signal }),
      signal: entry.controller.signal,
      onStatus: (task) => {
        if (isCurrent()) setChain(key, { indexTask: { taskId, progress: task.progress } });
      },
    }).then(
      (end) => {
        if (!isCurrent()) return;
        follows.delete(key);
        if (end.kind === 'gone') goneTasks.set(key, taskId);
        else goneTasks.delete(key);
        setChain(key, { indexTask: null });
        void refresh(key);
      },
      (error: unknown) => {
        if (!isCurrent() || isAbortError(error)) return;
        follows.delete(key);
        const reason = error instanceof Error ? error.message : String(error);
        setChain(key, {
          indexTask: null,
          indexProblem: `The index task cannot be followed: ${reason}`,
        });
      },
    );
  }

  /**
   * Keep a description in the tab: its state, the counts it gives, `idx`,
   * the chain's size and line count, and the index task a pending chain
   * waits for, which the tab follows.
   */
  function applyDescription(key: TabKey, chain: ChainResponse, isChanged: boolean): void {
    const size = chain.parts.reduce((sum, part) => sum + part.size, 0);
    const isHighlightGiven = highlightGiven.has(key);
    deps.patchTab(key, (tab) => {
      const held = tab.chain;
      if (!held) return {};
      const counts = isChanged ? countsOf(chain) : new Map([...held.counts, ...countsOf(chain)]);
      const failed = chain.state === 'pending' && chain.index_build?.status === 'failed';
      return {
        chain: {
          ...held,
          description: chain,
          counts,
          invalidDetail: null,
          indexProblem: failed ? (chain.index_build?.message ?? null) : held.indexProblem,
        },
        isIndexed: isChainIndexed(chain.parts),
        totalLines: chain.state === 'ready' ? chain.line_count : null,
        fileSize: size,
        // The size-based default applies when the chain is first described.
        syntaxHighlighting:
          isHighlightGiven || held.description !== null
            ? tab.syntaxHighlighting
            : defaultSyntaxHighlighting(size),
      };
    });
    if (chain.state === 'pending') follow(key, chain.index_build);
  }

  /**
   * Describe the chain of the tab `key` and keep the description. A
   * description the tab already holds is sent back by its fingerprint,
   * so a chain whose files changed answers as changed. Null when the
   * request was superseded or failed (the tab says why), or the handle
   * names no chain (the tab closes).
   */
  async function describe(
    key: TabKey,
  ): Promise<{ chain: ChainResponse; isChanged: boolean } | null> {
    const handle = handleOf(key);
    const fingerprint = chainOf(key)?.description?.fingerprint;
    try {
      const answer = await describes.run(key, (signal) =>
        api.logChain(handle, { signal, fileTz: requestZoneOf(key), fingerprint }),
      );
      if (answer === SUPERSEDED) return null;
      const isChanged = answer.kind === 'changed';
      applyDescription(key, answer.chain, isChanged);
      return { chain: answer.chain, isChanged };
    } catch (error) {
      if (isAbortError(error)) return null;
      if (error instanceof ApiError && error.status === HTTP_NOT_FOUND) {
        await closeAsNoChain(key);
        return null;
      }
      showError(key, error);
      return null;
    }
  }

  /**
   * The handle names no chain (any more): the tab closes, and the part
   * that held its anchor opens as a file at the anchor's line when the
   * tab knows one; otherwise a notice says why.
   */
  async function closeAsNoChain(key: TabKey): Promise<void> {
    const handle = handleOf(key);
    const anchor = chainOf(key)?.anchor ?? null;
    forget(key);
    deps.closeTab(key);
    if (anchor === null) {
      notifications.error(`${handle} is not a log chain`, NOTICE_MS);
      return;
    }
    await deps.openFileAt(`${directoryOf(handle)}/${anchor.part}`, anchor.line);
  }

  /**
   * The lines a request asks for, after any index task the backend
   * answers 202 with: the load shows the task, follows it to its end,
   * describes the chain again and asks once more. Each request carries
   * the tab's zone and the fingerprint of its description.
   */
  async function loadChainSamples(
    key: TabKey,
    request: ChainRequest,
    signal: AbortSignal,
  ): Promise<Exclude<LogSamplesAnswer, { kind: 'building' }>> {
    await contractGate.pass(signal);
    const params = { handle: handleOf(key), ...request } as LogSamplesParams;
    for (let waits = 0; ; waits++) {
      const answer = await api.logSamples(params, {
        signal,
        respondAsync: true,
        fileTz: requestZoneOf(key),
        fingerprint: chainOf(key)?.description?.fingerprint,
      });
      if (answer.kind !== 'building') {
        if (waits > 0) deps.patchTab(key, () => ({ indexBuild: null }));
        return answer;
      }
      if (waits >= MAX_WAITS) {
        throw new Error(
          `The line indexes of ${nameOf(params.handle)} are still being built; try again later`,
        );
      }
      const taskId = answer.task.task_id;
      const showBuild = (build: IndexBuild) => deps.patchTab(key, () => ({ indexBuild: build }));
      showBuild({ taskId, progress: null });
      await watchTask(taskId, {
        fetchStatus: (id, statusSignal) => api.getTaskStatus(id, { signal: statusSignal }),
        signal,
        onStatus: (task) => showBuild({ taskId, progress: task.progress }),
      });
      await describe(key);
    }
  }

  /** The request that shows `position` in a chain as described. */
  function requestFor(
    position: ChainPosition,
    chain: ChainResponse,
    counts: ReadonlyMap<string, number>,
  ): ChainRequest | null {
    const isReady = chain.state === 'ready';
    switch (position.kind) {
      case 'start': {
        if (isReady) {
          const page = globalPage({ startLine: 1, endLine: 0 }, 'after', chain.parts);
          return { lines: [`${page.first}-${page.last}`] };
        }
        const first = neighbourPartWithLines(chain.parts, null, 'after', counts);
        if (first === null) return null;
        return { part: first.name, lines: [`1-${chainPageSize(chain.parts, [first.name])}`] };
      }
      case 'end': {
        if (isReady) return { lines: ['-1'], context: JUMP_CONTEXT };
        const last = neighbourPartWithLines(chain.parts, null, 'before', counts);
        if (last === null) return null;
        return { part: last.name, lines: ['-1'], beforeContext: JUMP_CONTEXT, afterContext: 0 };
      }
      case 'global':
        return { lines: [String(position.line)], context: JUMP_CONTEXT };
      case 'local':
        return { part: position.part, lines: [String(position.line)], context: JUMP_CONTEXT };
      case 'time':
        return { timestamps: [new Date(position.ms).toISOString()], context: JUMP_CONTEXT };
    }
  }

  /**
   * The global line a ready answer's request names: the line itself, a
   * part's line in the chain, the line a time found, the chain's last
   * line, or line 1; null when the chain has no such line.
   */
  function globalTarget(
    position: ChainPosition,
    answer: ChainSamplesResponse,
    lastLine: number,
  ): number | null {
    const named = (values: Record<string, number>) => {
      const line = Object.values(values)[0];
      return line === undefined || line < 1 ? null : line;
    };
    switch (position.kind) {
      case 'start':
        return 1;
      case 'end':
        return lastLine;
      case 'time':
        return named(answer.timestamps);
      default:
        return named(answer.lines);
    }
  }

  /** Show the window of a ready chain's answer, by global numbers. */
  function showGlobalWindow(key: TabKey, position: ChainPosition, answer: ChainSamplesResponse) {
    const value = position.kind === 'time' ? new Date(position.ms).toISOString() : null;
    const time = value === null ? null : readChainTimeAnswer(answer, value);
    const lines = flattenPieces(piecesOf(answer), { kind: 'global' });
    const lastLine = lines.at(-1)?.lineNumber ?? 0;
    const target = globalTarget(position, answer, lastLine);
    // A target's own key reads the window's ends: the line or the time
    // with its context, or the range asked. A part's line past the part's
    // end names none, and its window says nothing of the chain's end.
    let window: SampleWindow;
    if (time?.found === true) window = time.window;
    else if (position.kind === 'start' || position.kind === 'end')
      window = readGlobalWindow(answer);
    else if (target !== null) {
      window = readGlobalWindow({ ...answer, samples: { [String(target)]: piecesOf(answer) } });
    } else
      window = {
        lines,
        reachedStart: lines[0]?.lineNumber === 1,
        reachedEnd: false,
        lineCount: null,
      };
    const anchorLine = target ?? lastLine;
    const reachedEnd = position.kind === 'end' || window.reachedEnd;
    deps.patchTab(key, (tab) => ({
      lines: window.lines,
      startLine: window.lines[0]?.lineNumber ?? 1,
      endLine: lastLine,
      reachedStart: (window.lines[0]?.lineNumber ?? 1) === 1,
      reachedEnd,
      totalLines: reachedEnd ? lastLine : tab.totalLines,
      scrollToLine: anchorLine,
      anchorLine,
      timeJump: null,
      chain: tab.chain && {
        ...tab.chain,
        numbering: 'global',
        bases: new Map(),
        counts: learnCounts(tab.chain.counts, piecesOf(answer)),
        anchor:
          anchorAt(window.lines, window.lines[0]?.lineNumber ?? 1, anchorLine) ?? tab.chain.anchor,
      },
    }));
  }

  /** Show the window of a pending chain's answer, which reads one part, from a new base. */
  function showLocalWindow(key: TabKey, request: ChainRequest, answer: ChainSamplesResponse) {
    const part = 'part' in request ? (request.part ?? null) : null;
    if (part === null) throw new Error('A pending chain answered a request of no part');
    const pieces = piecesOf(answer);
    const bases = new Map([[part, LOCAL_NUMBERING_BASE]]);
    const lines = flattenPieces(pieces, { kind: 'local', bases });
    const asked = 'lines' in request ? request.lines[0] : '';
    const local = /^\d+$/.test(asked) ? Number(asked) : null;
    const startLine = lines[0]?.lineNumber ?? 1;
    const lastLine = lines.at(-1)?.lineNumber ?? 0;
    const named = local === null ? null : LOCAL_NUMBERING_BASE + local;
    const anchorLine =
      asked === '-1' ? lastLine : named !== null && named <= lastLine ? named : startLine;
    deps.patchTab(key, (tab) => {
      const held = tab.chain;
      if (!held?.description) return {};
      const counts = learnCounts(held.counts, pieces);
      const ends = pendingEnds(lines, held.description.parts, counts);
      return {
        lines,
        startLine,
        endLine: lastLine,
        ...ends,
        totalLines: null,
        scrollToLine: anchorLine,
        anchorLine,
        timeJump: null,
        chain: {
          ...held,
          numbering: 'local',
          bases,
          counts,
          anchor: anchorAt(lines, startLine, anchorLine) ?? held.anchor,
        },
      };
    });
  }

  /**
   * Load and show the window of `position` in the chain of the tab `key`:
   * by global numbers once the chain is ready, from a part before. The
   * answer's command, with each piece's command, goes to the command line
   * when `record` holds (a user's step, not a page while scrolling).
   */
  async function show(key: TabKey, position: ChainPosition, record = true): Promise<void> {
    const held = chainOf(key);
    const chain = held?.description;
    if (!held || !chain) return;
    const target = resolvePosition(position, chain);
    const request = requestFor(target, chain, held.counts);
    if (request === null) {
      deps.patchTab(key, () => ({
        lines: [],
        startLine: 1,
        endLine: 0,
        loading: false,
        reachedStart: true,
        reachedEnd: true,
      }));
      return;
    }
    deps.patchTab(key, () => ({ loading: true, error: null }));
    let answer: Awaited<ReturnType<typeof loadChainSamples>> | typeof SUPERSEDED;
    try {
      answer = await deps.loads.run(key, (signal) => loadChainSamples(key, request, signal));
    } catch (error) {
      if (!isAbortError(error)) showError(key, error);
      return;
    }
    if (answer === SUPERSEDED) return;
    await applyAnswer(key, target, request, answer, record);
  }

  /** What a window's answer does to the tab: its lines, a changed chain, or an invalid one. */
  async function applyAnswer(
    key: TabKey,
    position: ChainPosition,
    request: ChainRequest,
    answer: Exclude<LogSamplesAnswer, { kind: 'building' }>,
    record: boolean,
  ): Promise<void> {
    if (answer.kind === 'changed') {
      await readAgainAfterChange(key, answer.chain);
      return;
    }
    if (answer.kind === 'invalid') {
      showInvalid(key, answer.detail);
      return;
    }
    const samples = answer.samples;
    if (
      position.kind === 'time' &&
      readChainTimeAnswer(samples, new Date(position.ms).toISOString()).found === false
    ) {
      notifications.info(
        `No line at or after ${new Date(position.ms).toISOString()} in ${nameOf(handleOf(key))}`,
      );
      await show(key, { kind: 'end' }, record);
      return;
    }
    const isEmpty = piecesOf(samples).length === 0;
    if (isEmpty && position.kind !== 'start' && position.kind !== 'end') {
      // A line past the end: the end is the nearest lines that exist.
      await show(key, { kind: 'end' }, record);
      return;
    }
    if (samples.state === 'ready') showGlobalWindow(key, position, samples);
    else showLocalWindow(key, request, samples);
    deps.patchTab(key, () => ({ loading: false, error: null, indexBuild: null }));
    if (record)
      commandLog.record(
        samples.cli_command,
        'file',
        piecesOf(samples).map((p) => p.cli_command),
      );
    follow(key, samples.index_build);
  }

  /** The chain cannot be read as one text: no lines, and the backend's reasons. */
  function showInvalid(key: TabKey, detail: string): void {
    deps.patchTab(key, (tab) => ({
      lines: [],
      startLine: 1,
      endLine: 0,
      loading: false,
      reachedStart: true,
      reachedEnd: true,
      chain: tab.chain && { ...tab.chain, invalidDetail: detail },
    }));
  }

  /**
   * The chain's files changed on disk (a rotation): keep its current
   * description, drop the lines, and find the anchor line again by its
   * time once the chain is ready, else by its part when that still
   * exists, else show the start.
   */
  async function readAgainAfterChange(key: TabKey, chain: ChainResponse): Promise<void> {
    notifications.info(
      `Files of ${chain.name} changed on disk; the chain was read again`,
      NOTICE_MS,
    );
    applyDescription(key, chain, true);
    const anchor = chainOf(key)?.anchor ?? null;
    deps.patchTab(key, () => ({ lines: [], startLine: 1, endLine: 0 }));
    if (chain.state === 'invalid') {
      deps.patchTab(key, () => ({ loading: false }));
      return;
    }
    let position: ChainPosition = { kind: 'start' };
    if (anchor?.timeMs != null && chain.state === 'ready')
      position = { kind: 'time', ms: anchor.timeMs };
    else if (anchor !== null)
      position = { kind: 'local', part: anchor.part, line: anchor.line, timeMs: anchor.timeMs };
    await show(key, position, false);
  }

  /**
   * Describe the chain again (its index task ended): a chain that became
   * ready while the tab numbers its lines by part shows the same line by
   * its global number; a changed chain is read again.
   */
  async function refresh(key: TabKey): Promise<void> {
    const before = chainOf(key);
    if (!before) return;
    const described = await describe(key);
    if (described === null) return;
    const { chain, isChanged } = described;
    if (isChanged) {
      await readAgainAfterChange(key, chain);
      return;
    }
    if (chain.state === 'invalid') {
      showInvalid(key, chain.reasons.map((reason) => reason.message).join('; '));
      return;
    }
    // A load in flight answers by global numbers itself once the chain is ready.
    const isLoading = deps.getTab(key)?.loading ?? false;
    if (chain.state === 'ready' && before.numbering === 'local' && !isLoading) {
      await showAnchorLine(key, false);
    }
  }

  /** Show the tab's anchor line again, by its part and its line in it; the start without one. */
  async function showAnchorLine(key: TabKey, record: boolean): Promise<void> {
    const anchor = chainOf(key)?.anchor ?? null;
    const position: ChainPosition =
      anchor === null
        ? { kind: 'start' }
        : { kind: 'local', part: anchor.part, line: anchor.line, timeMs: anchor.timeMs };
    await show(key, position, record);
  }

  /**
   * Open the tab of the chain `handle` at `position` (its start by
   * default), or bring it forward and move it there. The tab is in the
   * store before the first request, and it closes with a notice when
   * chain features cannot act; an invalid chain shows its reasons and no
   * lines.
   */
  async function openChain(handle: string, options: OpenChainOptions = {}): Promise<void> {
    const { position = { kind: 'start' }, syntaxHighlighting } = options;
    const key = chainKey(handle);
    if (deps.getTab(key)) {
      deps.setActive(key);
      if (position.kind !== 'start') await moveTo(key, position);
      return;
    }
    if (syntaxHighlighting !== undefined) highlightGiven.add(key);
    deps.addTab(newChainTab(handle, position, syntaxHighlighting ?? true));

    await contractGate.pass();
    const refused = refusal();
    if (refused !== null) {
      forget(key);
      deps.closeTab(key);
      notifications.info(`${refused} (${handle})`, NOTICE_MS);
      return;
    }
    const described = await describe(key);
    if (described === null) return;
    if (described.chain.state === 'invalid') {
      deps.patchTab(key, () => ({ loading: false }));
      return;
    }
    await show(key, position);
  }

  /** The position of `target` among the held lines, or null when they do not hold it. */
  function heldPosition(tab: OpenFile, target: ChainPosition): number | null {
    const chain = tab.chain;
    if (!chain) return null;
    let position: number | null = null;
    if (target.kind === 'global' && chain.numbering === 'global') position = target.line;
    if (target.kind === 'local') {
      const base = chain.numbering === 'local' ? chain.bases.get(target.part) : undefined;
      const start =
        chain.description?.parts.find((p) => p.name === target.part)?.global_start ?? null;
      if (base !== undefined) position = base + target.line;
      else if (chain.numbering === 'global' && start !== null) position = start + target.line - 1;
    }
    if (position === null) return null;
    const line = tab.lines[position - tab.startLine];
    const isHeld = line?.lineNumber === position;
    const isSamePart = target.kind !== 'local' || line?.part === target.part;
    return isHeld && isSamePart ? position : null;
  }

  /**
   * Move the tab `key` to `position`: at once when it holds that line,
   * otherwise by loading the window around it. The tab becomes active.
   */
  async function moveTo(key: TabKey, position: ChainPosition): Promise<void> {
    const tab = deps.getTab(key);
    if (!tab?.chain) return;
    deps.setActive(key);
    const held = heldPosition(tab, position);
    if (held !== null) {
      deps.patchTab(key, (t) => ({
        scrollToLine: held,
        anchorLine: held,
        timeJump: null,
        chain: t.chain && {
          ...t.chain,
          anchor: anchorAt(t.lines, t.startLine, held) ?? t.chain.anchor,
        },
      }));
      return;
    }
    await show(key, position);
  }

  /**
   * Load the page before or after the held lines, as a scroll near an
   * edge asks: by global range once the chain is ready, from the part at
   * the edge before. An answer that finds the chain ready, or no longer
   * ready, describes it again instead of mixing two numberings.
   */
  async function loadMore(key: TabKey, direction: 'before' | 'after'): Promise<void> {
    const tab = deps.getTab(key);
    const chain = tab?.chain;
    const description = chain?.description;
    if (!tab || !chain || !description || tab.loading || tab.lines.length === 0) return;
    if (direction === 'before' ? tab.reachedStart : tab.reachedEnd) return;

    const edge = direction === 'after' ? tab.lines[tab.lines.length - 1] : tab.lines[0];
    let request: ChainRequest;
    if (chain.numbering === 'global') {
      const page = globalPage(tab, direction, description.parts);
      request = { lines: [`${page.first}-${page.last}`] };
    } else {
      if (edge.part === undefined || edge.localLine === undefined) return;
      const page = pendingPage(
        { part: edge.part, localLine: edge.localLine },
        direction,
        description.parts,
        chain.counts,
      );
      if (page === null) {
        deps.patchTab(key, () =>
          direction === 'before' ? { reachedStart: true } : { reachedEnd: true },
        );
        return;
      }
      request = {
        part: page.part,
        lines: [page.lines],
        beforeContext: page.beforeContext,
        afterContext: page.afterContext,
      };
    }

    deps.patchTab(key, () => ({ loading: true }));
    let answer: Awaited<ReturnType<typeof loadChainSamples>> | typeof SUPERSEDED;
    try {
      answer = await deps.loads.run(key, (signal) => loadChainSamples(key, request, signal));
    } catch (error) {
      if (isAbortError(error)) return;
      deps.patchTab(key, () => ({ loading: false }));
      console.error('Failed to load more lines of the log chain:', key, error);
      return;
    }
    if (answer === SUPERSEDED) return;
    if (answer.kind !== 'samples') {
      await applyAnswer(key, { kind: 'start' }, request, answer, false);
      return;
    }
    const samples = answer.samples;
    const isGlobal = chain.numbering === 'global';
    if ((samples.state === 'ready') !== isGlobal) {
      deps.patchTab(key, () => ({ loading: false }));
      await refresh(key);
      return;
    }
    if (isGlobal) addGlobalPage(key, direction, samples);
    else addLocalPage(key, direction, edge.part ?? '', request, samples);
    follow(key, samples.index_build);
  }

  /**
   * The most lines a chain's tab holds after a page: five pages of the
   * largest page size among the parts the held lines and the page come
   * from, so lines of a stream part, the costly ones to read again, are
   * not dropped for a plain part's smaller pages.
   */
  function chainHeldLines(
    parts: readonly ChainPart[],
    held: readonly FileLine[],
    page: readonly FileLine[],
  ): number {
    const names = new Set<string>();
    for (const line of [...held, ...page]) if (line.part !== undefined) names.add(line.part);
    return maxHeldLines(chainPageSize(parts, [...names]));
  }

  /** Add a page of a ready chain to the held lines, as a file's page is added. */
  function addGlobalPage(key: TabKey, direction: 'before' | 'after', answer: ChainSamplesResponse) {
    const window = readGlobalWindow(answer);
    deps.patchTab(key, (tab) => {
      const parts = tab.chain?.description?.parts ?? [];
      const cap = chainHeldLines(parts, tab.lines, window.lines);
      const held = addPage(tab.lines, window.lines, direction, cap);
      const startLine = held.lines[0]?.lineNumber ?? 1;
      const endLine = held.lines.at(-1)?.lineNumber ?? 0;
      const reachedEnd = direction === 'after' ? window.reachedEnd : tab.reachedEnd;
      return {
        lines: held.lines,
        startLine,
        endLine,
        reachedStart: startLine === 1,
        reachedEnd: reachedEnd && !held.droppedAfter,
        totalLines: direction === 'after' && reachedEnd ? endLine : tab.totalLines,
        loading: false,
        chain: tab.chain && {
          ...tab.chain,
          counts: learnCounts(tab.chain.counts, piecesOf(answer)),
        },
      };
    });
  }

  /**
   * Add a page of a pending chain to the held lines. A page of the part
   * after or before the edge part gets its base from the counts it needs;
   * a page with no line tells where its part ends.
   */
  function addLocalPage(
    key: TabKey,
    direction: 'before' | 'after',
    edgePart: string,
    request: ChainRequest,
    answer: ChainSamplesResponse,
  ) {
    const pagePart = 'part' in request ? (request.part ?? '') : '';
    const pieces = piecesOf(answer);
    deps.patchTab(key, (tab) => {
      const chain = tab.chain;
      if (!chain?.description) return { loading: false };
      const counts = learnCounts(chain.counts, pieces);
      if (pieces.length === 0 && direction === 'before')
        return { loading: false, reachedStart: true };
      if (pieces.length === 0) {
        // Nothing past the edge: the part ends at the edge, or holds no line.
        const asked = 'lines' in request ? request.lines[0] : '';
        const from = Number(/^(\d+)-/.exec(asked)?.[1] ?? 1);
        counts.set(pagePart, from - 1);
        const ends = pendingEnds(tab.lines, chain.description.parts, counts);
        return { loading: false, ...ends, chain: { ...chain, counts } };
      }
      const base = pageBase(chain.bases, counts, edgePart, pagePart, direction);
      if (base === null) return { loading: false };
      const bases = new Map(chain.bases).set(pagePart, base);
      const page = flattenPieces(pieces, { kind: 'local', bases });
      const cap = chainHeldLines(chain.description.parts, tab.lines, page);
      const held = addPage(tab.lines, page, direction, cap);
      const ends = pendingEnds(held.lines, chain.description.parts, counts);
      return {
        lines: held.lines,
        startLine: held.lines[0]?.lineNumber ?? 1,
        endLine: held.lines.at(-1)?.lineNumber ?? 0,
        ...ends,
        loading: false,
        chain: { ...chain, bases, counts },
      };
    });
  }

  /**
   * Go to a held position, as a jump to a line of a file does; a ready
   * chain loads the window around a global line it does not hold.
   */
  async function jumpToPosition(key: TabKey, line: number): Promise<void> {
    const tab = deps.getTab(key);
    if (!tab?.chain) return;
    if (tab.chain.numbering === 'global') {
      await moveTo(key, { kind: 'global', line });
      return;
    }
    const anchor = anchorAt(tab.lines, tab.startLine, line);
    if (anchor !== null) await moveTo(key, { kind: 'local', part: anchor.part, line: anchor.line });
  }

  /** Read the chain again, as its zone now asks, and show the anchor line. */
  async function reload(key: TabKey): Promise<void> {
    if (!chainOf(key)) return;
    deps.patchTab(key, (tab) => ({ chain: tab.chain && { ...tab.chain, description: null } }));
    const described = await describe(key);
    if (described === null || described.chain.state === 'invalid') {
      deps.patchTab(key, () => ({ loading: false }));
      return;
    }
    await showAnchorLine(key, true);
  }

  /** Forget what was kept for the tab `key`; it is closing. */
  function forget(key: TabKey): void {
    describes.forget(key);
    stopFollow(key);
    goneTasks.delete(key);
    highlightGiven.delete(key);
  }

  return {
    openChain,
    moveTo,
    loadMore,
    jumpToPosition,
    jumpToEnd: (key: TabKey) => show(key, { kind: 'end' }),
    reload,
    forget,
  };
}
