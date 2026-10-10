import { derived, get } from 'svelte/store';
import { chainMode } from './stores/chainMode';
import { carryZone, chainOfFile, isTurningTabs, switchChainMode } from './stores/chainModeSwitch';
import { activeOpenFile, defaultSyntaxHighlighting, files } from './stores/files';
import { filesView } from './stores/filesView';
import { fileZones } from './stores/fileZones';
import { notifications } from './stores/notifications';
import { searchShowsOffsets, sidebarTab } from './stores/layout';
import { timeStash } from './stores/timeStash';
import { searchRequest, trace } from './stores/trace';
import { tree } from './stores/tree';
import {
  DEFAULT_VIEW,
  historyModeFor,
  readViewState,
  serializeViewState,
  writeViewState,
  type SearchState,
  type ViewState,
} from './utils/urlState';
import { nameOf } from './utils/chainSwitch';
import { fileZoneOf } from './utils/fileZones';
import { chainHandleOf, chainKey } from './utils/tabKey';
import type { ChainPosition } from './stores/chainTabs';
import type { ChainTab, OpenFile, TreeNode } from './types';

/**
 * The URL and the app's state, kept equal in both directions.
 *
 * `startViewSync` writes the URL from the stores: the URL is a
 * projection of the view, so no component writes it. A change that is a
 * step (opening a file, running a search, switching the sidebar tab)
 * adds a history entry; any other change rewrites the current one.
 * `restoreView` does the reverse and brings the stores to the view a URL
 * describes, on page load and when Back or Forward moves through the
 * entries.
 *
 * The timestamps stash and the file zones are read from the URL on page
 * load only (`loadView`). A moment saved or a zone chosen after an entry
 * was made is not in that entry, so Back and Forward keep both as they
 * are and write them into the entry they reach.
 */

/** The part of the view that belongs to the active file. */
type FileView = Pick<ViewState, 'file' | 'line' | 'time' | 'highlight' | 'filter' | 'category'>;

/**
 * What the URL says about a file: its path, its anchor line (left out at
 * line 1) or, while a jump by time put it there, that time instead, its
 * highlighting when it differs from the size-based default, its filter
 * when one is applied, and its anomaly category.
 */
export function fileViewOf(file: OpenFile | undefined): FileView {
  if (!file) {
    return { file: null, line: null, time: null, highlight: null, filter: null, category: null };
  }

  const filter = file.regexFilter;
  const isFilterApplied = Boolean(filter?.enabled && filter.pattern.trim() !== '');
  const isDefaultHighlighting =
    file.syntaxHighlighting === defaultSyntaxHighlighting(file.fileSize);
  return {
    file: file.path,
    line: file.timeJump === null && file.anchorLine > 1 ? file.anchorLine : null,
    time: file.timeJump,
    highlight: isDefaultHighlighting ? null : file.syntaxHighlighting,
    filter: filter && isFilterApplied ? { pattern: filter.pattern, mode: filter.mode } : null,
    category: file.selectedAnomalyCategory,
  };
}

/** The part of the view that belongs to the active tab, a file's or a chain's. */
type TabView = FileView & Pick<ViewState, 'chain' | 'part' | 'fingerprint'>;

/**
 * The fingerprint of the files a chain's tab names its anchor line in:
 * the one a link named it with while the tab has not read it, else that
 * of the tab's description, from whose files it read the line. Null
 * without an anchor or before the tab knows either.
 */
function anchorFingerprintOf(chain: ChainTab | undefined): string | null {
  const anchor = chain?.anchor ?? null;
  if (anchor === null) return null;
  return anchor.fingerprint ?? chain?.description?.fingerprint ?? null;
}

/**
 * What the URL says about the active tab. A file's tab is its
 * `fileViewOf`, with no chain. A chain's tab names the chain by its
 * handle, never as a file, and its anchor line by the part that holds
 * it, its line in that part (left out at line 1), its timestamp, which
 * finds the line again when the part is gone, and the fingerprint of the
 * files it read the line in, which tells a link opened after a rotation
 * that the part's name may hold another file.
 */
