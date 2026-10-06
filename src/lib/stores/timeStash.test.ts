import { afterEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { timeStash } from './timeStash';

/** 2025-12-10 07:00:00 UTC. */
const HOUR_START = Date.UTC(2025, 11, 10, 7, 0, 0);
const MINUTE = 60_000;
const minute = (n: number) => HOUR_START + n * MINUTE;

afterEach(() => {
  timeStash.replace([]);
});

describe('timeStash', () => {
  it('adds instants in time order and refuses one it holds', () => {
    expect(timeStash.add(minute(5))).toBe('added');
    expect(timeStash.add(minute(1))).toBe('added');
    expect(timeStash.add(minute(5))).toBe('duplicate');

    expect(get(timeStash)).toEqual([minute(1), minute(5)]);
    expect(timeStash.has(minute(5))).toBe(true);
    expect(timeStash.has(minute(5) + 1)).toBe(false);
  });

  it('refuses the eighth instant and is full at seven', () => {
    for (let n = 0; n < 7; n++) timeStash.add(minute(n));

    expect(timeStash.isFull()).toBe(true);
    expect(timeStash.add(minute(7))).toBe('full');
    expect(get(timeStash)).toHaveLength(7);
  });

  it('removes an instant', () => {
    timeStash.add(minute(1));
    timeStash.add(minute(2));

    timeStash.remove(minute(1));

    expect(get(timeStash)).toEqual([minute(2)]);
    expect(timeStash.isFull()).toBe(false);
  });

  it('replaces its instants with a normalized list', () => {
    timeStash.replace([minute(3), minute(1), minute(3), 0.5]);

    expect(get(timeStash)).toEqual([minute(1), minute(3)]);
  });
});
