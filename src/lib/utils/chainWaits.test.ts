import { describe, expect, it } from 'vitest';
import { CHANGE_WINDOW_MS, changesInWindow, waitBefore } from './chainWaits';

describe('waitBefore', () => {
  it('waits longer before each next index task a pending chain is followed through, then stops', () => {
    const waits = [1, 2, 3, 4, 5, 6].map((round) => waitBefore('taskEnded', round));

    expect(waits).toEqual([1000, 2000, 4000, 8000, 16_000, null]);
  });

  it('describes a chain with no index task again after a few seconds, longer each time, then stops', () => {
    const waits = [1, 2, 3, 4, 5, 8, 9].map((round) => waitBefore('noTask', round));

    expect(waits).toEqual([5000, 10_000, 20_000, 40_000, 60_000, 60_000, null]);
  });

  it('waits nothing before the first follow', () => {
    expect(waitBefore('taskEnded', 0)).toBe(0);
  });
});

describe('changesInWindow', () => {
  it('keeps the changes of the last minute and the one at `now`', () => {
    const now = 1_000_000;
    const times = [now - CHANGE_WINDOW_MS - 1, now - CHANGE_WINDOW_MS, now - 5000];

    expect(changesInWindow(times, now)).toEqual([now - CHANGE_WINDOW_MS, now - 5000, now]);
  });
});