export function tabViewOf(tab: OpenFile | undefined): TabView {
  const view = fileViewOf(tab);
  const handle = tab ? chainHandleOf(tab.path) : null;
  if (handle === null) return { ...view, chain: null, part: null, fingerprint: null };
  const anchor = tab?.chain?.anchor ?? null;
  return {
    ...view,
    file: null,
    chain: handle,
    part: anchor?.part ?? null,
    line: anchor !== null && anchor.line > 1 ? anchor.line : null,
    time: anchor?.timeMs ?? null,
    fingerprint: anchorFingerprintOf(tab?.chain),
  };
}

/**
 * Where a link puts a chain's tab: at a part's line (line 1 without a
 * line), found again by the time when the part is gone; at a time; at a
 * global line; or at its start. A part's line and a global line carry
 * the fingerprint of the files the link named them in.
 */
export function chainPositionOf(
  view: Pick<ViewState, 'part' | 'line' | 'time' | 'fingerprint'>,
): ChainPosition {
  const { fingerprint } = view;
  if (view.part !== null) {
    return { kind: 'local', part: view.part, line: view.line ?? 1, timeMs: view.time, fingerprint };
  }
  if (view.time !== null) return { kind: 'time', ms: view.time };
  if (view.line !== null) return { kind: 'global', line: view.line, fingerprint };
  return { kind: 'start' };
}

/** The view the stores describe now. */
const currentView = derived(
  [
    files,
    sidebarTab,
    chainMode,
    filesView,
    searchShowsOffsets,
    searchRequest,
    timeStash,
    fileZones,
  ],
  ([$files, $tab, $chains, $filesView, $offsets, $search, $stash, $fileZones]): ViewState => ({
    ...tabViewOf(activeOpenFile($files)),
    tab: $tab,
    chains: $chains,
    labels: $filesView.labels,
    show: $filesView.show,
    offsets: $offsets,
    search: $search,
    stash: $stash,
    fileZones: $fileZones,
  }),
);

/** Restores in progress. While one runs, its changes rewrite the entry Back moved to. */
let runningRestores = 0;

/** Bumped by every restore, so an older one that is still waiting stops. */
let restoreGeneration = 0;

/**
 * Keep the address bar equal to the view, and the view equal to the
 * entry Back or Forward moves to. Returns the function that stops both.
 */
export function startViewSync(): () => void {
  // A restore and a chain mode switch turning tabs over rewrite the entry.
  const stopWriting = currentView.subscribe((view) => {
    const isRewrite = runningRestores > 0 || isTurningTabs();
    const mode = isRewrite ? 'replace' : historyModeFor(readViewState(), view);
    writeViewState(view, mode);
  });

  const restoreEntry = () => {
    runningRestores += 1;
    restoreView(readViewState())
      .catch((e) => console.error('Failed to restore the view of a history entry:', e))
      .finally(() => {
        runningRestores -= 1;
        // The entry holds the stash and the zones of its time; the live ones replace them.
        writeViewState(get(currentView), 'replace');
      });
  };
  window.addEventListener('popstate', restoreEntry);

  return () => {
    stopWriting();
    window.removeEventListener('popstate', restoreEntry);
  };
}

/** Two searches are the same when a link would say the same for both. */
function isSameSearch(a: SearchState | null, b: SearchState | null): boolean {
  const query = (search: SearchState | null) => serializeViewState({ ...DEFAULT_VIEW, search }, '');
  return query(a) === query(b);
}

/**
 * Make `search` the current search. A different search drops the old
 * answer; the search panel runs the new one once the backend can take it.
 */
function restoreSearch(search: SearchState | null): void {
  if (isSameSearch(search, get(searchRequest))) return;
  trace.clear();
  searchRequest.set(search);
}

/** Reveal a file in the tree, and return its entry when the tree lists it. */
async function locateInTree(path: string): Promise<TreeNode | null> {
  await tree.expandToPath(path);
  return tree.nodeAt(path);
}

/**
 * Move an open file to the time a view names, which also makes it the
 * time cursor. A time the backend refuses for this file leaves it where
 * it is, with a notice.
 */
