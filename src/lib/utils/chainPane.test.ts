import { describe, expect, it } from 'vitest';
import type { ChainPart, ChainResponse, ChainTab, FileLine } from '../types';
import { chainLineLabels, chainRangeLabels, chainTabCaption, topLineOf } from './chainPane';

function part(name: string): ChainPart {
  return {
    name,
    path: `/l/${name}`,
    is_active: false,
    key: null,
    compression_format: null,
    size: 100,
    modified_at: '2026-10-01T00:00:00.000000Z',
    is_indexed: true,
    line_count: null,
    first_ms: null,
    last_ms: null,
    max_ms: null,
    max_is_bound: false,
    global_start: null,
    time_format: null,
    day_first: null,
    example: null,
    duplicates: [],
  };
}

const PARTS = [part('syslog.3.gz'), part('syslog.2'), part('syslog.1'), part('syslog')];

function chainTab(fields: Partial<ChainTab> = {}): ChainTab {
  return {
    handle: '/l/syslog',
    description: { parts: PARTS } as ChainResponse,
    numbering: 'global',
    bases: new Map(),
    counts: new Map(),
    anchor: { part: 'syslog.2', line: 7, timeMs: null },
    indexTask: null,
    indexProblem: null,
    invalidDetail: null,
    ...fields,
  };
}

function held(start: number, ...lines: [string, number][]): FileLine[] {
  return lines.map(([name, local], i) => ({
    lineNumber: start + i,
    content: '',
    part: name,
    localLine: local,
  }));
}

describe('chainLineLabels', () => {
  it('labels a pending chain lines by their line in their part', () => {
    const lines = held(1e12 + 99, ['syslog.2', 99], ['syslog.2', 100], ['syslog.1', 1]);
    expect(chainLineLabels(lines, 'local')).toEqual(['99', '100', '1']);
  });

  it('keeps the global numbers of a ready chain', () => {
    expect(chainLineLabels(held(5, ['syslog.2', 1]), 'global')).toBeNull();
  });
});

describe('chainRangeLabels', () => {
  const lines = held(1e12 + 99, ['syslog.2', 99], ['syslog.2', 100], ['syslog.1', 1]);

  it('names the first, middle and last held lines by part and line before ready', () => {
    expect(chainRangeLabels(lines, 'local')).toEqual({
      start: 'syslog.2:99',
      middle: 'syslog.2:100',
      end: 'syslog.1:1',
    });
  });

  it('leaves the numbers of a ready chain alone', () => {
    expect(chainRangeLabels(lines, 'global')).toBeNull();
  });
});

describe('topLineOf', () => {
  it('names the part of the top line by its place in the chain, and its line in it', () => {
    const lines = held(3000, ['syslog.2', 9], ['syslog.1', 1]);
    expect(topLineOf(lines, 2, PARTS)).toEqual({ partNumber: 3, part: 'syslog.1', localLine: 1 });
  });

  it('is null for an editor line the window does not hold', () => {
    expect(topLineOf([], 1, PARTS)).toBeNull();
  });
});

describe('chainTabCaption', () => {
  it('names the chain, the part of the top line and the part count, and the line in a tooltip', () => {
    expect(
      chainTabCaption('syslog', chainTab(), { partNumber: 3, part: 'syslog.1', localLine: 500 }),
    ).toEqual({
      caption: 'syslog [3/4]',
      title: 'syslog.1 : 500',
    });
  });

  it('falls back to the anchor line before the editor reports its top line', () => {
    expect(chainTabCaption('syslog', chainTab(), null)).toEqual({
      caption: 'syslog [2/4]',
      title: 'syslog.2 : 7',
    });
  });

  it('gives the handle alone while nothing is known of the chain', () => {
    expect(chainTabCaption('syslog', chainTab({ description: null, anchor: null }), null)).toEqual({
      caption: 'syslog',
      title: '/l/syslog',
    });
  });
});
