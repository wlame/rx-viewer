import { writable } from 'svelte/store';
import type { SidebarTab } from '../utils/urlState';

export type { SidebarTab };

/** Which sidebar tab is open. */
export const sidebarTab = writable<SidebarTab>('tree');

/** Whether the search results show byte offsets instead of line numbers. */
export const searchShowsOffsets = writable(false);

/** Whether the sidebar is shown. Hiding it keeps its state. */
export const sidebarVisible = writable(true);

/**
 * Set when something asks for the search pattern field to take focus.
 * The search panel focuses its field and resets it; the panel may not
 * exist yet when the request is made, so the request waits for it.
 */
export const searchFocusRequested = writable(false);

/** Show the sidebar on its Search tab and focus the pattern field. */
export function focusSearch(): void {
  sidebarVisible.set(true);
  sidebarTab.set('search');
  searchFocusRequested.set(true);
}

/** Show or hide the sidebar. */
export function toggleSidebar(): void {
  sidebarVisible.update((visible) => !visible);
}