async function jumpToViewTime(path: string, time: number): Promise<void> {
  const outcome = await files.jumpToTime(path, time);
  if (outcome.kind !== 'refused') return;
  const name = path.split('/').pop() ?? path;
  notifications.error(`Cannot go to the time in ${name}: ${outcome.message}`, 5000);
}

/**
 * Open the file a view names, or bring it forward when it is open, at
 * the view's line, or at its time when it names a time and no line, and
 * with its highlighting. The file is in the store when this resolves;
 * the returned load resolves when its lines arrive.
 */
async function showFile(
  path: string,
  view: ViewState,
  isCurrent: () => boolean,
): Promise<{ loaded: Promise<void> } | null> {
  const open = get(files).openFiles.find((f) => f.path === path);
  const line = view.line ?? 1;
  const time = view.line === null ? view.time : null;

  if (open) {
    // A file brought forward shows the top of its loaded lines, so its
    // line is revealed again unless it is already on screen.
    const isActive = activeOpenFile(get(files))?.path === path;
    const isOnScreen =
      isActive && (time === null ? open.anchorLine === line : open.timeJump === time);
    files.setActiveFile(path);
    files.setSyntaxHighlighting(path, view.highlight ?? defaultSyntaxHighlighting(open.fileSize));
    if (isOnScreen) return { loaded: Promise.resolve() };
    return { loaded: time === null ? files.jumpToLine(path, line) : jumpToViewTime(path, time) };
  }

  // The size-based default needs the file's size, which the tree lists.
  // With the highlighting given, the tree is revealed alongside the load.
  const located = locateInTree(path);
  const node = view.highlight === null ? await located : null;
  if (!isCurrent()) return null;
  // openFile puts the file in the store before its first await.
  const loaded = files.openFile(path, {
    scrollToLine: view.line ?? undefined,
    fileSize: node?.size ?? null,
    syntaxHighlighting: view.highlight ?? undefined,
    isIndexed: node?.is_indexed ?? undefined,
    lineCount: node?.line_count ?? undefined,
    compressionFormat: node?.compression_format ?? null,
  });
  if (time === null) return { loaded };
  // The jump takes over from the load of the file's start.
  return { loaded: Promise.all([loaded, jumpToViewTime(path, time)]).then(() => undefined) };
}

/**
 * Whether a chain's tab is on the position a view names: at its part and
 * line, or its global line, in the files the view names them in.
 */
function isOnPosition(tab: OpenFile, position: ChainPosition): boolean {
  const anchor = tab.chain?.anchor ?? null;
  if (position.kind === 'local') {
    const isSameFiles =
      position.fingerprint == null || position.fingerprint === anchorFingerprintOf(tab.chain);
    return (
      isSameFiles &&
      anchor !== null &&
      anchor.part === position.part &&
      anchor.line === position.line
    );
  }
  if (position.kind === 'global') {
    const isSameFiles =
      position.fingerprint == null || position.fingerprint === tab.chain?.description?.fingerprint;
    return isSameFiles && tab.chain?.numbering === 'global' && tab.anchorLine === position.line;
  }
  return false;
}

/** `position` without the time of its line: a time that names another instant names nothing. */
function withoutLineTime(position: ChainPosition): ChainPosition {
  return position.kind === 'local' ? { ...position, timeMs: null } : position;
}

/**
 * Open the chain a view names, or bring its tab forward, at the view's
 * part and line (by its time when the part is gone), or at `position`,
 * with its highlighting and filter. Resolves when its lines arrive.
 *
 * A link made on files that are not the chain's now (its fingerprint is
 * another) goes by the time of its line, or to the start without one,
 * with a notice (`stores/chainTabs.ts`): after a rotation the part's
 * name may hold another file. Any other link's part's line is checked
 * once shown (`files.checkChainLinkLine`) against its time, when it has
 * one: the same fingerprint does not tell an active file rewritten in
 * place from the one the link was made on. A link with neither a
 * fingerprint nor a time gets a notice that it names the files as they
 * are when it is opened. The time of a line written in another zone than
 * the chain is read in now names another instant, and is not used.
 */
