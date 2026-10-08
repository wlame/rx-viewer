/**
 * The key of an open tab.
 *
 * Everything that belongs to one tab is keyed by it: the open tabs
 * themselves (an open tab holds its key in `path`), the requests of each
 * tab, its pane, its search matches, the index build it follows and the
 * time zone chosen for it (the URL's `ftz=<zone>@<key>`).
 *
 * A file's key is its path. A log chain's key is `chain:` and its
 * handle: the handle (the chain's directory joined with its name) is
 * usually its active file's path, and the chain's tab and that file's tab
 * must not share anything. A path rx lists is absolute, so no file's key
 * starts with `chain:`.
 */
export type TabKey = string;

/** What starts the key of a chain. */
const CHAIN_KEY_PREFIX = 'chain:';

/** The key of the chain whose handle is `handle`. */
export function chainKey(handle: string): TabKey {
  return `${CHAIN_KEY_PREFIX}${handle}`;
}

/** Whether `key` is a chain's key rather than a file's. */
export function isChainKey(key: TabKey): boolean {
  return key.startsWith(CHAIN_KEY_PREFIX);
}

/** The handle of the chain `key` names, or null for a file's key. */
export function chainHandleOf(key: TabKey): string | null {
  return isChainKey(key) ? key.slice(CHAIN_KEY_PREFIX.length) : null;
}

/**
 * The files among the tab keys `keys`, by path: what a search of the
 * open files can name, since a single-file route takes no chain's key.
 */
export function fileKeys(keys: readonly TabKey[]): string[] {
  return keys.filter((key) => !isChainKey(key));
}

/**
 * The paths a chain search (`/v1/logs/trace`) of the open tabs names: a
 * chain's tab by its handle, which the search reads as the chain, and a
 * file's tab by its path, each path once, in tab order.
 */
export function chainSearchPaths(keys: readonly TabKey[]): string[] {
  return [...new Set(keys.map((key) => chainHandleOf(key) ?? key))];
}
