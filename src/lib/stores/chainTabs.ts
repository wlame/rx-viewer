/**
 * The tabs of log chains: open one, read its description, follow its
 * index task, load and page its lines in both states, and go to a line
 * or to a time.
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
import { compareParts, changeNotice, type PartChanges } from '../utils/chainChanges';
import { isChainIndexed, neighbourPartWithLines } from '../utils/chainParts';
import { directoryOf, nameOf, partPath } from '../utils/chainSwitch';
import { chainTimeRefusal } from '../utils/chainTime';
import {
  MAX_CHANGES_IN_WINDOW,
  changesInWindow,
  waitBefore,
  type PendingWaitKind,
} from '../utils/chainWaits';
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
import {
  checkShownLine,
  fileLineNotice,
  heldLineAt,
  knownInZone,
  nearestKnownLine,
  type KnownLine,
} from '../utils/knownLine';
import { LatestRequestMap, SUPERSEDED, isAbortError } from '../utils/latestRequest';
import { retryAfterMs } from '../utils/retryAfter';
import type { SampleWindow } from '../utils/sampleWindow';
import { addPage, maxHeldLines } from '../utils/slidingWindow';
import { chainHandleOf, chainKey, type TabKey } from '../utils/tabKey';
import { sleep, watchTask } from '../utils/taskPolling';
import { timeLabelFor } from '../utils/timeline';
import { chainMode, isChainModeOn } from './chainMode';
import { chainTopLines } from './chainTopLines';
import { commandLog } from './commands';
import type { TimeJumpOutcome, TimeQuery } from './files';
import { fileZones, requestZoneOf } from './fileZones';
import { backendHas, health } from './health';
import { notifications } from './notifications';
import { timeCursor } from './timeCursor';
import { tree } from './tree';

/**
 * Where a chain's tab goes: its start or end, a global line, a part's
 * line, a time (an instant), or a time as a person typed it, which the
 * backend reads. A link's global line or part's line carries the
 * `fingerprint` of the files it names it in: in other files the line may
 * be another.
 */
export type ChainPosition =
  | { kind: 'start' }
  | { kind: 'end' }
  | { kind: 'global'; line: number; fingerprint?: string | null }
  | {
      kind: 'local';
      part: string;
      line: number;
      timeMs?: number | null;
      fingerprint?: string | null;
    }
  | { kind: 'time'; ms: number }
  | { kind: 'typedTime'; text: string };

/** A position a link names by a line of the files of its fingerprint. */
type LinkedPosition = Extract<ChainPosition, { kind: 'global' | 'local' }>;

/** A part's line a link names, with that line's time and the fingerprint of its files when it has them. */
export type LocalPosition = Extract<ChainPosition, { kind: 'local' }>;

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
  /** Drop the search marks of a tab; whether it had any. */
  dropMatches(key: TabKey): boolean;
}

/**
 * A line another tab showed, which a chain's tab is to show: `what` names
 * it for a notice ("the line app.log.1 showed at line 500"), with its
 * text and time, or null for either when that tab did not know it.
 */
export interface LineToFind {
  what: string;
  text: string | null;
  timeMs: number | null;
}

export interface OpenChainOptions {
  position?: ChainPosition;
  /** Highlighting as a link gives it, in place of the size-based default. */
  syntaxHighlighting?: boolean;
  /**
   * The fingerprint of the chain's files that `position` was read from (a
   * search's): when the files are others now, the position names other
   * text, and the tab does not go there.
   */
  fingerprint?: string;
}

/** Lines asked before and after the target of a jump: the most the backend serves on a side. */
const JUMP_CONTEXT = 100;

/**
 * About one screen of lines. A held line the tab goes to this close to an
 * edge of the held lines also loads the page beyond that edge: the editor
 * cannot centre it, and at the top of the held lines a wheel turns no
 * scroll, so no scroll would ask for the page.
 */
const SCREEN_LINES = 50;

/** 202 answers a load waits through before it gives up; each one is a task followed to its end. */
const MAX_WAITS = 3;

/**
 * Busy answers (503: no place for the chain's index task) a request is
 * asked again through, each after the wait the backend names; at the
 * next one it stops and says the backend is still busy.
 */
const MAX_BUSY_RETRIES = 3;

/** How long a notice about a chain stays on screen. */
const NOTICE_MS = 5000;

/** The statuses of a task that has not ended. */
const RUNNING_STATUSES: ReadonlySet<string> = new Set(['queued', 'running']);

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_SERVICE_UNAVAILABLE = 503;

/**
 * The backend stayed too busy to start the chain's index task through
 * every retry: not a failure of the chain, so a tab that shows lines
 * keeps them and says so in a notice.
 */
class ChainBusyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChainBusyError';
  }
}

/** `Omit` over each member of a union, so the union stays one. */
type OmitEach<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A request of a chain's lines, without the handle: by lines (of a part), or by times. */
type ChainRequest = OmitEach<LogSamplesParams, 'handle'>;

/**
 * The value a time position sends as `timestamps`: an instant in RFC 3339
 * with ms and `Z`, a typed time as typed; null for any other position.
 */
function timeValueOf(position: ChainPosition): string | null {
  if (position.kind === 'time') return new Date(position.ms).toISOString();
  if (position.kind === 'typedTime') return position.text;
  return null;
}

/** The position a time query names, an instant or a typed text, with the value its request sends. */
function timeQueryPosition(query: TimeQuery): { position: ChainPosition; value: string } {
  return typeof query === 'number'
    ? { position: { kind: 'time', ms: query }, value: new Date(query).toISOString() }
    : { position: { kind: 'typedTime', text: query }, value: query };
}

/** The message of a failure, for a person. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The anchor a position names before its line is read: only a part's
 * line names one, in the files of its fingerprint when it has one.
 */
function anchorOfPosition(position: ChainPosition): ChainAnchor | null {
  if (position.kind !== 'local') return null;
  const anchor: ChainAnchor = {
    part: position.part,
    line: position.line,
    timeMs: position.timeMs ?? null,
  };
  return position.fingerprint == null ? anchor : { ...anchor, fingerprint: position.fingerprint };
}

/**
 * `position` when it names a line of other files than `chain` describes
 * (a link's line, made on files of another fingerprint), else null.
 */
