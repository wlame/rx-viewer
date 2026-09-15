import { describe, it, expect } from 'vitest';
import { formatSize, formatNumber, formatCount, formatStatistic } from './format';

describe('formatSize', () => {
  it.each([
    [0, '0 B'],
    [1, '1 B'],
    [1023, '1023 B'],
    [1024, '1.0 KB'],
    [1536, '1.5 KB'],
    [1048576, '1.0 MB'],
    [1073741824, '1.0 GB'],
    [1099511627776, '1.0 TB'],
  ])('formats %i bytes as %s', (bytes, expected) => {
    expect(formatSize(bytes)).toBe(expected);
  });

  it('shows no decimal for whole bytes but one above', () => {
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(2048)).toBe('2.0 KB');
  });

  it('stops at TB rather than inventing a unit', () => {
    // rx is pointed at log archives; a petabyte-scale path is not absurd.
    expect(formatSize(1024 ** 5)).toBe('1024.0 TB');
  });
});

describe('formatNumber', () => {
  it('groups thousands', () => {
    expect(formatNumber(1234567)).toBe((1234567).toLocaleString());
  });

  it('leaves small numbers alone', () => {
    expect(formatNumber(42)).toBe('42');
  });
});

describe('formatCount', () => {
  it.each([
    [0, 'file', undefined, '0 files'],
    [1, 'file', undefined, '1 file'],
    [2, 'file', undefined, '2 files'],
    [1, 'match', 'matches', '1 match'],
    [2461, 'match', 'matches', '2,461 matches'],
  ])('formats %i with %s (plural %s) as %s', (count, singular, plural, expected) => {
    expect(formatCount(count, singular, plural)).toBe(expected);
  });
});

describe('formatStatistic', () => {
  it.each([
    [42.25, '42.3'],
    [0, '0.0'],
    [1234.5, '1234.5'],
  ])('formats %d with one decimal as %s', (value, expected) => {
    expect(formatStatistic(value)).toBe(expected);
  });

  // The backend leaves a statistic null when it cannot compute it, for
  // example the spread of a file with no lines.
  it('shows a dash for a statistic the backend left null', () => {
    expect(formatStatistic(null)).toBe('—');
  });
});
