import { writable } from 'svelte/store';

/**
 * The time cursor: the instant (UTC ms) of the last explicit jump by
 * time in any file, or null when none is set. `files` sets it when a
 * jump by time reads its value; the indicator in the tab row shows it
 * and clears it, and the timeline bar marks it on the active file's
 * axis. It never moves a file by itself.
 */
function createTimeCursorStore() {
  const store = writable<number | null>(null);

  return {
    subscribe: store.subscribe,
    /** Make `instantMs` the cursor. */
    set: (instantMs: number) => store.set(instantMs),
    /** Clear the cursor. */
    clear: () => store.set(null),
  };
}

export const timeCursor = createTimeCursorStore();
