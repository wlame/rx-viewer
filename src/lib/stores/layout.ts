import { derived, get, writable, type Readable, type Writable } from 'svelte/store';
import type { SidebarTab } from '../utils/urlState';

export type { SidebarTab };

/** Which panel the side panel shows: Files (`tree`) or Search. */
export const sidebarTab = writable<SidebarTab>('tree');

/** Whether the search results show byte offsets instead of line numbers. */
export const searchShowsOffsets = writable(false);

/** Whether the sidebar is shown. Hiding it keeps its state. */
export const sidebarVisible = writable(true);

/** Whether the help dialog of keyboard shortcuts is open. */
export const shortcutsHelpOpen = writable(false);

/** How many modal dialogs are open; each one counts itself while it is in the page. */
const openModalCount = writable(0);

/**
 * Whether a modal dialog owns the keyboard: the shortcut list, the
 * analysis, the API token prompt or the refused-contract cover (each
 * carries `use:modal`). While it holds, the window-wide keys that show a
 * panel, move the focus or hide the side panel do nothing, and leave the
 * key to the dialog.
 */
export const modalOpen: Readable<boolean> = derived(openModalCount, (count) => count > 0);

/**
 * Count a modal dialog as open until the returned function is called;
 * calling it again does nothing.
 */
export function registerModal(): () => void {
  openModalCount.update((count) => count + 1);
  let isOpen = true;
  return () => {
    if (!isOpen) return;
    isOpen = false;
    openModalCount.update((count) => count - 1);
  };
}

/**
 * Set when something asks for the search pattern field to take focus.
 * The search panel focuses its field and resets it; the panel may not
 * exist yet when the request is made, so the request waits for it.
 */
export const searchFocusRequested = writable(false);

/**
 * Set when something asks for the file tree's current row to take
 * focus. The files panel focuses the row and resets it; while the roots
 * load, the request waits for them.
 */
export const treeFocusRequested = writable(false);

/** The request each panel answers by taking the focus. */
const FOCUS_REQUESTS: Readonly<Record<SidebarTab, Writable<boolean>>> = {
  tree: treeFocusRequested,
  search: searchFocusRequested,
};

/**
 * Show the side panel with the panel `id`; with `focus`, ask that panel
 * to take the focus. The panel is shown before the request is raised, so
 * the panel answers it once it is drawn.
 */
export function showPanel(id: SidebarTab, focus: boolean): void {
  sidebarVisible.set(true);
  sidebarTab.set(id);
  if (focus) FOCUS_REQUESTS[id].set(true);
}

/**
 * A click on a panel's button in the activity bar: hide the side panel
 * when it shows that panel, else show the panel. The focus stays on the
 * button.
 */
export function clickPanelButton(id: SidebarTab): void {
  const isShown = get(sidebarVisible) && get(sidebarTab) === id;
  if (isShown) sidebarVisible.set(false);
  else showPanel(id, false);
}

/** Show or hide the sidebar. */
export function toggleSidebar(): void {
  sidebarVisible.update((visible) => !visible);
}
