/**
 * Whether a scroll of the editor loads the next page, and which one.
 *
 * Paging follows the user's scroll and nothing else. The editor moves
 * the view itself too: it reveals a jump's target, keeps the screen
 * still while lines arrive, restores a tab's scroll. Those moves can
 * pass an edge of the window on the way, and a page started then lands
 * in the middle of the jump. They are told apart by state, never by
 * time: a guard on a timer fails as soon as the browser runs the
 * editor slower than the timer, as it does in a background tab.
 */

/** How close to an edge of the held lines, in pixels, the view must come to page. */
export const PAGING_EDGE_PX = 200;

/** The input by which a user moves the editor's view: wheel, touch, scrollbar drag, keys. */
export const USER_INPUT_EVENTS = ['wheel', 'touchmove', 'mousedown', 'keydown'] as const;

/**
 * Call `onInput` on every user input inside `element`, and return the
 * function that stops listening.
 *
 * The listeners run in the capture phase, on the way down to the
 * editor: Monaco stops the propagation of a wheel event it scrolled by,
 * so a listener in the bubble phase would never hear a wheel scroll.
 */
export function watchUserInput(element: HTMLElement, onInput: () => void): () => void {
  const options = { capture: true, passive: true };
  for (const type of USER_INPUT_EVENTS) element.addEventListener(type, onInput, options);
  return () => {
    for (const type of USER_INPUT_EVENTS) {
      element.removeEventListener(type, onInput, { capture: true });
    }
  };
}

export interface PagingState {
  /** A jump or a search match has not revealed its target yet. */
  isNavigationPending: boolean;
  /** A window or a page is loading. */
  isLoading: boolean;
  /** The user scrolled, clicked or pressed a key in the editor since the last navigation. */
  hasUserScrolled: boolean;
  reachedStart: boolean;
  reachedEnd: boolean;
  scrollTop: number;
  distanceFromBottom: number;
}

export type PagingDirection = 'before' | 'after';

/** States in which no scroll pages, whatever the position. */
const PAGING_BLOCKED_WHILE: ((state: PagingState) => boolean)[] = [
  (state) => state.isNavigationPending,
  (state) => state.isLoading,
  (state) => !state.hasUserScrolled,
];

/** The two edges, checked in order: the view near an edge pages that way unless the file ends there. */
const EDGES: {
  direction: PagingDirection;
  isNear: (state: PagingState) => boolean;
  isFileEnd: (state: PagingState) => boolean;
}[] = [
  {
    direction: 'before',
    isNear: (state) => state.scrollTop < PAGING_EDGE_PX,
    isFileEnd: (state) => state.reachedStart,
  },
  {
    direction: 'after',
    isNear: (state) => state.distanceFromBottom < PAGING_EDGE_PX,
    isFileEnd: (state) => state.reachedEnd,
  },
];

/** The page a scroll should load, or null when it should load none. */
export function pagingDirection(state: PagingState): PagingDirection | null {
  if (PAGING_BLOCKED_WHILE.some((isBlocked) => isBlocked(state))) return null;
  const edge = EDGES.find((e) => e.isNear(state) && !e.isFileEnd(state));
  return edge?.direction ?? null;
}
