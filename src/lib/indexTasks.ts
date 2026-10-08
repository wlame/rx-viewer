import { api, ApiError } from './api';
import { files, tree } from './stores';
import { commandLog, type CommandAction } from './stores/commands';
import { chainDirectoryOf } from './utils/chainTree';
import { taskPolls, watchTask } from './utils/taskPolling';
import type {
  ChainEntry,
  ChainIndexTaskResult,
  IndexResponse,
  IndexTaskResult,
  TaskConflictError,
  TaskStatus,
  TreeEntry,
} from './types';

/**
 * The tree's Analyze, Index and Re-index actions, from the request to
 * the refreshed tree badge and open file, and Index and Re-index of a
 * log chain's row.
 *
 * Every task of a file is followed through `taskPolls`, so an action on
 * a file whose task is already followed joins that poll instead of
 * starting another one. A chain's index task is followed through
 * `watchTask`, once per chain.
 */

export type TreeMenuAction = 'analyze' | 'index' | 'reindex';

export interface TreeMenuItem {
  action: TreeMenuAction;
  label: string;
}

const ANALYZE_ITEM: TreeMenuItem = { action: 'analyze', label: 'Analyze' };

/** The index item of a compressed file, keyed by whether it is indexed already. */
const INDEX_ITEM: Record<'true' | 'false', TreeMenuItem> = {
  false: { action: 'index', label: 'Index' },
  true: { action: 'reindex', label: 'Re-index' },
};

/**
 * The context-menu items of a tree entry.
 *
 * Only a text file has lines to index and analyse; the backend answers a
 * directory or a binary file with a 400. A plain file gets its index on
 * first use, so the explicit index item is offered on compressed files.
 */
export function treeMenuItems(
  entry: Pick<TreeEntry, 'type' | 'is_text' | 'is_compressed' | 'is_indexed'>,
): TreeMenuItem[] {
  if (entry.type !== 'file' || entry.is_text === false) return [];
  if (!entry.is_compressed) return [ANALYZE_ITEM];
  return [ANALYZE_ITEM, INDEX_ITEM[entry.is_indexed ? 'true' : 'false']];
}

/**
 * The context-menu items of a log chain's row: Index, or Re-index once
 * every part it needs is indexed. A chain of more than 10,000 parts has
 * none: the backend reads no part of it.
 */
export function chainMenuItems(
  chain: Pick<ChainEntry, 'is_indexed' | 'too_many_parts'>,
): TreeMenuItem[] {
  if (chain.too_many_parts) return [];
  return [INDEX_ITEM[chain.is_indexed ? 'true' : 'false']];
}

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;

/** The first words of every answer that a file's analysis is not available. */
const ANALYSIS_UNAVAILABLE = 'Analysis not available for this file';

/**
 * The backend answered an analysis request without an analysis: it
 * cannot analyse this file. The message says so, with the backend's
 * reason when it gave one.
 */
export class AnalysisUnavailableError extends Error {
  constructor(reason: string | null) {
    super(reason ? `${ANALYSIS_UNAVAILABLE}: ${reason}` : `${ANALYSIS_UNAVAILABLE}.`);
    this.name = 'AnalysisUnavailableError';
  }
}

/** The prose form of a running task's ID in a 409: "... (task: <id>)". */
const TASK_ID_IN_PROSE = /task:\s*([^\s)]+)/i;

/**
 * The ID of the task a 409 "already indexing" names, or null.
 *
 * Reads the structured `task_id` member of the error body first, and
 * falls back to the ID in the `detail` sentence for a backend that only
 * names the task there.
 */
export function conflictTaskId(error: unknown): string | null {
  if (!(error instanceof ApiError) || error.status !== HTTP_CONFLICT) return null;
  try {
    // Parsed, not trusted: a backend older than the field sends only `detail`.
    const body = JSON.parse(error.body) as Partial<TaskConflictError> | null;
    if (typeof body?.task_id === 'string' && body.task_id) return body.task_id;
  } catch {
    // Not JSON: only the prose can name the task.
  }
  return TASK_ID_IN_PROSE.exec(error.message)?.[1] ?? null;
}

