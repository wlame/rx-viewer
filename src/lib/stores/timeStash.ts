import { get, writable } from 'svelte/store';
import {
  addToStash,
  isStashFull,
  normalizeStash,
  removeFromStash,
  type StashAddOutcome,
} from '../utils/timeStash';

/**
 * The timestamps stash: up to seven saved moments (UTC ms), unique to
 * the millisecond and in time order. The `+` of the time cursor adds the
 * cursor to it; the stash row shows it and removes from it; the URL's
 * `stash` holds it, so a reload or a link keeps it. Back and Forward
 * leave it as it is.
 */
function createTimeStashStore() {
  const store = writable<readonly number[]>([]);

  return {
    subscribe: store.subscribe,
    /** Add `instantMs`, unless the stash holds it already or is full; returns which. */
    add(instantMs: number): StashAddOutcome {
      const result = addToStash(get(store), instantMs);
      if (result.outcome === 'added') store.set(result.stash);
      return result.outcome;
    },
    /** Remove `instantMs`. */
    remove: (instantMs: number) => store.update((stash) => removeFromStash(stash, instantMs)),
    /** Whether the stash holds `instantMs`. */
    has: (instantMs: number) => get(store).includes(instantMs),
    /** Whether the stash holds as many moments as it keeps. */
    isFull: () => isStashFull(get(store)),
    /** Make the stash hold `instants`, sorted, each once and at most seven of them. */
    replace: (instants: readonly number[]) => store.set(normalizeStash(instants)),
  };
}

export const timeStash = createTimeStashStore();