function linkOfOtherFiles(position: ChainPosition, chain: ChainResponse): LinkedPosition | null {
  if (position.kind !== 'local' && position.kind !== 'global') return null;
  const isOther = position.fingerprint != null && position.fingerprint !== chain.fingerprint;
  return isOther ? position : null;
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
    buildRefused: null,
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

/**
 * The position a target names in a chain as described: a gone part, or
 * a line a link names in other files, falls back to its time, else to
 * the start.
 */
function resolvePosition(position: ChainPosition, chain: ChainResponse): ChainPosition {
  const changed = linkOfOtherFiles(position, chain);
  if (changed !== null) {
    return byTimeOrStart(changed.kind === 'local' ? (changed.timeMs ?? null) : null);
  }
  if (position.kind !== 'local') return position;
  if (chain.parts.some((part) => part.name === position.part)) return position;
  return byTimeOrStart(position.timeMs ?? null);
}

/** The position of a line known only by its time: that time, or the start without one. */
function byTimeOrStart(timeMs: number | null): ChainPosition {
  return timeMs === null ? { kind: 'start' } : { kind: 'time', ms: timeMs };
}

/** The line a tab looks for after a change of its chain's files, and where its file is now. */
interface ChainChange extends KnownLine {
  /** The anchor in the file that held it, under that file's name now; null when that file is gone. */
  moved: ChainAnchor | null;
}

/**
 * Where a tab's check of the line it shows ended (`checkLine`): `same`,
 * it shows the line it knew there; `unknown`, it knew nothing to compare;
 * `found`, it showed another line and found the known one again by its
 * time (and text); `notFound`, no line has the known text (or time), and
 * `where` says what the view shows; `stopped`, a newer load or change of
 * the files took over, or the tab shows no line (it says why itself).
 */
type LineSearch =
  { kind: 'same' | 'unknown' | 'found' | 'stopped' } | { kind: 'notFound'; where: string };

const STOPPED: LineSearch = { kind: 'stopped' };

/** The notice of a line a tab cannot show again: `what` names the line, `where` what the view shows. */
function lineNotFoundNotice(what: string, where: string): string {
  return `Cannot find ${what}; ${where}`;
}

/** What a view shows after it looked for a line by its time and found one at or after it. */
const SHOWS_TIME_LINE = 'the view shows the first line at or after its time';

/** What a view shows after it looked for a line by a time after the chain's last line. */
const SHOWS_END = "the view shows the chain's end, before its time";

/** What a view shows where it looked for a line by its time: the line at or after it, or the end. */
function whereByTime(landed: FileLine, timeMs: number): string {
  return (landed.timestampMs ?? -Infinity) >= timeMs ? SHOWS_TIME_LINE : SHOWS_END;
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
  /** When each tab's files last changed on disk, within the window that counts towards a stop. */
  const changeTimes = new Map<TabKey, number[]>();
  /** How many times each tab waited for its pending chain, by why, since it was last not pending. */
  const pendingRounds = new Map<TabKey, Record<PendingWaitKind, number>>();
  /** The wait of each tab before it describes its chain again, which closing the tab cancels. */
  const describeWaits = new Map<TabKey, AbortController>();
  /** How many times each tab was read again in a new zone, so a jump knows it was cut short by one. */
  const reloadGenerations = new Map<TabKey, number>();
  /** The reading again in a new zone each tab is doing, if any. */
  const runningReloads = new Map<TabKey, Promise<void>>();
  /**
   * The line each tab looks for since its chain's files changed, until it
   * shows lines again: a change that comes first keeps looking for the
   * same line, though the tab shows none of it or another one.
   */
  const lostLines = new Map<TabKey, KnownLine>();
  /** How many times the files of each tab's chain changed, so a search for its line knows a newer one took over. */
  const changeCounts = new Map<TabKey, number>();

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
    // A task that ended while the chain stayed pending is followed by the
    // next one only after a wait, longer each time, and not past a few.
    const rounds = roundsOf(key).taskEnded;
    const wait = waitBefore('taskEnded', rounds);
    if (wait === null) {
      stopFollow(key);
      setChain(key, {
        indexTask: null,
        indexProblem: `${rounds} index tasks of ${nameOf(handleOf(key))} ended and it is still pending; open the chain again later`,
      });
      return;
    }
    stopFollow(key);
    const entry = { taskId, controller: new AbortController() };
    follows.set(key, entry);
    const isCurrent = () => follows.get(key) === entry;
    setChain(key, { indexTask: { taskId, progress: null }, indexProblem: null });

    const signal = entry.controller.signal;
    sleep(wait, signal)
      .then(() =>
        watchTask(taskId, {
          fetchStatus: (id, statusSignal) => api.getTaskStatus(id, { signal: statusSignal }),
          signal,
          onStatus: (task) => {
            if (isCurrent()) setChain(key, { indexTask: { taskId, progress: task.progress } });
          },
        }),
      )
      .then(
        (end) => {
          if (!isCurrent()) return;
          follows.delete(key);
          if (end.kind === 'gone') goneTasks.set(key, taskId);
          else goneTasks.delete(key);
          countRound(key, 'taskEnded');
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

  /** How many times the tab `key` waited for its pending chain, by why. */
  function roundsOf(key: TabKey): Record<PendingWaitKind, number> {
    return pendingRounds.get(key) ?? { taskEnded: 0, noTask: 0 };
  }

  function countRound(key: TabKey, kind: PendingWaitKind): void {
    const rounds = roundsOf(key);
    pendingRounds.set(key, { ...rounds, [kind]: rounds[kind] + 1 });
  }

  /** Stop the wait of the tab `key` before it describes its chain again. */
  function stopDescribeWait(key: TabKey): void {
    describeWaits.get(key)?.abort();
    describeWaits.delete(key);
  }

  /**
   * The pending chain of the tab `key` has no index task: the backend has
   * no place to start one (`reason`). The tab keeps the reason, describes
   * the chain again after a wait, longer each time, which starts the task
   * once a place is free, and stops after a few with a message.
   */
  function waitForTaskPlace(key: TabKey, reason: string | null): void {
    // No task runs for the chain now, so a task followed before has ended.
    stopFollow(key);
    setChain(key, { buildRefused: reason, indexTask: null });
    if (describeWaits.has(key)) return;
    const round = roundsOf(key).noTask + 1;
    const wait = waitBefore('noTask', round);
    if (wait === null) {
      const why = reason ?? 'the backend started none';
      setChain(key, {
        indexProblem: `${nameOf(handleOf(key))} has no index task: ${why}; open the chain again later`,
      });
      return;
    }
    countRound(key, 'noTask');
    const controller = new AbortController();
    describeWaits.set(key, controller);
    sleep(wait, controller.signal).then(
      () => {
        if (describeWaits.get(key) !== controller) return;
        describeWaits.delete(key);
        void refresh(key);
      },
      () => {},
    );
  }

  /**
   * What a pending chain's description or answer says about its index
   * task: follow the task it names, or wait for a place for one when it
   * names none.
   */
  function followPending(
    key: TabKey,
    build: { task_id: string; status: string } | null,
    refused: string | null,
  ): void {
    if (build === null) {
      waitForTaskPlace(key, refused);
      return;
    }
    stopDescribeWait(key);
    pendingRounds.set(key, { ...roundsOf(key), noTask: 0 });
    setChain(key, { buildRefused: null });
    follow(key, build);
  }

  /**
   * Keep a description in the tab, as `keepDescription` does, and follow
   * the index task a pending chain waits for.
   */
  function applyDescription(key: TabKey, chain: ChainResponse, isChanged: boolean): void {
    keepDescription(key, chain, isChanged);
    followDescription(key, chain);
  }

  /** Follow the index task a pending chain's description names; a chain that is not pending waits for nothing. */
  function followDescription(key: TabKey, chain: ChainResponse): void {
    if (chain.state === 'pending') {
      followPending(key, chain.index_build, chain.index_build_refused);
      return;
    }
    pendingRounds.delete(key);
    stopDescribeWait(key);
    setChain(key, { buildRefused: null });
  }

  /**
   * Keep a description in the tab: its state, the counts it gives, `idx`,
   * and the chain's size and line count. The files panel learns the
   * state, the reasons and `idx` for the chain's row.
   */
  function keepDescription(key: TabKey, chain: ChainResponse, isChanged: boolean): void {
    tree.noteChainDescription(chain);
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
  }

  /**
   * Describe the chain of the tab `key` and keep the description. A
   * description the tab already holds is sent back by its fingerprint,
   * so a chain whose files changed answers as changed, and that new
   * description is not kept: the caller reads the chain again with it.
   * Null when the request was superseded or failed (the tab says why), or
   * the handle names no chain (the tab closes).
   */
  async function describe(
    key: TabKey,
  ): Promise<{ chain: ChainResponse; isChanged: boolean } | null> {
    const handle = handleOf(key);
    const fingerprint = chainOf(key)?.description?.fingerprint;
    let sentZone: string | undefined;
    try {
      const answer = await describes.run(key, (signal) => {
        sentZone = requestZoneOf(key);
        return api.logChain(handle, { signal, fileTz: sentZone, fingerprint });
      });
      if (answer === SUPERSEDED) return null;
      const isChanged = answer.kind === 'changed';
      // A changed chain is the caller's to read again: the tab keeps the
      // description it held until then, to compare the parts with.
      if (!isChanged) applyDescription(key, answer.chain, false);
      return { chain: answer.chain, isChanged };
    } catch (error) {
      if (isAbortError(error)) return null;
      if (error instanceof ApiError && error.status === HTTP_NOT_FOUND) {
        await closeAsNoChain(key);
        return null;
      }
      if (isRefusedZone(key, error, sentZone)) {
        // The zone is gone now, so the next description sends none.
        dropRefusedZone(key, sentZone, error);
        return describe(key);
      }
      showError(key, error);
      return null;
    }
  }

  /**
   * Whether `error` is the backend's refusal of the zone `sentZone` that a
   * description of the tab `key` carried, while the tab still has it: a
   * description answers 400 for a valid handle only for its `file_tz`.
   */
  function isRefusedZone(
    key: TabKey,
    error: unknown,
    sentZone: string | undefined,
  ): sentZone is string {
    return (
      error instanceof ApiError &&
      error.status === HTTP_BAD_REQUEST &&
      sentZone !== undefined &&
      fileZones.zoneOf(key) === sentZone
    );
  }

  /** Drop the zone the backend refused for the tab `key`, with a notice, as a file's tab does. */
  function dropRefusedZone(key: TabKey, zone: string, error: unknown): void {
    fileZones.clear(key);
    notifications.error(
      `Cannot read ${nameOf(handleOf(key))} in the zone ${zone}: ${messageOf(error)}`,
      NOTICE_MS,
    );
  }

  /**
   * The handle names no chain (any more): the tab closes, and the part
   * that held its anchor opens as a file at the anchor's line when the
   * tab knows one; otherwise a notice says why. The handle names no chain
   * while its files are being rotated too, so the file may hold other
   * text at that line now: a notice says so (`openFileChecked`).
   */
  async function closeAsNoChain(key: TabKey): Promise<void> {
    const handle = handleOf(key);
    const anchor = chainOf(key)?.anchor ?? null;
    const known = knownAnchorLine(key);
    const zone = fileZones.zoneOf(key);
    forget(key);
    deps.closeTab(key);
    if (anchor === null) {
      notifications.error(`${handle} is not a log chain`, NOTICE_MS);
      return;
    }
    const path = partPath(handle, anchor.part);
    if (!(await isListed(path))) {
      notifications.info(
        `${nameOf(handle)} is no longer a log chain, and ${anchor.part} is gone`,
        NOTICE_MS,
      );
      return;
    }
    await openFileChecked(path, anchor.line, { known, zone }, nameOf(handle));
  }

  /**
   * Open the file `path` at `line`, as the file tab a chain's tab
   * (`chainName`) becomes, and say so when the line it shows there is not
   * the line the chain's tab knew (`known`, its time read in `zone`): the
   * file changed on disk.
   */
  async function openFileChecked(
    path: string,
    line: number,
    { known, zone }: { known: KnownLine; zone: string | null },
    chainName: string,
  ): Promise<void> {
    await deps.openFileAt(path, line);
    const comparable = knownInZone(known, zone, fileZones.zoneOf(path));
    const notice = fileLineNotice(deps.getTab(path), line, comparable, chainName);
    if (notice !== null) notifications.info(notice, NOTICE_MS);
  }

  /**
   * Whether the listing of its directory names the file `path`. A listing
   * that fails says nothing, and the file is taken to be there: its tab
   * then says why it cannot be read.
   */
  async function isListed(path: string): Promise<boolean> {
    try {
      const listing = await api.getTree(directoryOf(path));
      return (listing.entries ?? []).some((entry) => entry.path === path);
    } catch (error) {
      console.debug('The directory listing failed; opening the file all the same:', path, error);
      return true;
    }
  }

  /** Whether `error` says the handle names no chain (any more). */
  function isNoChain(error: unknown): boolean {
    return error instanceof ApiError && error.status === HTTP_NOT_FOUND;
  }

  /**
   * The backend answered a request about the chain `handle` busy (503): no
   * place for the chain's index task yet. The first time says so in a
   * notice; each wait is the one the answer's `Retry-After` names (a few
   * seconds without it). At the busy answer after `MAX_BUSY_RETRIES` to
   * one load, throws a `ChainBusyError`.
   */
  async function waitWhileBusy(
    handle: string,
    busy: number,
    error: ApiError,
    signal: AbortSignal,
  ): Promise<void> {
    const name = nameOf(handle);
    if (busy > MAX_BUSY_RETRIES) {
      throw new ChainBusyError(
        `The backend is still busy with the indexes of other log chains; ask ${name} again later`,
      );
    }
    const wait = retryAfterMs(error.retryAfter, Date.now());
    if (busy === 1) {
      notifications.info(
        `The backend is busy with the indexes of other log chains; ${name} is asked again in ${Math.round(wait / 1000)} s`,
        NOTICE_MS,
      );
    }
    await sleep(wait, signal);
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
    for (let waits = 0, busy = 0; ;) {
      let answer: LogSamplesAnswer;
      try {
        answer = await api.logSamples(params, {
          signal,
          respondAsync: true,
          fileTz: requestZoneOf(key),
          fingerprint: chainOf(key)?.description?.fingerprint,
        });
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== HTTP_SERVICE_UNAVAILABLE) throw error;
        busy += 1;
        await waitWhileBusy(params.handle, busy, error, signal);
        continue;
      }
      if (answer.kind !== 'building') {
        if (waits > 0) deps.patchTab(key, () => ({ indexBuild: null }));
        return answer;
      }
      waits += 1;
      if (waits > MAX_WAITS) {
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
      // A chain whose files changed meanwhile is read again by the caller:
      // the request was planned on the parts and numbers it had.
      const described = await describe(key);
      if (described?.isChanged) {
        deps.patchTab(key, () => ({ indexBuild: null }));
        return { kind: 'changed', chain: described.chain };
      }
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
      case 'typedTime':
        return { timestamps: [position.text], context: JUMP_CONTEXT };
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
      case 'typedTime':
        return named(answer.timestamps);
      default:
        return named(answer.lines);
    }
  }

  /** Show the window of a ready chain's answer, by global numbers. */
  function showGlobalWindow(key: TabKey, position: ChainPosition, answer: ChainSamplesResponse) {
    const value = timeValueOf(position);
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
   * Resolves whether the tab took the answer to this request: false when
   * a newer load superseded it, it failed, or the chain's files changed.
   */
  async function show(key: TabKey, position: ChainPosition, record = true): Promise<boolean> {
    const held = chainOf(key);
    const chain = held?.description;
    if (!held || !chain) return false;
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
      return true;
    }
    deps.patchTab(key, () => ({ loading: true, error: null }));
    let answer: Awaited<ReturnType<typeof loadChainSamples>> | typeof SUPERSEDED;
    try {
      answer = await deps.loads.run(key, (signal) => loadChainSamples(key, request, signal));
    } catch (error) {
      if (isAbortError(error)) return false;
      if (isNoChain(error)) await closeAsNoChain(key);
      else showFailure(key, error);
      return false;
    }
    if (answer === SUPERSEDED) return false;
    try {
      return await applyAnswer(key, target, request, answer, record);
    } catch (error) {
      // An answer the tab cannot show, such as a piece that numbers its
      // lines with no whole number: the tab says why and shows no line.
      if (!isAbortError(error)) showError(key, error);
      return false;
    }
  }

  /**
   * Show a failed load: a busy backend in a notice, the lines the tab
   * shows kept (the chain is fine, the backend only had no place for its
   * index task); any other failure, or a busy backend before the tab
   * shows a line, in the tab.
   */
  function showFailure(key: TabKey, error: unknown): void {
    const isBusy = error instanceof ChainBusyError;
    if (isBusy && (deps.getTab(key)?.lines.length ?? 0) > 0) {
      deps.patchTab(key, () => ({ loading: false }));
      notifications.info(error.message, NOTICE_MS);
      return;
    }
    showError(key, error);
  }

  /**
   * What a window's answer does to the tab: its lines, a changed chain, or
   * an invalid one. Resolves whether the tab took it (`show`): a change
   * of the chain's files is read again instead.
   */
  async function applyAnswer(
    key: TabKey,
    position: ChainPosition,
    request: ChainRequest,
    answer: Exclude<LogSamplesAnswer, { kind: 'building' }>,
    record: boolean,
  ): Promise<boolean> {
    if (answer.kind === 'changed') {
      await readAgainAfterChange(key, answer.chain);
      return false;
    }
    if (answer.kind === 'invalid') {
      showInvalid(key, answer.detail);
      return true;
    }
    const samples = answer.samples;
    const timeValue = timeValueOf(position);
    if (timeValue !== null && readChainTimeAnswer(samples, timeValue).found === false) {
      const tab = deps.getTab(key);
      const label = position.kind === 'time' ? timeLabelFor(position.ms, tab) : timeValue;
      notifications.info(`No line at or after ${label} in ${nameOf(handleOf(key))}`);
      return show(key, { kind: 'end' }, record);
    }
    const isEmpty = piecesOf(samples).length === 0;
    if (isEmpty && position.kind !== 'start' && position.kind !== 'end') {
      // A line past the end: the end is the nearest lines that exist.
      return show(key, { kind: 'end' }, record);
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
    followAnswer(key, samples);
    return true;
  }

  /**
   * Follow the build an answer names: for a pending chain its index task,
   * or, when it names none, a wait for a place for one with the reason it
   * gives; for a ready chain a part's build.
   */
  function followAnswer(key: TabKey, samples: ChainSamplesResponse): void {
    if (samples.state === 'pending') {
      followPending(key, samples.index_build, samples.index_build_refused);
    } else {
      follow(key, samples.index_build);
    }
  }

  /**
   * The chain cannot be read as one text: no lines, and the backend's
   * refusal of a read when one came (`detail`); a description's reasons
   * show from the description itself.
   */
  function showInvalid(key: TabKey, detail: string | null): void {
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
   * The chain's files changed on disk (a rotation): say how, keep its new
   * description, drop the lines, and find the anchor line again
   * (`findAnchorAgain`). A chain that is invalid now leaves its tab
   * (`leaveInvalidChain`). After more than `MAX_CHANGES_IN_WINDOW`
   * changes within a minute, the tab stops and says why.
   */
  async function readAgainAfterChange(key: TabKey, chain: ChainResponse): Promise<void> {
    const change = noteChange(key, chain);
    if (change === null) return;
    if (chain.state === 'invalid') {
      await leaveInvalidChain(key, chain, change);
      return;
    }
    await findAnchorAgain(key, chain, change);
  }

  /**
   * Take in a change of the chain's files: count it towards the stop,
   * compare the parts the tab held with the chain's parts now and say how
   * they changed, keep the new description, drop the lines and the search
   * marks (they name parts and lines of the files as they were), and name
   * the anchor's file as it is called now, so a later change maps it from
   * that name. Null when the files changed too often and the tab stopped:
   * it then reads nothing more and follows no task, but its anchor and
   * description name the files as they are, for a mode switch to read.
   */
  function noteChange(key: TabKey, chain: ChainResponse): ChainChange | null {
    const times = changesInWindow(changeTimes.get(key) ?? [], Date.now());
    changeTimes.set(key, times);
    const isStopped = times.length > MAX_CHANGES_IN_WINDOW;
    const tab = deps.getTab(key);
    const before = tab?.chain?.description ?? null;
    const anchor = tab?.chain?.anchor ?? null;
    const lost = knownAnchorLine(key);
    lostLines.set(key, lost);
    changeCounts.set(key, (changeCounts.get(key) ?? 0) + 1);
    const changes = before === null ? null : compareParts(before.parts, chain.parts);
    const moved = anchor && movedAnchor(anchor, changes);
    if (!isStopped) notifications.info(changeNotice(chain.name, changes), NOTICE_MS);
    if (deps.dropMatches(key)) {
      notifications.info(
        `The search marks of ${chain.name} are dropped: they name its files as they were; search again`,
        NOTICE_MS,
      );
    }
    keepDescription(key, chain, true);
    deps.patchTab(key, (t) => ({
      lines: [],
      startLine: 1,
      endLine: 0,
      chain: t.chain && { ...t.chain, anchor: moved },
    }));
    if (isStopped) {
      changeTimes.delete(key);
      showError(
        key,
        new Error(`The files of ${chain.name} keep changing on disk; open the chain again later`),
      );
      return null;
    }
    followDescription(key, chain);
    return { moved, ...lost };
  }

  /** The line the tab `key` is anchored on, or null when it holds no such line. */
  function heldAnchorLine(key: TabKey): FileLine | null {
    const tab = deps.getTab(key);
    return tab ? heldLineAt(tab, tab.anchorLine) : null;
  }

  /** Drop the lines of the tab `key`, which are not the line it looks for. */
  function dropLines(key: TabKey): void {
    deps.patchTab(key, () => ({ lines: [], startLine: 1, endLine: 0 }));
  }

  /** The text of the held line the tab is anchored on, when it is the anchor's line. */
  function anchorTextOf(tab: OpenFile, anchor: ChainAnchor): string | null {
    const line = tab.lines[tab.anchorLine - tab.startLine];
    const isAnchorLine =
      line?.lineNumber === tab.anchorLine &&
      line.part === anchor.part &&
      line.localLine === anchor.line;
    return isAnchorLine ? line.content : null;
  }

  /**
   * What the tab `key` knows of its anchor line: the line it still looks
   * for since a change of its files (it shows none of it now, or the line
   * of another file), else the text of the anchor line it holds and the
   * anchor's time; null for either it does not know.
   */
  function knownAnchorLine(key: TabKey): KnownLine {
    const lost = lostLines.get(key);
    if (lost !== undefined) return lost;
    const tab = deps.getTab(key);
    const anchor = tab?.chain?.anchor ?? null;
    return {
      text: tab && anchor ? anchorTextOf(tab, anchor) : null,
      timeMs: anchor?.timeMs ?? null,
    };
  }

  /**
   * The anchor in the file that held it, under that file's name after the
   * change, which names it in the files as they are now; null when the
   * file is gone. Without a comparison (the tab held no description), the
   * part keeps its name, and a link's anchor the files it named it in.
   */
  function movedAnchor(anchor: ChainAnchor, changes: PartChanges | null): ChainAnchor | null {
    if (changes === null) return anchor;
    const name = changes.nameMap.get(anchor.part);
    return name === undefined ? null : { part: name, line: anchor.line, timeMs: anchor.timeMs };
  }

  /**
   * Show the anchor line after a change of the chain's files. A ready
   * chain is read at the anchor's time, and the view goes to the nearest
   * line with the anchor's text there, else to the time's line. Before
   * the chain is ready (a numbered rotation renames every part, and each
   * is indexed again), the file that held the anchor is read under its
   * new name at the same line, and checked (`checkLine`): another line
   * there (the rename map paired another file) leaves the screen, and the
   * time is read. Without a time or that file, the chain's start. A
   * notice says when the view shows no line with the anchor's text (or,
   * without one, its time). A newer change of the files takes the search
   * over.
   */
  async function findAnchorAgain(
    key: TabKey,
    chain: ChainResponse,
    { moved, timeMs, text }: ChainChange,
  ): Promise<void> {
    const change = changeCounts.get(key);
    const isOvertaken = () => changeCounts.get(key) !== change;
    let search: LineSearch;
    if (chain.state === 'ready' && timeMs !== null) {
      search = await lookByTime(key, { text, timeMs }, false);
    } else if (moved !== null) {
      await show(key, { kind: 'local', part: moved.part, line: moved.line, timeMs }, false);
      if (isOvertaken()) return;
      search = await checkLine(key, { text, timeMs }, false);
    } else if (timeMs !== null) {
      search = await lookByTime(key, { text, timeMs }, false);
    } else {
      await show(key, { kind: 'start' }, false);
      const check = checkShownLine(heldAnchorLine(key), { text, timeMs });
      search =
        check === 'other'
          ? { kind: 'notFound', where: "the view shows the chain's start" }
          : { kind: check };
    }
    if (!isOvertaken()) endLineSearch(key, search);
  }

  /**
   * End the search for the line the tab `key` showed before its files
   * changed, once it shows lines again: a notice says when it is not
   * found (`search.where` says what the view shows instead). A tab that
   * shows no line (a failed read, which it says itself) looks for the
   * same line at the next change.
   */
  function endLineSearch(key: TabKey, search: LineSearch): void {
    const tab = deps.getTab(key);
    if (!tab || tab.lines.length === 0) return;
    lostLines.delete(key);
    if (search.kind !== 'notFound') return;
    const what = `the line ${tab.name} showed before its files changed`;
    notifications.info(lineNotFoundNotice(what, search.where), NOTICE_MS);
  }

  /**
   * The one check of the line the tab `key` shows at its anchor after it
   * read its chain again, against the line it knew there (`known`):
   * after a change of the files, a reload in another zone, the end of an
   * index task, a mode switch. The same line, or nothing known to
   * compare, stays. Another line (or none) leaves the screen, and the
   * known line is looked for by its time (`lookByTime`); without a time it
   * stays, and the answer says the view shows other text.
   */
  async function checkLine(key: TabKey, known: KnownLine, record: boolean): Promise<LineSearch> {
    const check = checkShownLine(heldAnchorLine(key), known);
    if (check !== 'other') return { kind: check };
    if (known.timeMs === null) return { kind: 'notFound', where: otherLineWhere(key) };
    dropLines(key);
    return lookByTime(key, { ...known, timeMs: known.timeMs }, record);
  }

  /** What the view of the tab `key` shows when its anchor line is another line than the one it knew. */
  function otherLineWhere(key: TabKey): string {
    const anchor = chainOf(key)?.anchor ?? null;
    return anchor !== null && heldAnchorLine(key) !== null
      ? `the view shows line ${anchor.line} of ${anchor.part}, which holds other text now`
      : 'the view shows another line';
  }

  /**
   * Show the chain at the known line's time, then go to the nearest held
   * line with its text, which the time's line and its context hold when
   * several lines share that time. Resolves `found` when the view shows a
   * line with the known text (or, without one, the known time), and
   * `same` when that line is at the known place too.
   */
  async function lookByTime(
    key: TabKey,
    known: KnownLine & { timeMs: number },
    record: boolean,
  ): Promise<LineSearch> {
    const change = changeCounts.get(key);
    const isShown = await show(key, { kind: 'time', ms: known.timeMs }, record);
    if (!isShown || changeCounts.get(key) !== change) return STOPPED;
    goToKnownLine(key, known);
    const landed = heldAnchorLine(key);
    if (landed === null) return STOPPED;
    if (checkShownLine(landed, { ...known, place: null }) !== 'same') {
      return { kind: 'notFound', where: whereByTime(landed, known.timeMs) };
    }
    const isAtPlace = known.place != null && checkShownLine(landed, known) === 'same';
    return { kind: isAtPlace ? 'same' : 'found' };
  }

  /**
   * Move the anchor of the tab `key` to the nearest held line that is the
   * known one (`nearestKnownLine`): with its text, at its time too where
   * both are known, or, without a text, with its time at its line in a
   * part (a file a rotation renamed keeps its lines' numbers).
   */
  function goToKnownLine(key: TabKey, known: KnownLine): void {
    const tab = deps.getTab(key);
    if (!tab) return;
    const found = nearestKnownLine(tab.lines, tab.startLine, tab.anchorLine, known);
    if (found === null || found === tab.anchorLine) return;
    deps.patchTab(key, (t) => ({
      scrollToLine: found,
      anchorLine: found,
      chain: t.chain && {
        ...t.chain,
        anchor: anchorAt(t.lines, t.startLine, found) ?? t.chain.anchor,
      },
    }));
  }

  /**
   * The chain is invalid after its files changed: its tab becomes the
   * file tab of the file that held its anchor line, at that line, under
   * the file's name now; when that file is gone, or the tab had no
   * anchor, the tab closes. A notice says which, and another when the
   * file holds other text at the line (`openFileChecked`).
   */
  async function leaveInvalidChain(
    key: TabKey,
    chain: ChainResponse,
    { moved, text, timeMs }: ChainChange,
  ): Promise<void> {
    const handle = handleOf(key);
    const codes = chain.reasons.map((reason) => reason.code).join(', ');
    const zone = fileZones.zoneOf(key);
    forget(key);
    deps.closeTab(key);
    if (moved === null) {
      notifications.info(
        `${chain.name} is no longer a valid log chain, and the file that held its line is gone`,
        NOTICE_MS,
      );
      return;
    }
    notifications.info(
      `${chain.name} is no longer a valid log chain${codes ? ` (${codes})` : ''}; ${moved.part} opens as a file`,
      NOTICE_MS,
    );
    const known: KnownLine = { text, timeMs };
    await openFileChecked(partPath(handle, moved.part), moved.line, { known, zone }, chain.name);
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
      showInvalid(key, null);
      return;
    }
    // A load in flight answers by global numbers itself once the chain is ready.
    const isLoading = deps.getTab(key)?.loading ?? false;
    if (chain.state === 'ready' && before.numbering === 'local' && !isLoading) {
      await showAnchorLine(key, false);
    }
  }

  /**
   * Bring the tab `key` up to its chain's files before another tab takes
   * its line (chain mode turning off): the chain is described with the
   * tab's fingerprint, and a change is taken in (`refresh`), so the
   * anchor names the file that holds the line now. Resolves what the tab
   * knows of its anchor line (`knownAnchorLine`), which the file tab is
   * checked against.
   */
  async function settle(key: TabKey): Promise<KnownLine> {
    await refresh(key);
    return knownAnchorLine(key);
  }

  /**
   * Check that the tab `key` shows at its anchor the line another tab
   * showed there: a file tab of one of the chain's parts, before chain
   * mode turned on, which knew no fingerprint to send. Another line there
   * (or none) means the files changed since that tab read them (a
   * rotation renamed them): it leaves the screen, and the line is looked
   * for by its time and text (`checkLine`); a notice says when it is not
   * found. Resolves whether the tab showed the line where the other tab
   * had it, which it cannot tell (false) when that tab knew nothing of it.
   */
  async function confirmLine(key: TabKey, line: LineToFind): Promise<boolean> {
    const search = await checkLine(key, line, false);
    if (search.kind === 'notFound') {
      const what = `${line.what} in ${deps.getTab(key)?.name}, whose files changed since`;
      notifications.info(lineNotFoundNotice(what, search.where), NOTICE_MS);
    }
    return search.kind === 'same';
  }

  /**
   * Check the line a link (or a history entry) names in the tab `key`,
   * which went there: a part, a line in it, that line's time and the
   * fingerprint of the files it was made on. A link made on other files
   * than the chain's now was shown by its time, or at the start, already
   * (`showChangedLink`). Any other link's part's line must have the
   * link's time: a rotation since a link without a fingerprint was made
   * gives the part's name to another file, and an active file rewritten
   * in place (a program that truncates its log when it starts) keeps the
   * chain's fingerprint, and either holds a line of another time there.
   * That line leaves the screen, and the link's time finds the line
   * (`checkLine`), on the same line of its part where several lines share
   * that time. A notice says the files changed since the link was made,
   * or that no line has its time now. A link with neither a time nor a
   * fingerprint leaves nothing to check the part's line against: a notice
   * says the view shows it as the files are now. A tab that shows no line
   * (an invalid chain, a failed read) says why itself.
   */
  async function checkLinkLine(key: TabKey, link: LocalPosition): Promise<void> {
    const tab = deps.getTab(key);
    if (!tab?.chain || tab.lines.length === 0) return;
    const described = tab.chain.description;
    if (described && linkOfOtherFiles(link, described) !== null) return;
    const timeMs = link.timeMs ?? null;
    if (timeMs === null) {
      if (link.fingerprint == null) sayLinkUnchecked(key, tab.name, link);
      return;
    }
    const known: KnownLine = {
      text: null,
      timeMs,
      place: { part: link.part, line: link.line },
    };
    const held = heldAnchorLine(key);
    // A part that is gone sent the tab to the link's time already.
    const isAtTimeElsewhere =
      checkShownLine(held, { ...known, place: null }) === 'same' &&
      checkShownLine(held, known) !== 'same';
    const search: LineSearch = isAtTimeElsewhere
      ? { kind: 'found' }
      : await checkLine(key, known, true);
    sayWhereLinkLanded(tab.name, link, search);
  }

  /**
   * Say that the tab `key` shows the part's line a link names (with no
   * fingerprint and no time) as the chain's files are now: nothing tells
   * whether the part's name still holds the file the link was made on.
   */
  function sayLinkUnchecked(key: TabKey, name: string, link: { part: string; line: number }): void {
    const held = heldAnchorLine(key);
    if (held?.part !== link.part || held.localLine !== link.line) return;
    notifications.info(
      `This link does not say which files of ${name} it was made on: the view shows line ${link.line} of ${link.part} as the files are now`,
      NOTICE_MS,
    );
  }

  /**
   * Say where the line of a link made on files that changed since landed
   * in the chain `name` (`search`): at the link's time, or nowhere with
   * its time, and what the view shows then. A line found at the link's
   * part and line, or a search a newer one took over, says nothing.
   */
  function sayWhereLinkLanded(
    name: string,
    link: { part: string; line: number },
    search: LineSearch,
  ): void {
    if (search.kind === 'found') {
      notifications.info(
        `The files of ${name} changed since this link was made; the view shows the line at the link's time`,
        NOTICE_MS,
      );
    } else if (search.kind === 'notFound') {
      const what = `line ${link.line} of ${link.part} that this link names, in ${name}, whose files changed since it was made`;
      notifications.info(lineNotFoundNotice(what, search.where), NOTICE_MS);
    }
  }

  /**
   * Show the line a link names in files that changed since it was made
   * (its fingerprint is not the chain's now): after a rotation its part's
   * name may hold another file, and its global line be another line, so
   * the tab never reads either. It goes by the link's time, to the link's
   * line of its part where several lines share that time; without a time,
   * to the chain's start. A notice says the files changed since the link
   * was made, and whether its line was found again.
   */
  async function showChangedLink(key: TabKey, link: LinkedPosition): Promise<void> {
    const name = deps.getTab(key)?.name ?? nameOf(handleOf(key));
    const timeMs = link.kind === 'local' ? (link.timeMs ?? null) : null;
    if (link.kind === 'global' || timeMs === null) {
      await show(key, { kind: 'start' });
      notifications.info(
        `The files of ${name} changed since this link was made; the line could not be found again`,
        NOTICE_MS,
      );
      return;
    }
    const place = { part: link.part, line: link.line };
    const search = await lookByTime(key, { text: null, timeMs, place }, true);
    sayWhereLinkLanded(name, place, search);
  }

  /** Drop the anchor of the tab `key`: a link named it in other files than the tab reads. */
  function dropAnchor(key: TabKey): void {
    deps.patchTab(key, (tab) => ({ chain: tab.chain && { ...tab.chain, anchor: null } }));
  }

  /**
   * Show the tab's anchor line again, by its part and its line in it; the
   * start without one. A tab that has not found its line since its files
   * changed looks for it by its time and text (`findAnchorAgain`), since
   * its anchor's file may be another one; so does an anchor a link named
   * in other files than the chain's now (`showChangedLink`). The line it
   * shows is checked against the line it knew (`known`, by default what
   * it knows now): another line is looked for by its time, with a notice
   * when it is not found (`checkLine`).
   */
  async function showAnchorLine(
    key: TabKey,
    record: boolean,
    known: KnownLine = knownAnchorLine(key),
  ): Promise<void> {
    const anchor = chainOf(key)?.anchor ?? null;
    const lost = lostLines.get(key);
    const chain = chainOf(key)?.description;
    if (lost !== undefined && chain) {
      await findAnchorAgain(key, chain, { moved: anchor, ...lost });
      return;
    }
    if (anchor === null) {
      await show(key, { kind: 'start' }, record);
      return;
    }
    const position: ChainPosition = { kind: 'local', ...anchor };
    const changed = chain ? linkOfOtherFiles(position, chain) : null;
    if (changed !== null) {
      dropAnchor(key);
      await showChangedLink(key, changed);
      return;
    }
    const change = changeCounts.get(key);
    const isShown = await show(key, position, record);
    if (!isShown || changeCounts.get(key) !== change) return;
    const search = await checkLine(key, known, record);
    if (search.kind === 'notFound') {
      const what = `the line ${deps.getTab(key)?.name} showed`;
      notifications.info(lineNotFoundNotice(what, search.where), NOTICE_MS);
    }
  }

  /**
   * Open the tab of the chain `handle` at `position` (its start by
   * default), or bring it forward and move it there. The tab is in the
   * store before the first request, and it closes with a notice when
   * chain features cannot act; an invalid chain shows its reasons and no
   * lines.
   *
   * With a `fingerprint` (a search's), the position holds only for those
   * files: a chain whose files changed since opens at its start, and an
   * open tab stays where it is (it describes its chain first when its
   * own description is not of those files); either says to search again.
   * Resolves whether the tab shows the files `fingerprint` names. A
   * link's position that carries a fingerprint of other files than the
   * chain's now is shown by its time, or at the start (`showChangedLink`).
   */
  async function openChain(handle: string, options: OpenChainOptions = {}): Promise<boolean> {
    const { position = { kind: 'start' }, syntaxHighlighting, fingerprint } = options;
    const key = chainKey(handle);
    const isSearched = () =>
      fingerprint === undefined || chainOf(key)?.description?.fingerprint === fingerprint;
    if (deps.getTab(key)) {
      deps.setActive(key);
      if (!isSearched()) await refresh(key);
      if (!isSearched()) return changedSinceSearch(key);
      if (position.kind !== 'start') await moveTo(key, position);
      return isSearched() || changedSinceSearch(key);
    }
    if (syntaxHighlighting !== undefined) highlightGiven.add(key);
    deps.addTab(newChainTab(handle, position, syntaxHighlighting ?? true));

    await contractGate.pass();
    const refused = refusal();
    if (refused !== null) {
      forget(key);
      deps.closeTab(key);
      notifications.info(`${refused} (${handle})`, NOTICE_MS);
      return false;
    }
    const described = await describe(key);
    if (described === null) return false;
    // The tab never names a line of other files than it reads.
    const changed = linkOfOtherFiles(position, described.chain);
    if (changed !== null) dropAnchor(key);
    if (described.chain.state === 'invalid') {
      deps.patchTab(key, () => ({ loading: false }));
      return isSearched();
    }
    if (!isSearched()) {
      dropAnchor(key);
      await show(key, { kind: 'start' });
      return changedSinceSearch(key);
    }
    if (changed !== null) await showChangedLink(key, changed);
    else await show(key, position);
    return isSearched() || changedSinceSearch(key);
  }

  /** Say that the chain of the tab `key` changed since the search that named a line in it. */
  function changedSinceSearch(key: TabKey): false {
    notifications.info(
      `The chain ${nameOf(handleOf(key))} changed since the search; search again`,
      NOTICE_MS,
    );
    return false;
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
   * otherwise by loading the window around it. The tab becomes active. A
   * link's line in other files than the tab holds is first checked
   * against the chain as it is now (the link may be newer than the tab's
   * files); in other files still, the tab goes by the link's time, or to
   * the start (`showChangedLink`).
   */
  async function moveTo(key: TabKey, position: ChainPosition): Promise<void> {
    if (!deps.getTab(key)?.chain) return;
    deps.setActive(key);
    const described = chainOf(key)?.description;
    if (described && linkOfOtherFiles(position, described) !== null) {
      await refresh(key);
      const now = chainOf(key)?.description;
      const changed = now ? linkOfOtherFiles(position, now) : null;
      if (changed !== null) {
        lostLines.delete(key);
        await showChangedLink(key, changed);
        return;
      }
    }
    const tab = deps.getTab(key);
    if (!tab?.chain) return;
    // A move the user asks for: the tab looks for a line lost to a change no more.
    lostLines.delete(key);
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
      if (held - tab.startLine < SCREEN_LINES && !tab.reachedStart) {
        await loadMore(key, 'before');
      } else if (tab.endLine - held < SCREEN_LINES && !tab.reachedEnd) {
        await loadMore(key, 'after');
      }
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
      if (isNoChain(error)) {
        await closeAsNoChain(key);
        return;
      }
      deps.patchTab(key, () => ({ loading: false }));
      if (error instanceof ChainBusyError) notifications.info(error.message, NOTICE_MS);
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
    try {
      if (isGlobal) addGlobalPage(key, direction, samples);
      else addLocalPage(key, direction, edge.part ?? '', request, samples);
    } catch (error) {
      refusePage(key, direction, error);
      return;
    }
    followAnswer(key, samples);
  }

  /**
   * Refuse a page the tab cannot show, such as one whose piece numbers
   * its lines with no whole number. The held lines stay on screen and a
   * notice says why: an error in the tab would put itself in place of the
   * editor. No further page is asked that way, which each scroll at the
   * edge would do; a jump or a reload of the tab pages again.
   */
  function refusePage(key: TabKey, direction: 'before' | 'after', error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    deps.patchTab(key, () => ({
      loading: false,
      ...(direction === 'before' ? { reachedStart: true } : { reachedEnd: true }),
    }));
    notifications.error(message);
    console.error('A page of the log chain cannot be shown:', key, error);
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
    return maxHeldLines(chainPageSize(parts, names));
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

  /**
   * Move the tab `key` to the first line, in the chain's order, at or
   * after a time, the way a file's tab moves by time: the window around
   * the line the backend names, anchored on it, and the tab made active.
   * `query` is an instant (UTC ms) or a text the backend reads as
   * `--timestamps` does (a time of day is answered only on a chain whose
   * times fall on one day). A time in a gap between two parts lands on
   * the later part's first line, a time before the chain on line 1.
   *
   * A jump that finds a line makes the time cursor the instant asked, or
   * the found line's time for a typed text. No line at or after the time
   * shows the chain's end with a notice. A refused query, or a chain that
   * is not ready, leaves the tab as it was and says why; the backend is
   * asked nothing while the chain is not ready.
   */
  function jumpToTime(key: TabKey, query: TimeQuery): Promise<TimeJumpOutcome> {
    lostLines.delete(key);
    return jumpToTimeOnce(key, query, false);
  }

  /** Show the chain's end, as the user asks. */
  async function jumpToEnd(key: TabKey): Promise<void> {
    lostLines.delete(key);
    await show(key, { kind: 'end' });
  }

  /**
   * One jump by time (`jumpToTime`). A jump cut short because the chain
   * was read again in a new zone meanwhile is asked once more when that
   * reading has ended (`isRetry`), in the zone the chain is read in now;
   * cut short again, it says so.
   */
  async function jumpToTimeOnce(
    key: TabKey,
    query: TimeQuery,
    isRetry: boolean,
  ): Promise<TimeJumpOutcome> {
    const tab = deps.getTab(key);
    if (!tab?.chain) return { kind: 'refused', message: `${key} is not open` };
    deps.setActive(key);
    await contractGate.pass();
    if (!backendHas('log_chains')) return { kind: 'unsupported' };
    const notReady = chainTimeRefusal(tab.name, tab.chain);
    if (notReady !== null) return { kind: 'refused', message: notReady };

    const generation = reloadGenerations.get(key) ?? 0;
    const afterCutShort = async (): Promise<TimeJumpOutcome> => {
      if ((reloadGenerations.get(key) ?? 0) === generation) return { kind: 'superseded' };
      if (isRetry) {
        return {
          kind: 'refused',
          message: `${tab.name} was read again while the jump ran; ask for the time again`,
        };
      }
      await runningReloads.get(key);
      return jumpToTimeOnce(key, query, true);
    };

    const { position, value } = timeQueryPosition(query);
    const request: ChainRequest = { timestamps: [value], context: JUMP_CONTEXT };
    deps.patchTab(key, () => ({ loading: true, error: null }));
    let answer: Awaited<ReturnType<typeof loadChainSamples>> | typeof SUPERSEDED;
    try {
      answer = await deps.loads.run(key, (signal) => loadChainSamples(key, request, signal));
    } catch (error) {
      if (isAbortError(error)) return afterCutShort();
      deps.patchTab(key, () => ({ loading: false }));
      // The handle names no chain any more: the tab becomes its part's file tab.
      if (isNoChain(error)) await closeAsNoChain(key);
      return { kind: 'refused', message: messageOf(error) };
    }
    if (answer === SUPERSEDED) return afterCutShort();
    if (answer.kind === 'changed') return jumpAfterChange(key, query, answer.chain, isRetry);
    if (answer.kind === 'invalid') {
      // The query or the chain: the description says which, and an
      // invalid chain then shows its reasons.
      deps.patchTab(key, () => ({ loading: false }));
      void refresh(key);
      return { kind: 'refused', message: answer.detail };
    }
    return showTimeAnswer(key, { position, value }, request, answer.samples);
  }

  /**
   * The chain's files changed while a jump by time ran: take the change
   * in and ask the time once more in the chain as it is now. A jump that
   * cannot go there (the chain is pending again, or it is a second
   * change) says why, and the tab finds its anchor line again.
   */
  async function jumpAfterChange(
    key: TabKey,
    query: TimeQuery,
    chain: ChainResponse,
    isRetry: boolean,
  ): Promise<TimeJumpOutcome> {
    deps.patchTab(key, () => ({ loading: false }));
    const change = noteChange(key, chain);
    const changedMessage = `The files of ${chain.name} changed on disk while the jump ran; ask for the time again`;
    if (change === null) return { kind: 'refused', message: changedMessage };
    if (chain.state === 'invalid') {
      await leaveInvalidChain(key, chain, change);
      return { kind: 'refused', message: `${chain.name} is no longer a valid log chain` };
    }
    const outcome: TimeJumpOutcome = isRetry
      ? { kind: 'refused', message: changedMessage }
      : await jumpToTimeOnce(key, query, true);
    if (outcome.kind === 'refused' || outcome.kind === 'unsupported') {
      await findAnchorAgain(key, chain, change);
    } else if (outcome.kind !== 'superseded') {
      // The tab went where the jump asked: it looks for its old line no more.
      lostLines.delete(key);
    }
    return outcome;
  }

  /** Show the answer of a jump by time to `value`, and say where it landed. */
  async function showTimeAnswer(
    key: TabKey,
    { position, value }: { position: ChainPosition; value: string },
    request: ChainRequest,
    samples: ChainSamplesResponse,
  ): Promise<TimeJumpOutcome> {
    const instant = position.kind === 'time' ? position.ms : null;
    let found: ReturnType<typeof readChainTimeAnswer>;
    try {
      found = readChainTimeAnswer(samples, value);
      await applyAnswer(key, position, request, { kind: 'samples', samples }, true);
    } catch (error) {
      if (isAbortError(error)) return { kind: 'superseded' };
      showError(key, error);
      return { kind: 'refused', message: messageOf(error) };
    }
    if (!found.found) {
      if (instant !== null) timeCursor.set(instant);
      return { kind: 'none' };
    }
    const lineTime = found.window.lines.find((l) => l.lineNumber === found.line)?.timestampMs;
    const jumpInstant = instant ?? lineTime ?? null;
    deps.patchTab(key, () => ({ timeJump: jumpInstant }));
    if (jumpInstant !== null) timeCursor.set(jumpInstant);
    return { kind: 'found', line: found.line };
  }

  /**
   * Read the chain again, as its zone now asks, and show the anchor line.
   * A load still running for the tab (a jump by time in the old zone) is
   * cancelled first, so its answer cannot land after this one.
   */
  async function reload(key: TabKey): Promise<void> {
    if (!chainOf(key)) return;
    deps.loads.forget(key);
    reloadGenerations.set(key, (reloadGenerations.get(key) ?? 0) + 1);
    const running = readAgainInZone(key);
    runningReloads.set(key, running);
    try {
      await running;
    } finally {
      if (runningReloads.get(key) === running) runningReloads.delete(key);
    }
  }

  /**
   * The chain is described with the fingerprint of the files the tab
   * holds, so a change of them since (a rotation it has not seen) is
   * taken in as any other change. The anchor line is known by its text
   * only: the anchor's time was read in the old zone, and a zone moves
   * every time and never a text.
   */
  async function readAgainInZone(key: TabKey): Promise<void> {
    const known: KnownLine = { text: knownAnchorLine(key).text, timeMs: null };
    if (lostLines.has(key)) lostLines.set(key, known);
    const described = await describe(key);
    if (described === null) {
      deps.patchTab(key, () => ({ loading: false }));
      return;
    }
    if (described.isChanged) {
      lostLines.set(key, known);
      await readAgainAfterChange(key, described.chain);
      return;
    }
    if (described.chain.state === 'invalid') {
      deps.patchTab(key, () => ({ loading: false }));
      return;
    }
    await showAnchorLine(key, true, known);
  }

  /** Forget what was kept for the tab `key`; it is closing. */
  function forget(key: TabKey): void {
    describes.forget(key);
    stopFollow(key);
    goneTasks.delete(key);
    highlightGiven.delete(key);
    changeTimes.delete(key);
    pendingRounds.delete(key);
    stopDescribeWait(key);
    reloadGenerations.delete(key);
    runningReloads.delete(key);
    lostLines.delete(key);
    changeCounts.delete(key);
    chainTopLines.forget(key);
  }

  return {
    openChain,
    refresh,
    moveTo,
    loadMore,
    jumpToPosition,
    jumpToEnd,
    jumpToTime,
    reload,
    settle,
    confirmLine,
    checkLinkLine,
    forget,
  };
}
