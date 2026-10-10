/**
 * The keyboard focus across a switch of tabs by key: Alt+], Alt+[ and
 * Alt+X (`KeyboardShortcuts.svelte`) and a switch of the recent-tab
 * switcher (`RecentTabsSwitcher.svelte`). The focus goes back to the place
 * it was in, never to the page:
 *
 * - from the editor area to the editor of the tab now shown, which is
 *   built anew for each tab (`editorFocusRequested`);
 * - from the tab strip to the tab now active, also when the focused tab
 *   closed (`tabStripFocusRequested`);
 * - from a panel or any other control nowhere: it stays where it is;
 * - with nothing focused, to nothing.
 */
import { tick } from 'svelte';
import { get, type Writable } from 'svelte/store';
import { files } from './files';
import { editorFocusRequested, tabStripFocusRequested } from './layout';

/** The id of the editor area, the tab panel every tab of the strip controls. */
export const TAB_PANEL_ID = 'rx-tab-panel';

/** Where the focus is, as a switch of tabs sees it. */
export type FocusPlace = 'editor' | 'tabStrip' | 'elsewhere' | 'none';

/** The places a switch rebuilds or moves, by the element that holds each. */
const PLACE_HOLDERS: readonly { place: FocusPlace; selector: string }[] = [
  { place: 'editor', selector: `#${TAB_PANEL_ID}` },
  { place: 'tabStrip', selector: '[data-tab-strip]' },
];

/** The request that brings the focus back to each place; null where it stays by itself. */
const FOCUS_REQUESTS: Readonly<Record<FocusPlace, Writable<boolean> | null>> = {
  editor: editorFocusRequested,
  tabStrip: tabStripFocusRequested,
  elsewhere: null,
  none: null,
};

/** The place of the focused element `element`; `none` for the page itself. */
export function focusPlaceOf(element: Element | null): FocusPlace {
  if (element === null || element === document.body) return 'none';
  const holder = PLACE_HOLDERS.find(({ selector }) => element.closest(selector) !== null);
  return holder?.place ?? 'elsewhere';
}

/**
 * After a switch, ask the place the focus was in to take it again, once
 * the tab now shown is drawn. Nothing is asked when no tab is left, since
 * no editor and no strip would answer.
 */
export async function returnFocusTo(place: FocusPlace): Promise<void> {
  const request = FOCUS_REQUESTS[place];
  if (request === null) return;
  await tick();
  if (get(files).openFiles.length > 0) request.set(true);
}

/**
 * Run `switchTabs`, a key's switch that returns whether it acted, and
 * bring the focus back to the place it was in when it did.
 */
export function switchTabsByKey(switchTabs: () => boolean): boolean {
  const place = focusPlaceOf(document.activeElement);
  if (!switchTabs()) return false;
  void returnFocusTo(place);
  return true;
}
