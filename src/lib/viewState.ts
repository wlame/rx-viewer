import { derived, get } from 'svelte/store';
import { activeOpenFile, defaultSyntaxHighlighting, files } from './stores/files';
import { searchShowsOffsets, sidebarTab } from './stores/layout';
import { searchRequest, trace } from './stores/trace';
import { tree } from './stores/tree';
import {
  DEFAULT_VIEW,
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
 * projection of the view, so no component writes it. `restoreView` does
 * the reverse and brings the stores to the view a URL describes.
 */

/** The part of the view that belongs to the active file. */
type FileView = Pick<ViewState, 'file' | 'line' | 'highlight' | 'filter' | 'category'>;

/**
 * What the URL says about a file: its path, its anchor line (left out at
 * line 1), its highlighting when it differs from the size-based default,
 * its filter when one is applied, and its anomaly category.
 */
export function fileViewOf(file: OpenFile | undefined): FileView {
  if (!file) return { file: null, line: null, highlight: null, filter: null, category: null };

  const filter = file.regexFilter;
  const isFilterApplied = Boolean(filter?.enabled && filter.pattern.trim() !== '');
  const isDefaultHighlighting =
    file.syntaxHighlighting === defaultSyntaxHighlighting(file.fileSize);
  return {
    file: file.path,
    line: file.anchorLine > 1 ? file.anchorLine : null,
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

/** Keep the address bar equal to the view. Returns the function that stops it. */
export function startViewSync(): () => void {
  return currentView.subscribe((view) => writeViewState(view, 'replace'));
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
 * Open the file a view names, or bring it forward when it is open, at
 * the view's line and with its highlighting. The file is in the store
 * when this resolves; the returned load resolves when its lines arrive.
 */
async function showFile(path: string, view: ViewState): Promise<{ loaded: Promise<void> }> {
  const open = get(files).openFiles.find((f) => f.path === path);
  const line = view.line ?? 1;

  if (open) {
    files.setActiveFile(path);
    files.setSyntaxHighlighting(path, view.highlight ?? defaultSyntaxHighlighting(open.fileSize));
    return { loaded: open.anchorLine === line ? Promise.resolve() : files.jumpToLine(path, line) };
  }

  // The size-based default needs the file's size, which the tree lists.
  // With the highlighting given, the tree is revealed alongside the load.
  const located = locateInTree(path);
  const node = view.highlight === null ? await located : null;
  // openFile puts the file in the store before its first await.
  const loaded = files.openFile(
    path,
    view.line ?? undefined,
    node?.size ?? null,
    view.highlight ?? undefined,
    node?.is_indexed ?? undefined,
    node?.line_count ?? undefined,
  );
  return { loaded };
}

/** Bring the open files to the view: its file active, with its filter and category. */
async function restoreFile(view: ViewState): Promise<void> {
  const path = view.file;
  if (path === null) {
    for (const file of get(files).openFiles) files.closeFile(file.path);
    return;
  }

  const { loaded } = await showFile(path, view);
  files.setRegexFilter(path, view.filter);
  files.setSelectedAnomalyCategory(path, view.category);
  await loaded;
}

/**
 * Bring the app to the view a URL describes: the results switch, the
 * search, the sidebar tab and the file. Resolves when the file's lines
 * are loaded.
 */
export async function restoreView(view: ViewState): Promise<void> {
  searchShowsOffsets.set(view.offsets);
  restoreSearch(view.search);
  sidebarTab.set(view.tab);
  await restoreFile(view);
}
