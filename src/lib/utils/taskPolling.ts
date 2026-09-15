import { api, ApiError } from '../api';
import type { IndexTaskResult, TaskStatus } from '../types';

/**
 * Following a background index task (`POST /v1/index`) to its end.
 *
 * A poll has no attempt cap: an analysis of a multi-gigabyte file can run
 * for longer than any fixed limit, and a task that still reports `queued`
 * or `running` is making progress. A poll ends when the task ends, when
 * the backend stops answering, or when everyone waiting for it has left.
 */

/** Reads one task status; the signal cancels the request. */
export type FetchTaskStatus = (taskId: string, signal: AbortSignal) => Promise<TaskStatus>;

/** What a task status means for the poll loop. A status not listed keeps the poll going. */
const TASK_OUTCOME: Record<string, 'completed' | 'failed'> = {
  completed: 'completed',
  failed: 'failed',
};

const DEFAULT_INTERVAL_MS = 1000;

/** Status requests that may fail in a row before the poll gives up. */
const MAX_CONSECUTIVE_ERRORS = 3;

const HTTP_NOT_FOUND = 404;

export interface PollOptions {
  fetchStatus: FetchTaskStatus;
  signal: AbortSignal;
  intervalMs?: number;
  onStatus?: (task: TaskStatus) => void;
}

function abortError(): Error {
  const error = new Error('Task polling stopped');
  error.name = 'AbortError';
  return error;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** A 404 means the backend has forgotten the task (a restart, or its retention ran out). */
function isTaskGone(error: unknown): boolean {
  return error instanceof ApiError && error.status === HTTP_NOT_FOUND;
}

/**
 * Whether a task result is an index task's: only an index has a line
 * index, and a compress result has none.
 */
function isIndexTaskResult(result: TaskStatus['result']): result is IndexTaskResult {
  return result !== null && 'line_index' in result;
}

/** The index a completed task built; a task that built none is an error, not an empty index. */
function completedIndex(task: TaskStatus): IndexTaskResult {
  if (isIndexTaskResult(task.result)) return task.result;
  throw new Error(`Task ${task.task_id} completed without an index result`);
}

/**
 * Poll one index task until it completes, and resolve with its result.
 *
 * Rejects when the task completes without an index result, with the
 * task's own error when it fails, with the last request
 * error after several failed requests in a row or a 404, and with an
 * `AbortError` when the signal aborts.
 */
export async function pollTask(taskId: string, options: PollOptions): Promise<IndexTaskResult> {
  const { fetchStatus, signal, intervalMs = DEFAULT_INTERVAL_MS, onStatus } = options;
  let consecutiveErrors = 0;

  for (;;) {
    if (signal.aborted) throw abortError();

    let task: TaskStatus | null = null;
    try {
      task = await fetchStatus(taskId, signal);
      consecutiveErrors = 0;
    } catch (error) {
      if (signal.aborted) throw abortError();
      consecutiveErrors++;
      if (isTaskGone(error) || consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) throw error;
    }

    if (task) {
      onStatus?.(task);
      const outcome = TASK_OUTCOME[task.status];
      if (outcome === 'completed') return completedIndex(task);
      if (outcome === 'failed') throw new Error(task.error || `Task ${taskId} failed`);
    }

    await sleep(intervalMs, signal);
  }
}

interface JoinOptions {
  /** Aborting it means this caller has stopped waiting. */
  signal: AbortSignal;
  onStatus?: (task: TaskStatus) => void;
}

interface Poll {
  taskId: string;
  controller: AbortController;
  result: Promise<IndexTaskResult>;
  callers: number;
  listeners: Set<(task: TaskStatus) => void>;
}

/**
 * One poll per file path, shared by everyone waiting on that file's task.
 *
 * A second caller for the task already followed joins the running poll
 * instead of starting another loop. Each caller leaves by aborting its
 * own signal; the poll stops when the last caller has left.
 */
export class TaskPolls {
  private polls = new Map<string, Poll>();

  constructor(
    private readonly fetchStatus: FetchTaskStatus,
    private readonly intervalMs = DEFAULT_INTERVAL_MS,
  ) {}

  /** The task followed for this path, or null when nothing is. */
  activeTask(path: string): string | null {
    return this.polls.get(path)?.taskId ?? null;
  }

  /**
   * Wait for a task's result, joining the poll already running for it.
   *
   * Rejects with an `AbortError` as soon as this caller's signal aborts,
   * whether or not other callers keep the poll alive.
   */
  join(path: string, taskId: string, options: JoinOptions): Promise<IndexTaskResult> {
    const poll = this.pollFor(path, taskId);
    const { signal, onStatus } = options;
    poll.callers++;
    if (onStatus) poll.listeners.add(onStatus);

    return new Promise<IndexTaskResult>((resolve, reject) => {
      let hasLeft = false;
      const leave = () => {
        if (hasLeft) return;
        hasLeft = true;
        signal.removeEventListener('abort', onAbort);
        if (onStatus) poll.listeners.delete(onStatus);
        poll.callers--;
        if (poll.callers === 0) this.stop(path, poll);
      };
      const onAbort = () => {
        leave();
        reject(abortError());
      };

      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
      poll.result.then(
        (value) => {
          leave();
          resolve(value);
        },
        (error) => {
          leave();
          reject(error);
        },
      );
    });
  }

  private pollFor(path: string, taskId: string): Poll {
    const running = this.polls.get(path);
    if (running && running.taskId === taskId) return running;

    const controller = new AbortController();
    const listeners = new Set<(task: TaskStatus) => void>();
    const poll: Poll = {
      taskId,
      controller,
      callers: 0,
      listeners,
      result: pollTask(taskId, {
        fetchStatus: this.fetchStatus,
        signal: controller.signal,
        intervalMs: this.intervalMs,
        onStatus: (task) => listeners.forEach((listener) => listener(task)),
      }),
    };
    // Every caller receives the outcome through its own promise; this
    // keeps a poll whose callers have all left from reporting an
    // unhandled rejection.
    poll.result.catch(() => {});
    poll.result.finally(() => this.forget(path, poll)).catch(() => {});
    this.polls.set(path, poll);
    return poll;
  }

  private stop(path: string, poll: Poll): void {
    poll.controller.abort();
    this.forget(path, poll);
  }

  /** Drop the path's entry, unless a newer poll has already replaced it. */
  private forget(path: string, poll: Poll): void {
    if (this.polls.get(path) === poll) this.polls.delete(path);
  }
}

/** The polls of the whole app: one per file path. */
export const taskPolls = new TaskPolls((taskId, signal) => api.getTaskStatus(taskId, { signal }));
