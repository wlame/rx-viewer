import { derived, writable, type Readable, type Writable } from 'svelte/store';
import { DEFAULT_VIEW, type ValueColumn } from '../utils/urlState';
import { sidebarTab, sidebarVisible } from './layout';

/**
 * How the files panel shows its rows: with their labels (the compression,
 * `idx` and chain marks) or without, and which value stands beside each
 * name. The URL holds both (`labels=0`, `show=date`); `viewState.ts`
 * keeps the two equal.
 */
export interface FilesView {
  labels: boolean;
  show: ValueColumn;
}

/** The files panel of a link that names neither. */
export const DEFAULT_FILES_VIEW: FilesView = {
  labels: DEFAULT_VIEW.labels,
  show: DEFAULT_VIEW.show,
};

export const filesView: Writable<FilesView> = writable(DEFAULT_FILES_VIEW);

/**
 * Whether the files panel is on screen: the side panel is shown with
 * Files. Its keys act only then.
 */
export const filesPanelShown: Readable<boolean> = derived(
  [sidebarVisible, sidebarTab],
  ([$visible, $tab]) => $visible && $tab === 'tree',
);
