import type { IndexBuild, IndexTaskResult, TaskStatus } from './types';
import { isAbortError } from './utils/latestRequest';
import type { TaskPolls } from './utils/taskPolling';
import type { TabKey } from './utils/tabKey';

/**
 * Following, in the background, the line index build a samples answer
 * named (`index_build`) while the file's lines already show.
 *
 * One build is followed per tab key (`utils/tabKey.ts`), so what a
 * chain's tab follows and what the file at its handle follows stay apart.
 * An answer that names the task already
 * followed changes nothing; one that names another task leaves the
 * older one. The task is polled through the app's shared `TaskPolls`,
 * so a load that waits for the same task, or an Index from the tree,
 * joins the same poll.
 */

/** What a followed build reports, each to the file it builds for. */
export interface FollowCallbacks {
  /** The build as it runs: at once with no progress, then at each status. */
  onStatus: (build: IndexBuild) => void;
  /** The index the build made. */
  onBuilt: (index: IndexTaskResult) => void;
  /** The build failed, or its task cannot be followed any more. */
  onFailed: (error: unknown) => void;
}

interface Follow {
  taskId: string;
  controller: AbortController;
}

export class IndexBuildFollows {
  private follows = new Map<TabKey, Follow>();

  constructor(private readonly polls: Pick<TaskPolls, 'join'>) {}

  /** The task followed for `key`, or null when none is. */
  followedTask(key: TabKey): string | null {
    return this.follows.get(key)?.taskId ?? null;
  }

  /** Follow the build `taskId` of the tab `key` until it ends or `stop` is called. */
  follow(key: TabKey, taskId: string, callbacks: FollowCallbacks): void {
    if (this.followedTask(key) === taskId) return;
    this.stop(key);

    const follow: Follow = { taskId, controller: new AbortController() };
    this.follows.set(key, follow);
    callbacks.onStatus({ taskId, progress: null });

    const isCurrent = () => this.follows.get(key) === follow;
    this.polls
      .join(key, taskId, {
        signal: follow.controller.signal,
        onStatus: (task: TaskStatus) => {
          if (isCurrent()) callbacks.onStatus({ taskId, progress: task.progress });
        },
      })
      .then(
        (index) => {
          if (!isCurrent()) return;
          this.follows.delete(key);
          callbacks.onBuilt(index);
        },
        (error: unknown) => {
          // A stopped follow reports nothing: its file is closed or follows another build.
          if (!isCurrent() || isAbortError(error)) return;
          this.follows.delete(key);
          callbacks.onFailed(error);
        },
      );
  }

  /** Stop following the build of the tab `key`; the backend's build runs on. */
  stop(key: TabKey): void {
    this.follows.get(key)?.controller.abort();
    this.follows.delete(key);
  }
}
