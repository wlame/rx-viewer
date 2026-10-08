import { writable } from 'svelte/store';
import type { ChainTopLine } from '../utils/chainPane';
import type { TabKey } from '../utils/tabKey';

/**
 * The line at the top of each log chain tab's view, by the tab's key,
 * for its caption (`syslog [3/12]`). The editor reports it as the view
 * scrolls; a tab not shown yet has none.
 */
function createChainTopLines() {
  const { subscribe, update } = writable<ReadonlyMap<TabKey, ChainTopLine>>(new Map());

  function isSame(a: ChainTopLine | undefined, b: ChainTopLine): boolean {
    return a?.partNumber === b.partNumber && a.part === b.part && a.localLine === b.localLine;
  }

  /** Keep the top line of the tab `key`; the same line again changes nothing. */
  function set(key: TabKey, top: ChainTopLine): void {
    update((tops) => (isSame(tops.get(key), top) ? tops : new Map(tops).set(key, top)));
  }

  /** Forget the tab `key`; it closed. */
  function forget(key: TabKey): void {
    update((tops) => {
      if (!tops.has(key)) return tops;
      const next = new Map(tops);
      next.delete(key);
      return next;
    });
  }

  return { subscribe, set, forget };
}

export const chainTopLines = createChainTopLines();
