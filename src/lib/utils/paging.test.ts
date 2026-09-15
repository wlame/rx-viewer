import { describe, expect, it } from 'vitest';
import {
  PAGING_EDGE_PX,
  USER_INPUT_EVENTS,
  pagingDirection,
  watchUserInput,
  type PagingState,
} from './paging';

/** A view in the middle of a window that can page both ways, after a user scroll. */
const idle: PagingState = {
  isNavigationPending: false,
  isLoading: false,
  hasUserScrolled: true,
  reachedStart: false,
  reachedEnd: false,
  scrollTop: 5_000,
  distanceFromBottom: 5_000,
};

const atTop = { ...idle, scrollTop: 0 };
const atBottom = { ...idle, distanceFromBottom: 0 };

describe('watchUserInput', () => {
  /** An element that records its listeners; every listener must run in the capture phase. */
  function recordingElement() {
    const added: { type: string; capture: boolean }[] = [];
    const removed: { type: string; capture: boolean }[] = [];
    const captureOf = (options?: boolean | AddEventListenerOptions) =>
      typeof options === 'boolean' ? options : Boolean(options?.capture);
    const element = {
      addEventListener: (type: string, _: unknown, options?: AddEventListenerOptions) =>
        added.push({ type, capture: captureOf(options) }),
      removeEventListener: (type: string, _: unknown, options?: EventListenerOptions) =>
        removed.push({ type, capture: captureOf(options) }),
    } as unknown as HTMLElement;
    return { element, added, removed };
  }

  it('hears every kind of input in the capture phase, before the editor stops it', () => {
    // Monaco stops the propagation of a wheel event it scrolled by, so a
    // listener in the bubble phase never hears the wheel.
    const { element, added } = recordingElement();
    watchUserInput(element, () => {});
    expect(added.map((l) => l.type).sort()).toEqual([...USER_INPUT_EVENTS].sort());
    expect(added.every((l) => l.capture)).toBe(true);
  });

  it('stops listening with the same phase it listened in', () => {
    const { element, added, removed } = recordingElement();
    const stop = watchUserInput(element, () => {});
    stop();
    expect(removed).toEqual(added);
  });
});

describe('pagingDirection', () => {
  it('pages before near the top and after near the bottom', () => {
    expect(pagingDirection(atTop)).toBe('before');
    expect(pagingDirection(atBottom)).toBe('after');
    expect(pagingDirection(idle)).toBeNull();
  });

  it('pages only inside the edge', () => {
    expect(pagingDirection({ ...idle, scrollTop: PAGING_EDGE_PX - 1 })).toBe('before');
    expect(pagingDirection({ ...idle, scrollTop: PAGING_EDGE_PX })).toBeNull();
  });

  it('does not page past an end of the file', () => {
    expect(pagingDirection({ ...atTop, reachedStart: true })).toBeNull();
    expect(pagingDirection({ ...atBottom, reachedEnd: true })).toBeNull();
  });

  it.each([
    ['a jump has not revealed its target', { isNavigationPending: true }],
    ['a window is loading', { isLoading: true }],
    ['the editor moved the view and the user did not', { hasUserScrolled: false }],
  ])('does not page while %s, at either edge', (_, state) => {
    expect(pagingDirection({ ...atTop, ...state })).toBeNull();
    expect(pagingDirection({ ...atBottom, ...state })).toBeNull();
  });
});
