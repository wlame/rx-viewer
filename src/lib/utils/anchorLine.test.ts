import { describe, expect, it } from 'vitest';
import { anchorAfterScroll, clampAnchor } from './anchorLine';

/**
 * The URL's `line` must name the line the user went to, not whatever
 * sits in the middle of the screen: a file opened at line 1 used to be
 * written as line 15, and a jump to line 169 as line 168.
 */
describe('anchorAfterScroll', () => {
  it('keeps line 1 for a file opened at its start', () => {
    expect(anchorAfterScroll(1, { first: 1, last: 30 })).toBe(1);
  });

  it('keeps a jump target revealed in the center', () => {
    expect(anchorAfterScroll(169, { first: 155, last: 182 })).toBe(169);
  });

  it('keeps a target at either edge of the view', () => {
    expect(anchorAfterScroll(100, { first: 100, last: 130 })).toBe(100);
    expect(anchorAfterScroll(130, { first: 100, last: 130 })).toBe(130);
  });

  it('moves to the center of the view once the target is scrolled out of it', () => {
    expect(anchorAfterScroll(1, { first: 400, last: 430 })).toBe(415);
    expect(anchorAfterScroll(900, { first: 400, last: 431 })).toBe(415);
  });
});

describe('clampAnchor', () => {
  const window = { startLine: 700, endLine: 1000, reachedEnd: true };

  it('moves a line past the end of the file to its last line', () => {
    expect(clampAnchor(1200, window)).toBe(1000);
  });

  it('keeps a line the window holds', () => {
    expect(clampAnchor(900, window)).toBe(900);
  });

  it('keeps a line past the window while the file may go on', () => {
    expect(clampAnchor(1200, { ...window, reachedEnd: false })).toBe(1200);
  });

  it('keeps the anchor of an empty file', () => {
    expect(clampAnchor(1, { startLine: 1, endLine: 0, reachedEnd: true })).toBe(1);
  });
});
