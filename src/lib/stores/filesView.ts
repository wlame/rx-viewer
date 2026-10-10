import { derived, writable, type Readable, type Writable } from 'svelte/store';
import { nextSort, sortAfterValueSwitch, type SortKey, type TreeSort } from '../utils/treeSort';
import { DEFAULT_VIEW, type ValueColumn } from '../utils/urlState';
import { sidebarTab, sidebarVisible } from './layout';

/**
 * How the files panel shows its rows: with their labels (the compression,
 * `idx` and chain marks) or without, which value stands beside each
 * name, and the order of each folder's rows. The URL holds all three
 * (`labels=0`, `show=date`, `sort=size-desc`); `viewState.ts` keeps them
 * equal.
 */
export interface FilesView {
  labels: boolean;
  show: ValueColumn;
  sort: TreeSort;
}

/** The files panel of a link that names none of them. */
export const DEFAULT_FILES_VIEW: FilesView = {
  labels: DEFAULT_VIEW.labels,
  show: DEFAULT_VIEW.show,
  sort: DEFAULT_VIEW.sort,
};

export const filesView: Writable<FilesView> = writable(DEFAULT_FILES_VIEW);

/**
 * Sort the files panel by the column of `key`: another column sorts in
 * its first direction, the sorted one reverses.
 */
export function sortFilesBy(key: SortKey): void {
  filesView.update((view) => ({ ...view, sort: nextSort(view.sort, key) }));
}

/**
 * Show `show` beside each name. A sort on the other value moves to
 * `show` in its first direction; a sort by name stays.
 */
export function showFilesValue(show: ValueColumn): void {
  filesView.update((view) => ({ ...view, show, sort: sortAfterValueSwitch(view.sort, show) }));
}

/**
 * Whether the files panel is on screen: the side panel is shown with
 * Files. Its keys act only then.
 */
export const filesPanelShown: Readable<boolean> = derived(
  [sidebarVisible, sidebarTab],
  ([$visible, $tab]) => $visible && $tab === 'tree',
);
