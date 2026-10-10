/**
 * The view state the address bar carries, and its one serialized form.
 *
 * The URL names what a user would bookmark, share or come back to: the
 * active file or log chain, the line its view is anchored on or the
 * time it jumped to (in a chain, with the fingerprint of the files that
 * line was read in), its highlighting, filter and anomaly category, the
 * sidebar tab, whether rotated logs are grouped into chains, whether the
 * files panel shows its labels and which value it shows, the last
 * search, whether its results show byte offsets, the timestamps stash,
 * and the time zones chosen for files and chains. Each key has one row
 * in
 * `CODECS`, which reads it as untrusted input (a missing or invalid
 * value gives that key's default) and writes it back, leaving a value at
 * its default out of the link.
 *
 * This module is the only place that writes the view to `history`.
 * Secrets stay out of it: the API token arrives in the hash and is moved
 * to storage, and stripped from the address bar, before the app starts
 * (`apiToken.ts`).
 */
import type { TraceMatchingFlags } from '../types';
import {
  normalizeFileZones,
  parseFileZoneParam,
  serializeFileZoneParam,
  type FileZone,
} from './fileZones';
import { SEARCH_TOGGLES } from './searchToggles';
import { isChainKey } from './tabKey';
import { normalizeStash } from './timeStash';

/** The sidebar's two tabs. */
export type SidebarTab = 'tree' | 'search';

/** The value the files panel shows beside each row's name. */
export type ValueColumn = 'size' | 'date';

/** Every value the files panel can show, in the order the switch lists them. */
export const VALUE_COLUMNS: readonly ValueColumn[] = ['size', 'date'];

/** What the editor's regex filter does with the lines it matches. */
export type FilterMode = 'hide' | 'show' | 'highlight';

/** The editor's regex filter as the URL carries it. */
export interface FilterState {
  pattern: string;
  mode: FilterMode;
}

/** The cap the search panel starts with. */
export const DEFAULT_MAX_RESULTS = 100;

/** The highest cap the search panel accepts. */
const MAX_RESULTS_LIMIT = 10_000;

/** A search as the URL carries it: what the search panel needs to run it again. */
export interface SearchState {
  patterns: string[];
  maxResults: number;
  onlyOpenedFiles: boolean;
  /** Only the flags the panel's toggles can set. */
  flags: TraceMatchingFlags;
}

/** Everything the URL says about the view. */
export interface ViewState {
  /** The active file's path, or null when no file is open or a chain's tab is active. */
  file: string | null;
  /**
   * The handle of the active log chain's tab (its directory joined with
   * its name), or null when a file's tab or none is active. A link that
   * names a chain and a file opens the chain.
   */
  chain: string | null;
  /**
   * The part of the active chain that holds its anchor line, by its bare
   * file name, or null; always null without a chain. With a part, `line`
   * is the line's number in the part, as `rx samples PART` numbers it.
   */
  part: string | null;
  /**
   * The line the active file's view is anchored on (see `anchorLine.ts`
   * for the rule), or null to open the file at its start. In a chain,
   * the line's number in `part`.
   */
  line: number | null;
  /**
   * The instant (UTC ms) the active file jumped to by time, or null. A
   * link with a time and no line opens the file at the first line at or
   * after it; with both, the line wins.
   */
  time: number | null;
  /**
   * The fingerprint of the active chain's files that `part` and `line`
   * name a line of, or null; always null without a chain. When the
   * chain's files are others when the link is opened, `part` may name
   * another file and `line` another line.
   */
  fingerprint: string | null;
  /** Syntax highlighting on or off; null means the file's size-based default. */
  highlight: boolean | null;
  /** The active file's regex filter, or null for none. */
  filter: FilterState | null;
  /** The anomaly category highlighted in the active file, or null for none. */
  category: string | null;
  tab: SidebarTab;
  /** Rotated logs are grouped into log chains (`chains=1`). */
  chains: boolean;
  /** The files panel shows the labels of its rows (`labels=0` when off). */
  labels: boolean;
  /** The value the files panel shows beside each name (`show=date` for the date). */
  show: ValueColumn;
  /** The search results show byte offsets instead of line numbers. */
  offsets: boolean;
  /** The last search run, or null for none. */
  search: SearchState | null;
  /** The timestamps stash: up to seven instants (UTC ms), each once, in time order. */
  stash: readonly number[];
  /**
   * The time zone chosen for each file and chain, open or not, by tab
   * key (`chain:` and the handle for a chain), oldest choice first: at
   * most twenty, each once.
   */
  fileZones: readonly FileZone[];
}