interface IndexRequest {
  force: boolean;
  analyze: boolean;
  /** MB; 0 indexes a file of any size, which an explicit request wants. */
  threshold?: number;
}

/** Index requests wait for no dialog: their poll runs until the task ends. */
const NEVER_ABORTED = new AbortController().signal;

/** The cached index of a file, or null when it has none. */
async function cachedIndex(path: string, signal: AbortSignal): Promise<IndexResponse | null> {
  try {
    return await api.getIndex(path, { signal });
  } catch (error) {
    if (error instanceof ApiError && error.status === HTTP_NOT_FOUND) return null;
    throw error;
  }
}

interface IndexTaskOutcome {
  result: IndexTaskResult;
  /** The task was already running for the file (a 409), not started by this request. */
  joined: boolean;
}

/** Start an index task, or join the one a 409 names, and wait for its result. */
async function runIndexTask(
  path: string,
  request: IndexRequest,
  signal: AbortSignal,
  onStatus?: (task: TaskStatus) => void,
): Promise<IndexTaskOutcome> {
  let taskId: string;
  let joined = false;
  try {
    taskId = (await api.startIndex(path, request)).task_id;
  } catch (error) {
    const runningTaskId = conflictTaskId(error);
    if (!runningTaskId) throw error;
    taskId = runningTaskId;
    joined = true;
  }
  const result = await taskPolls.join(path, taskId, { signal, onStatus });
  return { result, joined };
}

/**
 * Ask for an analysis and wait for the task that answers it. A 400 is
 * the backend refusing to analyse the file, and its detail says why.
 */
async function requestAnalysis(
  path: string,
  signal: AbortSignal,
  onStatus?: (task: TaskStatus) => void,
): Promise<IndexTaskOutcome> {
  try {
    return await runIndexTask(path, { force: false, analyze: true }, signal, onStatus);
  } catch (error) {
    if (error instanceof ApiError && error.status === HTTP_BAD_REQUEST) {
      throw new AnalysisUnavailableError(error.message);
    }
    throw error;
  }
}

/**
 * Show a freshly built index in the tree and in the open file, and its
 * equivalent command in the command line.
 */
function publishIndex(
  path: string,
  indexData: IndexResponse,
  action: CommandAction,
): IndexResponse {
  tree.markIndexed(path, indexData.line_count ?? null);
  files.applyIndex(path, indexData);
  commandLog.record(indexData.cli_command, action);
  return indexData;
}

export interface AnalyzeOptions {
  /** Aborting it stops this caller's wait; the backend task runs on. */
  signal: AbortSignal;
  onStatus?: (task: TaskStatus) => void;
}

/**
 * The analysis of a file: the cached one when the cached index holds an
 * analysis, otherwise the result of an analysis task.
 *
 * An index written while the file was opened or searched has no
 * analysis, and is not shown as one. A task already running for the file
 * is joined; when it was a plain index build and ends without an
 * analysis, the analysis is asked for once that task is out of the way.
 *
 * Rejects with AnalysisUnavailableError when the backend cannot analyse
 * the file: it refused the request, or the analysis task it ran ended
 * without an analysis. Asking again would get the same answer, so no
 * further task is started; the index the task built is still shown.
 */
export async function analyzeFile(path: string, options: AnalyzeOptions): Promise<IndexResponse> {
  const { signal, onStatus } = options;

  const followedTaskId = taskPolls.activeTask(path);
  if (followedTaskId) {
    const joined = await taskPolls.join(path, followedTaskId, { signal, onStatus });
    if (joined.analysis_performed) return publishIndex(path, joined, 'analysis');
  } else {
    const cached = await cachedIndex(path, signal);
    if (cached?.analysis_performed) return publishIndex(path, cached, 'analysis');
  }

  let outcome = await requestAnalysis(path, signal, onStatus);
  // Only a task joined through a 409 can be a plain index build; a task
  // this request started was an analysis.
  if (!outcome.result.analysis_performed && outcome.joined) {
    outcome = await requestAnalysis(path, signal, onStatus);
  }
  publishIndex(path, outcome.result, 'analysis');
  if (!outcome.result.analysis_performed) throw new AnalysisUnavailableError(null);
  return outcome.result;
}

