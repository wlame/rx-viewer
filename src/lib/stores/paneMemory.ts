import type { OpenFile, RegexFilter } from '../types';
import type { TabKey } from '../utils/tabKey';

/**
 * What the editor pane keeps for each open tab while another tab is
 * shown.
 *
 * The pane is built again for every tab, so nothing a user typed or
 * scrolled in one tab reaches another. What belongs to a tab is kept
 * here by its key (`utils/tabKey.ts`), taken when its pane goes away and
 * read when it comes back. The applied filter itself lives with the tab
 * in the files store; this holds the bar around it and the view.
 */

/** The pattern and mode in the filter bar, applied or not. */
export interface FilterDraft {
  pattern: string;
  mode: RegexFilter['mode'];
}

/** Where the editor was scrolled, and the first line of the window it was scrolled in. */
export interface PaneScroll {
  startLine: number;
  scrollTop: number;
  scrollLeft: number;
}

export interface PaneMemory {
  filterPanelVisible: boolean;
  filterDraft: FilterDraft;
  /**
   * The applied filter the bar last showed. A filter applied from
   * outside the bar while the tab was hidden (a link, Back) is a
   * different object, and the bar opens showing it.
   */
  shownFilter: RegexFilter | null;
  scroll: PaneScroll | null;
}

/** The pane of a tab shown for the first time. */
export const DEFAULT_PANE: PaneMemory = {
  filterPanelVisible: false,
  filterDraft: { pattern: '', mode: 'highlight' },
  shownFilter: null,
  scroll: null,
};

const panes = new Map<TabKey, PaneMemory>();

/** Keep the pane of the tab `key`, which is being hidden. */
export function rememberPane(key: TabKey, pane: PaneMemory): void {
  panes.set(key, pane);
}

/** The pane the tab `key` had when it was last shown, or the default one. */
export function recallPane(key: TabKey): PaneMemory {
  return panes.get(key) ?? DEFAULT_PANE;
}

/** Drop what was kept for the tab `key`; it was closed. */
export function forgetPane(key: TabKey): void {
  panes.delete(key);
}

/** How the editor positions a tab's view when the tab is shown. */
export type ScrollOnShow =
  | { kind: 'none' }
  | { kind: 'restore'; scrollTop: number; scrollLeft: number }
  | { kind: 'reveal'; line: number };

/**
 * Where a tab's view goes when the tab is shown again.
 *
 * A navigation still pending (a jump, a search match) reveals its own
 * target. Otherwise the tab gets back the exact scroll it had, when the
 * editor holds the same window it was scrolled in. When the window
 * changed, the file's anchor line is shown, since the anchor is the line
 * the user went to or the middle of the view they left. An anchor
 * outside the held lines has nothing to reveal.
 */
export function scrollOnShow(
  file: Pick<OpenFile, 'scrollToLine' | 'startLine' | 'endLine' | 'anchorLine'>,
  remembered: PaneMemory,
): ScrollOnShow {
  if (file.scrollToLine !== undefined) return { kind: 'none' };

  const scroll = remembered.scroll;
  if (scroll && scroll.startLine === file.startLine) {
    return { kind: 'restore', scrollTop: scroll.scrollTop, scrollLeft: scroll.scrollLeft };
  }

  const isAnchorHeld = file.anchorLine >= file.startLine && file.anchorLine <= file.endLine;
  return isAnchorHeld ? { kind: 'reveal', line: file.anchorLine } : { kind: 'none' };
}