/** The view of a link with no parameters. */
export const DEFAULT_VIEW: ViewState = {
  file: null,
  chain: null,
  part: null,
  line: null,
  time: null,
  fingerprint: null,
  highlight: null,
  filter: null,
  category: null,
  tab: 'tree',
  chains: false,
  labels: true,
  show: 'size',
  offsets: false,
  search: null,
  stash: [],
  fileZones: [],
};

/** One URL parameter written as name and value. */
type Param = [string, string];

/** How one key of the view reads from and writes to the URL. */
interface ParamCodec<T> {
  /** Every URL parameter this key owns; a write replaces all of them. */
  names: readonly string[];
  /** The value the parameters give, or the key's default when they give none. */
  parse(params: URLSearchParams): T;
  /** The parameters that say `value`; none when it is the default. */
  serialize(value: T, view: ViewState): Param[];
  /**
   * Whether changing the value from `previous` to `next` is a step the
   * user expects Back to undo, in the view it changes to. A key without
   * it never is: its changes rewrite the current entry.
   */
  isStep?: (previous: T, next: T, nextView: ViewState) => boolean;
}

/** A boolean URL parameter is on when it reads `1` or `true`. */
function isOn(value: string | null): boolean {
  return value === '1' || value === 'true';
}

/**
 * The values a boolean parameter that may be absent reads. A `Map`, not
 * an object: URL text such as `constructor` must not find an inherited
 * property.
 */
const OPTIONAL_BOOLEANS: ReadonlyMap<string, boolean> = new Map([
  ['1', true],
  ['true', true],
  ['0', false],
  ['false', false],
]);

/** A boolean parameter that may be absent: absent or unreadable is null. */
function optionalBoolean(value: string | null): boolean | null {
  return OPTIONAL_BOOLEANS.get(value ?? '') ?? null;
}

/** A non-empty string, or null. */
function nonEmpty(value: string | null): string | null {
  return value !== null && value.trim() !== '' ? value : null;
}

/** Whether `name` is a bare file name: not empty, without `/`, and neither `.` nor `..`. */
function isBareName(name: string): boolean {
  return name !== '' && !name.includes('/') && name !== '.' && name !== '..';
}

/**
 * Whether `value` is written as an absolute path, the way rx lists every
 * file and chain handle.
 */
function isAbsolutePath(value: string): boolean {
  return value.startsWith('/');
}

/**
 * The file a link names: an absolute path that is not a chain's tab key,
 * or null. A file's tab key is its path, so a chain key here would open a
 * file tab under the chain's key.
 */
function parseFile(params: URLSearchParams): string | null {
  const file = nonEmpty(params.get('file'));
  if (file === null || isChainKey(file) || !isAbsolutePath(file)) return null;
  return file;
}

/**
 * The chain handle a link names: an absolute path whose last element is
 * a bare name (the chain's name), or null.
 */
function parseChain(params: URLSearchParams): string | null {
  const handle = nonEmpty(params.get('chain'));
  if (handle === null || !isAbsolutePath(handle)) return null;
  return isBareName(handle.slice(handle.lastIndexOf('/') + 1)) ? handle : null;
}

/** The part a link names: a bare name, and only beside a chain; otherwise null. */
function parsePart(params: URLSearchParams): string | null {
  const part = params.get('part');
  if (part === null || parseChain(params) === null) return null;
  return isBareName(part) ? part : null;
}

/** A fingerprint of a chain's files as rx writes one: 16 lowercase hex digits. */
const FINGERPRINT = /^[0-9a-f]{16}$/;

/** The fingerprint a link names: 16 lowercase hex digits, and only beside a chain; otherwise null. */
function parseFingerprint(params: URLSearchParams): string | null {
  const fingerprint = params.get('fp');
  if (fingerprint === null || parseChain(params) === null) return null;
  return FINGERPRINT.test(fingerprint) ? fingerprint : null;
}

