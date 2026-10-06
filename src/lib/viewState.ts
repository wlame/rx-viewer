import { derived, get } from 'svelte/store';
import { activeOpenFile, defaultSyntaxHighlighting, files } from './stores/files';
import { notifications } from './stores/notifications';
import { searchShowsOffsets, sidebarTab } from './stores/layout';
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
import type { OpenFile, TreeNode } from './types';

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

/** The view the stores describe now. */
const currentView = derived(
  [files, sidebarTab, searchShowsOffsets, searchRequest],
  ([$files, $tab, $offsets, $search]): ViewState => ({
    ...fileViewOf(activeOpenFile($files)),
    tab: $tab,
    offsets: $offsets,
    search: $search,
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
  const stopWriting = currentView.subscribe((view) => {
    const mode = runningRestores > 0 ? 'replace' : historyModeFor(readViewState(), view);
    writeViewState(view, mode);
  });

  const restoreEntry = () => {
    runningRestores += 1;
    restoreView(readViewState())
      .catch((e) => console.error('Failed to restore the view of a history entry:', e))
      .finally(() => {
        runningRestores -= 1;
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
  });
  if (time === null) return { loaded };
  // The jump takes over from the load of the file's start.
  return { loaded: Promise.all([loaded, jumpToViewTime(path, time)]).then(() => undefined) };
}

/**
 * Bring the open files to the view: its file active, with its filter and
 * category. A time in the view (and no line) jumps that file there and
 * sets the time cursor; no other file moves.
 */
async function restoreFile(view: ViewState, isCurrent: () => boolean): Promise<void> {
  const path = view.file;
  if (path === null) {
    for (const file of get(files).openFiles) files.closeFile(file.path);
    return;
  }

  const shown = await showFile(path, view, isCurrent);
  if (!shown) return;
  files.setRegexFilter(path, view.filter);
  files.setSelectedAnomalyCategory(path, view.category);
  await shown.loaded;
}

/**
 * Bring the app to the view a URL describes: the results switch, the
 * search, the sidebar tab and the file. Resolves when the file's lines
 * are loaded. A later restore supersedes this one: Back pressed twice
 * ends on the second entry even when the first one's file is slower.
 */
export async function restoreView(view: ViewState): Promise<void> {
  const generation = ++restoreGeneration;
  searchShowsOffsets.set(view.offsets);
  restoreSearch(view.search);
  sidebarTab.set(view.tab);
  await restoreFile(view, () => generation === restoreGeneration);
}
