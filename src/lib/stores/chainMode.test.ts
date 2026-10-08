import { afterEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { chainMode, chooseChainMode, isChainModeOn } from './chainMode';
import { settings } from './settings';

describe('isChainModeOn', () => {
  it.each([
    { mode: true, features: ['log_chains'], expected: true },
    { mode: true, features: ['time_range'], expected: false },
    { mode: true, features: [], expected: false },
    { mode: false, features: ['log_chains'], expected: false },
  ])(
    'is $expected with the mode $mode and the features $features',
    ({ mode, features, expected }) => {
      expect(isChainModeOn(mode, { features })).toBe(expected);
    },
  );
});

describe('chooseChainMode', () => {
  afterEach(() => chooseChainMode(false));

  it.each([true, false])('sets the mode to %s and remembers it for a link without it', (on) => {
    chooseChainMode(!on);

    chooseChainMode(on);

    expect(get(chainMode)).toBe(on);
    expect(get(settings).chainMode).toBe(on);
  });
});
