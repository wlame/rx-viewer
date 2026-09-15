import { describe, expect, it } from 'vitest';
import { PAGING_EDGE_PX, pagingDirection, type PagingState } from './paging';

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
