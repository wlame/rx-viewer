import { describe, expect, it } from 'vitest';
import type { CategoryInfo, DetectorInfo, SeverityLevel } from '../types';
import {
  categoryDescription,
  detectorLabel,
  severityClass,
  severityLevel,
  summaryEntries,
} from './anomalyLabels';

// The scale rx-go answers on /v1/detectors, lowest level first.
const scale: SeverityLevel[] = [
  { min: 0, max: 0.4, label: 'low', description: 'Minor deviations, informational' },
  { min: 0.4, max: 0.6, label: 'medium', description: 'Warnings, format issues' },
  { min: 0.6, max: 0.8, label: 'high', description: 'Errors, crashes' },
  { min: 0.8, max: 1, label: 'critical', description: 'Fatal errors, exposed secrets' },
];

const detector = (name: string, category: string, description: string): DetectorInfo => ({
  name,
  category,
  description,
  examples: null,
  severity_range: { min: 0.7, max: 0.7 },
});

const detectors = [
  detector('traceback-python', 'log-traceback', 'Python tracebacks'),
  detector('long-line', 'format', 'Lines unusually long'),
];

describe('severityLevel', () => {
  it.each([
    [0, 'low'],
    [0.39, 'low'],
    [0.4, 'medium'],
    [0.59, 'medium'],
    [0.6, 'high'],
    [0.79, 'high'],
    [0.8, 'critical'],
    [1, 'critical'],
  ])('puts severity %s in the %s level', (severity, label) => {
    expect(severityLevel(severity, scale)?.label).toBe(label);
  });

  it('reads a scale listed highest level first the same way', () => {
    const reversed = [...scale].reverse();
    expect(severityLevel(0.4, reversed)?.label).toBe('medium');
    expect(severityLevel(0.8, reversed)?.label).toBe('critical');
  });

  it('returns null without a scale', () => {
    expect(severityLevel(0.9, [])).toBeNull();
  });
});

describe('severityClass', () => {
  it.each([
    [0.39, 'text-gh-fg-muted'],
    [0.4, 'text-yellow-600'],
    [0.6, 'text-orange-500'],
    [0.8, 'text-red-600'],
  ])('colours severity %s by its level', (severity, colour) => {
    expect(severityClass(severity, scale)).toContain(colour);
  });

  it('follows the thresholds the scale states, not fixed ones', () => {
    const twoLevels: SeverityLevel[] = [
      { min: 0, max: 0.9, label: 'normal', description: '' },
      { min: 0.9, max: 1, label: 'alarm', description: '' },
    ];
    expect(severityClass(0.85, twoLevels)).toContain('text-orange-500');
    expect(severityClass(0.9, twoLevels)).toContain('text-red-600');
  });

  it('is muted before the scale has loaded', () => {
    expect(severityClass(1, [])).toContain('text-gh-fg-muted');
  });
});

describe('detectorLabel', () => {
  it('takes the category and description from the detector list', () => {
    expect(detectorLabel('traceback-python', detectors)).toEqual({
      name: 'traceback-python',
      category: 'log-traceback',
      description: 'Python tracebacks',
    });
  });

  it('shows an unknown detector by its raw name', () => {
    expect(detectorLabel('error_keyword', detectors)).toEqual({
      name: 'error_keyword',
      category: null,
      description: null,
    });
  });
});

describe('summaryEntries', () => {
  it('labels a summary keyed by detector with each detector category', () => {
    expect(summaryEntries({ 'long-line': 2, 'traceback-python': 5 }, detectors)).toEqual([
      { name: 'long-line', category: 'format', description: 'Lines unusually long', count: 2 },
      {
        name: 'traceback-python',
        category: 'log-traceback',
        description: 'Python tracebacks',
        count: 5,
      },
    ]);
  });

  it('shows a key that names no detector as itself', () => {
    expect(summaryEntries({ traceback: 3 }, detectors)).toEqual([
      { name: 'traceback', category: null, description: null, count: 3 },
    ]);
  });

  it('returns nothing for a missing summary', () => {
    expect(summaryEntries(null, detectors)).toEqual([]);
  });
});

describe('categoryDescription', () => {
  const categories: CategoryInfo[] = [
    { name: 'format', description: 'Structural format anomalies', detectors: ['long-line'] },
  ];

  it('takes the description from the category list', () => {
    expect(categoryDescription('format', categories)).toBe('Structural format anomalies');
  });

  it('returns null for a category the list lacks', () => {
    expect(categoryDescription('secrets', categories)).toBeNull();
  });
});
