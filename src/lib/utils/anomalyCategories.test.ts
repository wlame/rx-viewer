import { describe, expect, it } from 'vitest';
import { countAnomaliesByCategory, pickAnomalyTarget } from './anomalyCategories';

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

describe('pickAnomalyTarget', () => {
  const at = (category: string, start_line: number) => ({ category, start_line });
  const anomalies = [
    at('secrets', 50),
    at('log-traceback', 300),
    at('log-traceback', 100),
    at('log-traceback', 200),
  ];

  it('steps to the first anomaly of the category below the view', () => {
    expect(pickAnomalyTarget(anomalies, 'log-traceback', 150, 'next')?.start_line).toBe(200);
  });

  it('steps past the anomaly the view is already centered on', () => {
    expect(pickAnomalyTarget(anomalies, 'log-traceback', 200, 'next')?.start_line).toBe(300);
    expect(pickAnomalyTarget(anomalies, 'log-traceback', 199, 'next')?.start_line).toBe(300);
  });

  it('steps to the last anomaly of the category above the view', () => {
    expect(pickAnomalyTarget(anomalies, 'log-traceback', 250, 'previous')?.start_line).toBe(200);
    expect(pickAnomalyTarget(anomalies, 'log-traceback', 201, 'previous')?.start_line).toBe(100);
  });

  it('wraps around at either end', () => {
    expect(pickAnomalyTarget(anomalies, 'log-traceback', 400, 'next')?.start_line).toBe(100);
    expect(pickAnomalyTarget(anomalies, 'log-traceback', 10, 'previous')?.start_line).toBe(300);
  });

  it('returns null for a category with no anomalies', () => {
    expect(pickAnomalyTarget(anomalies, 'log-crash', 10, 'next')).toBeNull();
    expect(pickAnomalyTarget(null, 'log-crash', 10, 'next')).toBeNull();
  });
});