async function showChain(
  handle: string,
  view: ViewState,
  named: ChainPosition = chainPositionOf(view),
): Promise<void> {
  const key = chainKey(handle);
  const position = isReadInViewZone(view, key) ? named : withoutLineTime(named);
  const open = get(files).openFiles.find((f) => f.path === key);
  if (open) {
    files.setActiveFile(key);
    if (view.highlight !== null) files.setSyntaxHighlighting(key, view.highlight);
    files.setRegexFilter(key, view.filter);
    if (!isOnPosition(open, position)) await files.goToChainLine(key, position);
  } else {
    const loaded = files.openChain(handle, {
      position,
      syntaxHighlighting: view.highlight ?? undefined,
    });
    files.setRegexFilter(key, view.filter);
    await loaded;
  }
  if (position.kind === 'local') await files.checkChainLinkLine(key, position);
}

/**
 * Whether the chain or file of `key` is read in the zone the view names
 * for it, the zone its times were written in: a zone moves every time, so
 * a time written in another zone names another instant. A link sets its
 * zones before it opens anything; Back and Forward leave them as they are.
 */
function isReadInViewZone(view: Pick<ViewState, 'fileZones'>, key: string): boolean {
  return fileZoneOf(view.fileZones, key) === fileZones.zoneOf(key);
}

/**
 * Where a chain's tab goes for a view that names one of its parts as a
 * file: the file's line in that part, checked against the view's time
 * when it names one too, or the time the view jumped the file to. A file
 * view carries no fingerprint: it names the file at its path when it is
 * opened.
 */
function partPosition(path: string, view: ViewState): ChainPosition {
  if (view.line === null && view.time !== null) return { kind: 'time', ms: view.time };
  return { kind: 'local', part: nameOf(path), line: view.line ?? 1, timeMs: view.time };
}

/**
 * Bring the open files to the view: its file active, with its filter and
 * category. A time in the view (and no line) jumps that file there and
 * sets the time cursor; no other file moves. A view that names a chain
 * opens that chain's tab at its part and line; so does a view in chain
 * mode that names a part of a valid chain as a file.
 */
async function restoreFile(view: ViewState, isCurrent: () => boolean): Promise<void> {
  if (view.chain !== null) {
    await showChain(view.chain, view);
    return;
  }
  const path = view.file;
  if (path === null) {
    for (const file of get(files).openFiles) files.closeFile(file.path);
    return;
  }
  if (view.chains) {
    const handle = await chainOfFile(path);
    if (!isCurrent()) return;
    if (handle !== null) {
      carryZone(path, chainKey(handle));
      await showChain(handle, view, partPosition(path, view));
      return;
    }
  }

  const shown = await showFile(path, view, isCurrent);
  if (!shown) return;
  files.setRegexFilter(path, view.filter);
  files.setSelectedAnomalyCategory(path, view.category);
  await shown.loaded;
}

/**
 * Bring the app to the view of the link it was opened with: the
 * timestamps stash and the file zones, then everything `restoreView`
 * restores. The zones come first, so the first requests for a file the
 * link opens already read it in its zone.
 */
export async function loadView(view: ViewState): Promise<void> {
  timeStash.replace(view.stash);
  fileZones.replace(view.fileZones);
  await restoreView(view);
}

/**
 * Bring the app to the view a URL describes: chain mode (the open tabs
 * turned over to it, `stores/chainModeSwitch.ts`), the files panel's
 * labels and value, the results switch, the search, the sidebar tab and
 * the file. The stash and the file zones
 * stay as they are. Resolves when the file's lines are
 * loaded. A later restore supersedes this one: Back pressed twice ends
 * on the second entry even when the first one's file is slower.
 */
export async function restoreView(view: ViewState): Promise<void> {
  const generation = ++restoreGeneration;
  // A link to a chain's tab is a view in chain mode. The switch sets the
  // mode before its first wait, so the search below runs in that mode;
  // the open tabs turn over to it before the file is restored.
  const switching = switchChainMode(view.chains || view.chain !== null);
  filesView.update((shown) => ({ ...shown, labels: view.labels, show: view.show }));
  searchShowsOffsets.set(view.offsets);
  restoreSearch(view.search);
  sidebarTab.set(view.tab);
  await switching;
  if (generation !== restoreGeneration) return;
  await restoreFile(view, () => generation === restoreGeneration);
}
