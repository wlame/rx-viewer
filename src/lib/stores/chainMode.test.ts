import { describe, expect, it } from 'vitest';
import { isChainModeOn } from './chainMode';

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