/** A whole number written in plain digits, from `min` up to the safe-integer limit, or null. */
function wholeNumber(value: string | null, min: number): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const number = Number(value);
  return number >= min && Number.isSafeInteger(number) ? number : null;
}

/** An instant as the URL writes it: RFC 3339 in UTC with milliseconds, `Z` at the end. */
const URL_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * The instant (UTC ms) a URL's time names, or null for anything but an
 * instant the viewer writes. A date that does not exist (February 30)
 * is refused, not moved to the next month.
 */
function urlInstant(value: string | null): number | null {
  if (value === null || !URL_INSTANT.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) || new Date(ms).toISOString() !== value ? null : ms;
}

/**
 * The stash a URL names: the instants of its comma-separated entries,
 * each written the way `time` is. An entry that is not one is dropped;
 * the rest are kept once each, in time order, the earliest seven.
 */
function parseStash(params: URLSearchParams): number[] {
  const entries = (params.get('stash') ?? '').split(',');
  return normalizeStash(entries.map(urlInstant).filter((ms): ms is number => ms !== null));
}

function serializeStash(stash: readonly number[]): Param[] {
  if (stash.length === 0) return [];
  return [['stash', stash.map((ms) => new Date(ms).toISOString()).join(',')]];
}

/**
 * The file zones a URL names: one repeated `ftz=<zone>@<path>` each. An
 * entry that names no valid zone and path is dropped; of a path named
 * twice the first is kept, and the first twenty are.
 */
function parseFileZones(params: URLSearchParams): FileZone[] {
  const entries = params.getAll('ftz').map(parseFileZoneParam);
  return normalizeFileZones(entries.filter((entry): entry is FileZone => entry !== null));
}

function serializeFileZones(fileZones: readonly FileZone[]): Param[] {
  return fileZones.map((fileZone) => ['ftz', serializeFileZoneParam(fileZone)]);
}

/** The search flag parameters the panel can set, named as /v1/trace names them. */
const SEARCH_FLAG_PARAMS = SEARCH_TOGGLES.map((spec) => spec.param);

/**
 * The search a URL names, or null when it names no pattern. An empty
 * pattern is dropped, a cap out of range falls back to the default, and
 * a flag the panel cannot set is ignored.
 */
function parseSearch(params: URLSearchParams): SearchState | null {
  const patterns = params.getAll('regexp').filter((pattern) => nonEmpty(pattern) !== null);
  if (patterns.length === 0) return null;

  const flags: TraceMatchingFlags = {};
  for (const name of SEARCH_FLAG_PARAMS) {
    if (isOn(params.get(name))) flags[name] = true;
  }
  const cap = wholeNumber(params.get('max_results'), 1);

  return {
    patterns,
    maxResults: cap !== null && cap <= MAX_RESULTS_LIMIT ? cap : DEFAULT_MAX_RESULTS,
    onlyOpenedFiles: isOn(params.get('only_opened')),
    flags,
  };
}

function serializeSearch(search: SearchState | null): Param[] {
  if (!search) return [];
  const out: Param[] = search.patterns.map((pattern) => ['regexp', pattern]);
  if (search.maxResults !== DEFAULT_MAX_RESULTS)
    out.push(['max_results', String(search.maxResults)]);
  if (search.onlyOpenedFiles) out.push(['only_opened', '1']);
  for (const name of SEARCH_FLAG_PARAMS) {
    if (search.flags[name]) out.push([name, '1']);
  }
  return out;
}

/** A tab's name in the URL, which is the label the user sees. */
const TAB_PARAM_VALUES: Record<SidebarTab, string> = { tree: 'files', search: 'search' };

/** The tab a link opens when it names none: a link with a search opens on its results. */
function defaultTab(hasSearch: boolean): SidebarTab {
  return hasSearch ? 'search' : 'tree';
}

const FILTER_MODES: readonly FilterMode[] = ['hide', 'show', 'highlight'];
const DEFAULT_FILTER_MODE: FilterMode = 'highlight';

