/**
 * How long a log chain's tab waits before it asks about a pending chain
 * again, and how many times, so a chain that stays pending never makes
 * the tab ask in a tight loop or for ever.
 *
 * - `taskEnded`: a followed index task ended and the chain is still
 *   pending; the tab follows the next task the description names.
 * - `noTask`: the description (or an answer about one part) names no
 *   index task, because the backend has no place to start one
 *   (`index_build_refused`); the tab describes the chain again.
 *
 * Each wait doubles the one before, up to a cap; past the last round the
 * tab stops and says why. Also the window in which changes of a chain's
 * files count towards the tab's stop.
 */

/** Why a tab waits before asking about a pending chain again. */
export type PendingWaitKind = 'taskEnded' | 'noTask';

interface WaitPolicy {
  /** The wait before the first round. */
  firstMs: number;
  /** The longest wait. */
  maxMs: number;
  /** How many rounds the tab waits through before it stops. */
  rounds: number;
}

const PENDING_WAITS: Record<PendingWaitKind, WaitPolicy> = {
  taskEnded: { firstMs: 1000, maxMs: 16_000, rounds: 5 },
  noTask: { firstMs: 5000, maxMs: 60_000, rounds: 8 },
};

/**
 * The wait before round `round` of `kind` (1 for the first time it
 * happens; 0 waits nothing), or null past the last round: stop.
 */
export function waitBefore(kind: PendingWaitKind, round: number): number | null {
  if (round <= 0) return 0;
  const policy = PENDING_WAITS[kind];
  if (round > policy.rounds) return null;
  return Math.min(policy.maxMs, policy.firstMs * 2 ** (round - 1));
}

/** How far back the changes of a chain's files count. */
export const CHANGE_WINDOW_MS = 60_000;

/**
 * Changes of a chain's files (409 answers) a tab reads the chain again
 * through within `CHANGE_WINDOW_MS`; at the next one it stops and says
 * the files keep changing.
 */
export const MAX_CHANGES_IN_WINDOW = 2;

/** The change times `times` of the last window before `now`, with `now` added. */
export function changesInWindow(times: readonly number[], now: number): number[] {
  return [...times.filter((time) => now - time <= CHANGE_WINDOW_MS), now];
}
