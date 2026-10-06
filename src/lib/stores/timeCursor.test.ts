import { afterEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { timeCursor } from './timeCursor';

const INSTANT = Date.UTC(2025, 11, 10, 7, 30, 0);

describe('timeCursor', () => {
  afterEach(() => timeCursor.clear());

  it('holds an instant with the instant it names', () => {
    const cursor = timeCursor.set(INSTANT);

    expect(get(timeCursor)).toEqual({
      query: INSTANT,
      version: cursor.version,
      instantMs: INSTANT,
    });
  });

  it('gives every set a newer version, the same value too', () => {
    const first = timeCursor.set(INSTANT);
    const second = timeCursor.set(INSTANT);
    timeCursor.clear();
    const third = timeCursor.set('07:30');

    expect(second.version).toBeGreaterThan(first.version);
    expect(third.version).toBeGreaterThan(second.version);
  });

  it('takes the instant a typed value found, unless a newer cursor replaced it', () => {
    const typed = timeCursor.set('07:30');
    expect(get(timeCursor)?.instantMs).toBeNull();

    timeCursor.resolve(typed.version, INSTANT);
    expect(get(timeCursor)?.instantMs).toBe(INSTANT);

    const newer = timeCursor.set('08:00');
    timeCursor.resolve(typed.version, INSTANT);
    expect(get(timeCursor)).toEqual({ query: '08:00', version: newer.version, instantMs: null });
  });

  it('holds nothing once cleared', () => {
    timeCursor.set(INSTANT);
    timeCursor.clear();

    expect(get(timeCursor)).toBeNull();
  });
});