export interface IndexOptions {
  /** Rebuild an index that exists; without it the backend returns the cached one. */
  reindex: boolean;
}

/**
 * Build a file's index whatever its size, and show it in the tree and
 * the open file.
 *
 * A re-index keeps the analysis when the cached index has one, so the
 * open file does not lose its anomalies to a rebuild.
 */
export async function indexFile(path: string, options: IndexOptions): Promise<IndexResponse> {
  const { reindex } = options;
  const cached = reindex ? await cachedIndex(path, NEVER_ABORTED) : null;
  const request: IndexRequest = {
    force: reindex,
    analyze: cached?.analysis_performed ?? false,
    threshold: 0,
  };
  const { result } = await runIndexTask(path, request, NEVER_ABORTED);
  return publishIndex(path, result, 'index');
}

/**
 * How a chain's index task ended: `completed`, or `ended` when the
 * backend no longer knew the task (it keeps a finished task for a while
 * only), so only the listing says what it left.
 */
export type ChainIndexOutcome = { kind: 'completed' } | { kind: 'ended' };

/** The index run of each chain, by handle: a second request while one runs joins it. */
const chainIndexRuns = new Map<string, Promise<ChainIndexOutcome>>();

/** Requests that met the chain's files changing (a 409) sent again before giving up. */
const CHANGED_FILES_RETRIES = 1;

function nameOf(handle: string): string {
  return handle.slice(handle.lastIndexOf('/') + 1);
}

/**
 * Start or join the chain's index task, and return its ID. The backend
 * answers 409 when a part was replaced while it read the chain; the
 * request is sent once more, then refused.
 */
async function startChainIndex(handle: string, force: boolean): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const answer = await api.logIndex(handle, { force });
    if (answer.kind === 'task') return answer.task.task_id;
    if (attempt >= CHANGED_FILES_RETRIES) {
      throw new Error(`The files of ${nameOf(handle)} keep changing on disk; index it again later`);
    }
  }
}

function isChainIndexResult(result: TaskStatus['result']): result is ChainIndexTaskResult {
  return result !== null && 'built' in result;
}

/**
 * Build the chain's indexes and follow the task to its end; then show
 * what it built: the parts' tree badges, the chain's row (its directory's
 * chains listed again), its open tab (described again) and the command.
 */
async function runChainIndex(handle: string, force: boolean): Promise<ChainIndexOutcome> {
  const taskId = await startChainIndex(handle, force);
  const end = await watchTask(taskId, {
    fetchStatus: (id, signal) => api.getTaskStatus(id, { signal }),
    signal: NEVER_ABORTED,
  });
  if (end.kind === 'failed') {
    throw new Error(end.task.error || `The index task of ${nameOf(handle)} failed`);
  }
  const dir = chainDirectoryOf(handle);
  if (end.kind === 'completed' && isChainIndexResult(end.task.result)) {
    const result = end.task.result;
    for (const name of result.built) tree.markIndexed(`${dir}/${name}`, null);
    commandLog.record(result.cli_command, 'index');
  }
  await Promise.all([tree.refreshChains(dir), files.refreshChain(handle)]);
  return { kind: end.kind === 'completed' ? 'completed' : 'ended' };
}

/**
 * Build the line index of every part of the log chain `handle` (every
 * part again on re-index), and resolve when the chain's index task has
 * ended. Rejects with the task's error when it fails. A request while
 * the chain's index runs joins that run.
 */
export function indexChain(handle: string, options: IndexOptions): Promise<ChainIndexOutcome> {
  const running = chainIndexRuns.get(handle);
  if (running) return running;
  const run = runChainIndex(handle, options.reindex).finally(() => chainIndexRuns.delete(handle));
  chainIndexRuns.set(handle, run);
  return run;
}
