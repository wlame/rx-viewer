import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api';
import type { IndexData, TaskStatus } from '../types';
import { TaskPolls, pollTask } from './taskPolling';
import { isAbortError } from './latestRequest';

const PATH = '/var/log/app.log';
const INTERVAL = 1000;

function task(
  status: string,
  result: Partial<IndexData> | null = null,
  error?: string,
): TaskStatus {
  return {
    task_id: 't1',
    status,
    path: PATH,
    operation: 'index',
    started_at: null,
    completed_at: null,
    error: error ?? null,
    result: result as IndexData | null,
  };
}

/** A status source that answers with the given statuses in turn, then repeats the last. */
function statuses(...answers: (TaskStatus | Error)[]) {
  let call = 0;
  return vi.fn(async (_taskId: string, _signal: AbortSignal) => {
    const answer = answers[Math.min(call, answers.length - 1)];
    call++;
    if (answer instanceof Error) throw answer;
    return answer;
  });
}

/** Settle the poll's pending sleeps and fetches, one interval at a time. */
async function advance(intervals: number) {
  for (let i = 0; i < intervals; i++) await vi.advanceTimersByTimeAsync(INTERVAL);
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('pollTask', () => {
  it('resolves with the result once the task completes', async () => {
    const fetchStatus = statuses(
      task('queued'),
      task('running'),
      task('completed', { line_count: 7 }),
    );
    const result = pollTask('t1', {
      fetchStatus,
      signal: new AbortController().signal,
      intervalMs: INTERVAL,
    });

    await advance(3);

    await expect(result).resolves.toMatchObject({ line_count: 7 });
    expect(fetchStatus).toHaveBeenCalledTimes(3);
  });

  it('rejects with the task error when the task fails', async () => {
    const fetchStatus = statuses(task('failed', null, 'build index: disk full'));
    const result = pollTask('t1', {
      fetchStatus,
      signal: new AbortController().signal,
      intervalMs: INTERVAL,
    });
    result.catch(() => {});

    await advance(1);

    await expect(result).rejects.toThrow('build index: disk full');
  });

  // An analysis of a multi-gigabyte file runs longer than any fixed
  // number of attempts; a running task is still making progress.
  it('keeps polling past ten minutes while the task is running', async () => {
    const answers = [...Array.from({ length: 900 }, () => task('running')), task('completed', {})];
    const fetchStatus = statuses(...answers);
    const result = pollTask('t1', {
      fetchStatus,
      signal: new AbortController().signal,
      intervalMs: INTERVAL,
    });

    await advance(901);

    await expect(result).resolves.toEqual({});
  });

  it('stops polling and rejects with an abort error when the signal aborts', async () => {
    const fetchStatus = statuses(task('running'));
    const controller = new AbortController();
    const result = pollTask('t1', { fetchStatus, signal: controller.signal, intervalMs: INTERVAL });
    result.catch(() => {});

    await advance(2);
    controller.abort();
    const callsAtAbort = fetchStatus.mock.calls.length;
    await advance(10);

    await expect(result).rejects.toSatisfy(isAbortError);
    expect(fetchStatus).toHaveBeenCalledTimes(callsAtAbort);
  });

  it('rides out a single failed status request', async () => {
    const fetchStatus = statuses(
      task('running'),
      new TypeError('Failed to fetch'),
      task('completed', { line_count: 3 }),
    );
    const result = pollTask('t1', {
      fetchStatus,
      signal: new AbortController().signal,
      intervalMs: INTERVAL,
    });

    await advance(3);

    await expect(result).resolves.toMatchObject({ line_count: 3 });
  });

  it('gives up after several failed status requests in a row', async () => {
    const fetchStatus = statuses(new TypeError('Failed to fetch'));
    const result = pollTask('t1', {
      fetchStatus,
      signal: new AbortController().signal,
      intervalMs: INTERVAL,
    });
    result.catch(() => {});

    await advance(5);

    await expect(result).rejects.toThrow('Failed to fetch');
  });

  // A restarted backend forgets its tasks; asking again will not help.
  it('rejects at once when the backend no longer knows the task', async () => {
    const fetchStatus = statuses(new ApiError(404, 'Not Found', 'Task not found: t1'));
    const result = pollTask('t1', {
      fetchStatus,
      signal: new AbortController().signal,
      intervalMs: INTERVAL,
    });
    result.catch(() => {});

    await advance(1);

    await expect(result).rejects.toThrow('Task not found: t1');
    expect(fetchStatus).toHaveBeenCalledTimes(1);
  });

  it('reports every status it reads', async () => {
    const fetchStatus = statuses(task('queued'), task('running'), task('completed', {}));
    const seen: string[] = [];
    const result = pollTask('t1', {
      fetchStatus,
      signal: new AbortController().signal,
      intervalMs: INTERVAL,
      onStatus: (t) => seen.push(t.status),
    });

    await advance(3);
    await result;

    expect(seen).toEqual(['queued', 'running', 'completed']);
  });
});

describe('TaskPolls', () => {
  it('shares one poll between two callers of the same task on a path', async () => {
    const fetchStatus = statuses(
      task('running'),
      task('running'),
      task('completed', { line_count: 9 }),
    );
    const polls = new TaskPolls(fetchStatus, INTERVAL);

    const first = polls.join(PATH, 't1', { signal: new AbortController().signal });
    const second = polls.join(PATH, 't1', { signal: new AbortController().signal });
    await advance(3);

    await expect(first).resolves.toMatchObject({ line_count: 9 });
    await expect(second).resolves.toMatchObject({ line_count: 9 });
    expect(fetchStatus).toHaveBeenCalledTimes(3);
  });

  it('stops polling when the only caller leaves', async () => {
    const fetchStatus = statuses(task('running'));
    const polls = new TaskPolls(fetchStatus, INTERVAL);
    const caller = new AbortController();

    const result = polls.join(PATH, 't1', { signal: caller.signal });
    result.catch(() => {});
    await advance(2);
    caller.abort();
    const callsAtLeave = fetchStatus.mock.calls.length;
    await advance(10);

    await expect(result).rejects.toSatisfy(isAbortError);
    expect(fetchStatus).toHaveBeenCalledTimes(callsAtLeave);
    expect(polls.activeTask(PATH)).toBeNull();
  });

  it('keeps polling for the caller that stays when another leaves', async () => {
    const fetchStatus = statuses(task('running'), task('running'), task('completed', {}));
    const polls = new TaskPolls(fetchStatus, INTERVAL);
    const leaving = new AbortController();

    const left = polls.join(PATH, 't1', { signal: leaving.signal });
    left.catch(() => {});
    const stayed = polls.join(PATH, 't1', { signal: new AbortController().signal });
    leaving.abort();
    await advance(3);

    await expect(left).rejects.toSatisfy(isAbortError);
    await expect(stayed).resolves.toEqual({});
  });

  it('names the running task of a path and forgets it once the task ends', async () => {
    const fetchStatus = statuses(task('running'), task('completed', {}));
    const polls = new TaskPolls(fetchStatus, INTERVAL);

    const result = polls.join(PATH, 't1', { signal: new AbortController().signal });
    expect(polls.activeTask(PATH)).toBe('t1');
    await advance(2);
    await result;

    expect(polls.activeTask(PATH)).toBeNull();
  });

  it('passes each status to every caller that asked for it', async () => {
    const fetchStatus = statuses(task('running'), task('completed', {}));
    const polls = new TaskPolls(fetchStatus, INTERVAL);
    const first: string[] = [];
    const second: string[] = [];

    const a = polls.join(PATH, 't1', {
      signal: new AbortController().signal,
      onStatus: (t) => first.push(t.status),
    });
    const b = polls.join(PATH, 't1', {
      signal: new AbortController().signal,
      onStatus: (t) => second.push(t.status),
    });
    await advance(2);
    await Promise.all([a, b]);

    expect(first).toEqual(['running', 'completed']);
    expect(second).toEqual(['running', 'completed']);
  });
});