/** The parse and serialize pair of every key, in the order a link lists them. */
const CODECS: { [K in keyof ViewState]: ParamCodec<ViewState[K]> } = {
  file: {
    names: ['file'],
    // A link that names a chain as well opens the chain.
    parse: (params) => (parseChain(params) === null ? parseFile(params) : null),
    serialize: (file) => (file === null ? [] : [['file', file]]),
    // Opening a file or switching to another is a step; closing the last
    // one is not, or Back would reopen a file that failed to open.
    isStep: (previous, next) => next !== null && next !== previous,
  },
  chain: {
    names: ['chain'],
    parse: parseChain,
    serialize: (chain) => (chain === null ? [] : [['chain', chain]]),
    // Opening a chain or switching to another is a step, as for a file.
    isStep: (previous, next) => next !== null && next !== previous,
  },
  // A move into another part is a move by line: it rewrites the entry.
  part: {
    names: ['part'],
    parse: parsePart,
    serialize: (part, view) => (part === null || view.chain === null ? [] : [['part', part]]),
  },
  line: {
    names: ['line'],
    parse: (params) => wholeNumber(params.get('line'), 1),
    serialize: (line) => (line === null ? [] : [['line', String(line)]]),
  },
  time: {
    names: ['time'],
    parse: (params) => urlInstant(params.get('time')),
    serialize: (time) => (time === null ? [] : [['time', new Date(time).toISOString()]]),
    // A jump by time is a step; moving by line afterwards drops it, and is
    // not. A chain's tab names the time of its anchor line, which every
    // scroll may change, so its time is no step.
    isStep: (previous, next, nextView) =>
      nextView.chain === null && next !== null && next !== previous,
  },
  // The chain's files changing on disk rewrites the entry.
  fingerprint: {
    names: ['fp'],
    parse: parseFingerprint,
    serialize: (fingerprint, view) =>
      fingerprint === null || view.chain === null ? [] : [['fp', fingerprint]],
  },
  highlight: {
    names: ['highlight'],
    parse: (params) => optionalBoolean(params.get('highlight')),
    serialize: (on) => (on === null ? [] : [['highlight', on ? '1' : '0']]),
  },
  filter: {
    names: ['filter', 'filter_mode'],
    parse: (params) => {
      const pattern = nonEmpty(params.get('filter'));
      if (pattern === null) return null;
      const mode = FILTER_MODES.find((m) => m === params.get('filter_mode'));
      return { pattern, mode: mode ?? DEFAULT_FILTER_MODE };
    },
    serialize: (filter) => {
      if (filter === null) return [];
      const out: Param[] = [['filter', filter.pattern]];
      if (filter.mode !== DEFAULT_FILTER_MODE) out.push(['filter_mode', filter.mode]);
      return out;
    },
  },
  category: {
    names: ['category'],
    parse: (params) => nonEmpty(params.get('category')),
    serialize: (category) => (category === null ? [] : [['category', category]]),
  },
  tab: {
    names: ['tab'],
    parse: (params) => {
      const named = (Object.keys(TAB_PARAM_VALUES) as SidebarTab[]).find(
        (tab) => TAB_PARAM_VALUES[tab] === params.get('tab'),
      );
      return named ?? defaultTab(parseSearch(params) !== null);
    },
    serialize: (tab, view) =>
      tab === defaultTab(view.search !== null) ? [] : [['tab', TAB_PARAM_VALUES[tab]]],
    isStep: (previous, next) => next !== previous,
  },
  // Turning chain mode on or off rewrites the current entry. A link
  // without `chains=1` opens with the mode off.
  chains: {
    names: ['chains'],
    parse: (params) => isOn(params.get('chains')),
    serialize: (on) => (on ? [['chains', '1']] : []),
  },
  // Hiding the labels or showing another value rewrites the current entry.
  labels: {
    names: ['labels'],
    parse: (params) => params.get('labels') !== '0',
    serialize: (on) => (on ? [] : [['labels', '0']]),
  },
  show: {
    names: ['show'],
    parse: (params) =>
      VALUE_COLUMNS.find((value) => value === params.get('show')) ?? DEFAULT_VIEW.show,
    serialize: (show) => (show === DEFAULT_VIEW.show ? [] : [['show', show]]),
  },
  offsets: {
    names: ['offsets'],
    parse: (params) => isOn(params.get('offsets')),
    serialize: (offsets) => (offsets ? [['offsets', '1']] : []),
  },
  search: {
    names: ['regexp', 'max_results', 'only_opened', ...SEARCH_FLAG_PARAMS],
    parse: parseSearch,
    serialize: serializeSearch,
    // Running a search is a step; dropping one is not.
    isStep: (previous, next) =>
      next !== null &&
      JSON.stringify(serializeSearch(previous)) !== JSON.stringify(serializeSearch(next)),
  },
  // Saving or removing a moment rewrites the current entry.
  stash: {
    names: ['stash'],
    parse: parseStash,
    serialize: serializeStash,
  },
  // Choosing or resetting a file's zone rewrites the current entry.
  fileZones: {
    names: ['ftz'],
    parse: parseFileZones,
    serialize: serializeFileZones,
  },
};

