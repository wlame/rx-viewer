import type { OpenFile, RegexFilter } from '../types';

/**
 * What the editor pane keeps for each open file while another file's tab
 * is shown.
 *
 * The pane is built again for every tab, so nothing a user typed or
 * scrolled in one tab reaches another. What belongs to a tab is kept
 * here by path, taken when its pane goes away and read when it comes
 * back. The applied filter itself lives with the file in the files
 * store; this holds the bar around it and the view.
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

const panes = new Map<string, PaneMemory>();

/** Keep the pane of a file whose tab is being hidden. */
export function rememberPane(path: string, pane: PaneMemory): void {
  panes.set(path, pane);
}

/** The pane a file's tab had when it was last shown, or the default one. */
export function recallPane(path: string): PaneMemory {
  return panes.get(path) ?? DEFAULT_PANE;
}

/** Drop what was kept for a file; its tab was closed. */
export function forgetPane(path: string): void {
  panes.delete(path);
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
