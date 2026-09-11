import { describe, expect, it } from 'vitest';
import { countAnomaliesByCategory } from './anomalyCategories';

describe('countAnomaliesByCategory', () => {
  it('counts by category when several detectors share one', () => {
    const anomalies = [
      { category: 'log-traceback', detector: 'traceback-python' },
      { category: 'log-traceback', detector: 'traceback-go' },
      { category: 'secrets', detector: 'secrets-scan' },
      { category: 'log-traceback', detector: 'traceback-python' },
    ];

    expect(countAnomaliesByCategory(anomalies)).toEqual({ 'log-traceback': 3, secrets: 1 });
  });

  it('lists categories in name order whatever order the anomalies came in', () => {
    const anomalies = [{ category: 'secrets' }, { category: 'format' }, { category: 'log-crash' }];

    expect(Object.keys(countAnomaliesByCategory(anomalies) ?? {})).toEqual([
      'format',
      'log-crash',
      'secrets',
    ]);
  });

  it('returns an empty count for a file analyzed with no anomalies', () => {
    expect(countAnomaliesByCategory([])).toEqual({});
  });

  it('returns null for a file that was never analyzed', () => {
    expect(countAnomaliesByCategory(null)).toBeNull();
    expect(countAnomaliesByCategory(undefined)).toBeNull();
  });
});