const VIEW_KEYS = Object.keys(CODECS) as (keyof ViewState)[];

/** Read one key with its codec; a helper so the key's type flows through. */
function parseKey<K extends keyof ViewState>(key: K, params: URLSearchParams): ViewState[K] {
  return CODECS[key].parse(params);
}

function serializeKey<K extends keyof ViewState>(key: K, view: ViewState): Param[] {
  return CODECS[key].serialize(view[key], view);
}

/** The view a query string (`?a=b…`, with or without the `?`) describes. */
export function parseViewState(query: string): ViewState {
  const params = new URLSearchParams(query);
  const view = { ...DEFAULT_VIEW };
  for (const key of VIEW_KEYS) Object.assign(view, { [key]: parseKey(key, params) });
  return view;
}

/**
 * The query string that says `view`, built on `current`: every parameter
 * a key owns is replaced, and any other parameter is kept. Returns `''`
 * when nothing is left.
 */
export function serializeViewState(view: ViewState, current: string): string {
  const params = new URLSearchParams(current);
  for (const key of VIEW_KEYS) {
    for (const name of CODECS[key].names) params.delete(name);
  }
  for (const key of VIEW_KEYS) {
    for (const [name, value] of serializeKey(key, view)) params.append(name, value);
  }
  const query = params.toString();
  return query === '' ? '' : `?${query}`;
}

/** The view the address bar describes now. */
export function readViewState(): ViewState {
  if (typeof window === 'undefined') return { ...DEFAULT_VIEW };
  return parseViewState(window.location.search);
}

/**
 * How a change reaches the browser's history: `push` adds an entry that
 * Back returns from, `replace` rewrites the current one.
 */
export type HistoryMode = 'push' | 'replace';

function isStepKey<K extends keyof ViewState>(
  key: K,
  previous: ViewState,
  next: ViewState,
): boolean {
  return CODECS[key].isStep?.(previous[key], next[key], next) ?? false;
}

/**
 * How the change from `previous` to `next` reaches history: a push when
 * any key changed in a way that is a step (opening a file or a chain,
 * running a search, switching the sidebar tab, a jump by time),
 * otherwise a replace (the line and its part, the highlighting, the
 * filter, the category, chain mode, the files panel's labels and value,
 * the offsets switch, the stash, the file zones).
 */
export function historyModeFor(previous: ViewState, next: ViewState): HistoryMode {
  return VIEW_KEYS.some((key) => isStepKey(key, previous, next)) ? 'push' : 'replace';
}

/**
 * Put `view` in the address bar. Nothing is written when the URL already
 * says the same, and a URL that says the same view in other bytes (an
 * encoding, an invalid value dropped) is replaced, never pushed, so an
 * unchanged view never adds an entry.
 */
export function writeViewState(view: ViewState, mode: HistoryMode): void {
  if (typeof window === 'undefined') return;

  const { pathname, search, hash } = window.location;
  const query = serializeViewState(view, search);
  if (query === search) return;

  const sameView = query === serializeViewState(parseViewState(search), search);
  const url = `${pathname}${query}${hash}`;
  if (mode === 'push' && !sameView) window.history.pushState(null, '', url);
  else window.history.replaceState(null, '', url);
}

/**
 * Debounce function for scroll events
 */
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number,
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      fn(...args);
    }, delay);
  };
}
