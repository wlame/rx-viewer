import { describe, expect, it, vi } from 'vitest';
import type { IndexBuild, IndexTaskResult, TaskStatus } from './types';
import { IndexBuildFollows, type FollowCallbacks } from './indexBuildFollows';

/** A poll the test ends by hand, and what each caller asked of it. */
function heldPolls() {
  const joins: {
    path: string;
    taskId: string;
    signal: AbortSignal;
    onStatus?: (task: TaskStatus) => void;
    resolve: (index: IndexTaskResult) => void;
    reject: (error: unknown) => void;
  }[] = [];
  const polls = {
    join: vi.fn(
      (
        path: string,
        taskId: string,
        options: { signal: AbortSignal; onStatus?: (task: TaskStatus) => void },
      ) =>
        new Promise<IndexTaskResult>((resolve, reject) => {
          joins.push({ path, taskId, ...options, resolve, reject });
          options.signal.addEventListener('abort', () => {
            const error = new Error('stopped');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    ),
  };
  return { polls, joins };
}

function callbacks() {
  const seen: IndexBuild[] = [];
  const built: IndexTaskResult[] = [];
  const failed: unknown[] = [];
  const handlers: FollowCallbacks = {
    onStatus: (build) => seen.push(build),
    onBuilt: (index) => built.push(index),
    onFailed: (error) => failed.push(error),
  };
  return { handlers, seen, built, failed };
}

const INDEX = { line_count: 42_554_368, file_type: 'text' } as IndexTaskResult;

/** Lets the promise callbacks run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('IndexBuildFollows', () => {
  it('shows the build at once, then its progress, then hands over the index it built', async () => {
    const { polls, joins } = heldPolls();
    const follows = new IndexBuildFollows(polls);
    const { handlers, seen, built, failed } = callbacks();

    follows.follow('/logs/core.log', 't1', handlers);
    joins[0].onStatus?.({ task_id: 't1', progress: 0.42 } as TaskStatus);
    joins[0].resolve(INDEX);
    await settle();

    expect(seen).toEqual([
      { taskId: 't1', progress: null },
      { taskId: 't1', progress: 0.42 },
    ]);
    expect(built).toEqual([INDEX]);
    expect(failed).toEqual([]);
    expect(follows.followedTask('/logs/core.log')).toBeNull();
  });

  it('joins the task once when several answers name it', () => {
    const { polls } = heldPolls();
    const follows = new IndexBuildFollows(polls);
    const { handlers } = callbacks();

    follows.follow('/logs/core.log', 't1', handlers);
    follows.follow('/logs/core.log', 't1', handlers);

    expect(polls.join).toHaveBeenCalledTimes(1);
    expect(follows.followedTask('/logs/core.log')).toBe('t1');
  });

  it('reports a failed build', async () => {
    const { polls, joins } = heldPolls();
    const follows = new IndexBuildFollows(polls);
    const { handlers, built, failed } = callbacks();

    follows.follow('/logs/core.log', 't1', handlers);
    joins[0].reject(new Error('disk full'));
    await settle();

    expect(built).toEqual([]);
    expect(failed).toEqual([new Error('disk full')]);
    expect(follows.followedTask('/logs/core.log')).toBeNull();
  });

  it('stops following when told, and reports nothing after', async () => {
    const { polls, joins } = heldPolls();
    const follows = new IndexBuildFollows(polls);
    const { handlers, built, failed } = callbacks();

    follows.follow('/logs/core.log', 't1', handlers);
    follows.stop('/logs/core.log');
    await settle();
    joins[0].resolve(INDEX);
    await settle();

    expect(joins[0].signal.aborted).toBe(true);
    expect(built).toEqual([]);
    expect(failed).toEqual([]);
    expect(follows.followedTask('/logs/core.log')).toBeNull();
  });

  it('leaves the older task for a newer one of the same file', async () => {
    const { polls, joins } = heldPolls();
    const follows = new IndexBuildFollows(polls);
    const { handlers, built, failed } = callbacks();

    follows.follow('/logs/core.log', 't1', handlers);
    follows.follow('/logs/core.log', 't2', handlers);
    joins[1].resolve(INDEX);
    await settle();

    expect(joins[0].signal.aborted).toBe(true);
    expect(built).toEqual([INDEX]);
    expect(failed).toEqual([]);
  });

  it('follows each file on its own', () => {
    const { polls, joins } = heldPolls();
    const follows = new IndexBuildFollows(polls);
    const { handlers } = callbacks();

    follows.follow('/logs/a.log', 't1', handlers);
    follows.follow('/logs/b.log', 't2', handlers);
    follows.stop('/logs/a.log');

    expect(joins[0].signal.aborted).toBe(true);
    expect(joins[1].signal.aborted).toBe(false);
    expect(follows.followedTask('/logs/b.log')).toBe('t2');
  });
});
