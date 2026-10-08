import { describe, expect, it } from 'vitest';
import type { ChainPart, ChainResponse } from '../types';
import {
  chainCaption,
  chainIndexingLabel,
  chainLinesLabel,
  gapsAndMissingSummary,
  isChainIndexed,
  neighbourPartWithLines,
  parseChainLineTarget,
  partIndexWord,
  partLineRange,
} from './chainParts';

function part(name: string, fields: Partial<ChainPart> = {}): ChainPart {
  return {
    name,
    path: `/l/${name}`,
    is_active: false,
    key: null,
    compression_format: null,
    size: 100,
    modified_at: '2026-10-01T00:00:00.000000Z',
    is_indexed: true,
    line_count: 10,
    first_ms: null,
    last_ms: null,
    max_ms: null,
    max_is_bound: false,
    global_start: null,
    time_format: null,
    day_first: null,
    example: null,
    duplicates: [],
    ...fields,
  };
}

function chain(fields: Partial<ChainResponse> = {}): ChainResponse {
  return {
    path: '/l/app.log',
    name: 'app.log',
    state: 'ready',
    reasons: [],
    fingerprint: '0123456789abcdef',
    parts: [],
    missing: [],
    missing_count: 0,
    gaps: [],
    first_ms: null,
    last_ms: null,
    frozen_line_count: null,
    line_count: null,
    index_build: null,
    cli_command: 'rx logs show /l/app.log',
    ...fields,
  };
}

describe('isChainIndexed', () => {
  it('is true when every frozen part with lines has an index, the active part aside', () => {
    const parts = [part('app.log.1'), part('app.log', { is_active: true, is_indexed: false })];
    expect(isChainIndexed(parts)).toBe(true);
  });

  it('is false when a frozen part with lines has no index', () => {
    expect(isChainIndexed([part('app.log.2', { is_indexed: false }), part('app.log.1')])).toBe(
      false,
    );
  });

  // An empty file is never indexed, and needs no index.
  it('counts an empty frozen part as needing no index', () => {
    const parts = [part('app.log.2', { size: 0, is_indexed: false }), part('app.log.1')];
    expect(isChainIndexed(parts)).toBe(true);
  });

  it('is false for a chain whose parts are not listed', () => {
    expect(isChainIndexed([])).toBe(false);
  });
});

describe('partIndexWord', () => {
  it.each([
    [{ size: 0, is_indexed: false }, 'empty'],
    [{ size: 10, is_indexed: true }, 'indexed'],
    [{ size: 10, is_indexed: false }, 'not indexed'],
  ])('reads %o as %s', (fields, word) => {
    expect(partIndexWord(part('x', fields))).toBe(word);
  });
});

describe('chainIndexingLabel', () => {
  const parts = [
    part('app.log.4', { is_indexed: false }),
    part('app.log.3', { is_indexed: false }),
    part('app.log.2', { size: 0, is_indexed: false }),
    part('app.log.1'),
    part('app.log', { is_active: true, is_indexed: false }),
  ];

  it('counts the frozen parts with lines, those indexed before the task, and the task share', () => {
    expect(chainIndexingLabel(parts, null)).toBe('indexing 1/3 parts');
    expect(chainIndexingLabel(parts, 0.5)).toBe('indexing 2/3 parts · 50%');
    expect(chainIndexingLabel(parts, 1)).toBe('indexing 3/3 parts · 100%');
  });
});

describe('partLineRange', () => {
  it('gives the global lines of a part of a ready chain', () => {
    expect(partLineRange(part('a', { global_start: 11, line_count: 10 }))).toEqual({
      first: 11,
      last: 20,
    });
  });

  it('gives no last line while the part line count is not known', () => {
    expect(partLineRange(part('a', { global_start: 21, line_count: null }))).toEqual({
      first: 21,
      last: null,
    });
  });

  it('gives none before the chain is ready, and none for an empty part', () => {
    expect(partLineRange(part('a', { global_start: null }))).toBeNull();
    expect(partLineRange(part('a', { global_start: 11, line_count: 0, size: 0 }))).toBeNull();
  });
});

describe('chainLinesLabel', () => {
  it('gives every line once the active part is counted', () => {
    expect(chainLinesLabel(chain({ line_count: 1436842, frozen_line_count: 1197370 }))).toBe(
      (1436842).toLocaleString(),
    );
  });

  it('gives the frozen lines and an ellipsis while the active part is not counted', () => {
    expect(chainLinesLabel(chain({ line_count: null, frozen_line_count: 1197370 }))).toBe(
      `${(1197370).toLocaleString()}…`,
    );
  });

  it('gives nothing before the chain is ready', () => {
    expect(chainLinesLabel(chain({ state: 'pending' }))).toBeNull();
  });
});

describe('gapsAndMissingSummary', () => {
  it('names the gaps and the missing parts', () => {
    const gaps = [{ after: 'a.2', before: 'a.1', from_ms: 1, to_ms: 2 }];
    expect(gapsAndMissingSummary(chain({ gaps, missing: ['a.3'], missing_count: 1 }))).toBe(
      '1 gap · 1 missing',
    );
    expect(gapsAndMissingSummary(chain({ gaps: [...gaps, ...gaps], missing_count: 140 }))).toBe(
      '2 gaps · 140 missing',
    );
  });

  it('is null without either', () => {
    expect(gapsAndMissingSummary(chain())).toBeNull();
  });
});

describe('chainCaption', () => {
  it('names the chain, the part of the top line and the part count', () => {
    expect(chainCaption('syslog', 3, 12)).toBe('syslog [3/12]');
  });
});

describe('neighbourPartWithLines', () => {
  const parts = [part('a.3'), part('a.2', { size: 0 }), part('a.1'), part('a', { size: 5 })];

  it('skips empty parts and parts read as holding no line', () => {
    expect(neighbourPartWithLines(parts, 'a.3', 'after', new Map())?.name).toBe('a.1');
    expect(neighbourPartWithLines(parts, 'a.1', 'before', new Map())?.name).toBe('a.3');
    expect(neighbourPartWithLines(parts, 'a.3', 'after', new Map([['a.1', 0]]))?.name).toBe('a');
  });

  it('is null past either end', () => {
    expect(neighbourPartWithLines(parts, 'a.3', 'before', new Map())).toBeNull();
    expect(neighbourPartWithLines(parts, 'a', 'after', new Map())).toBeNull();
  });

  it('gives the first or last part with lines from no part', () => {
    expect(neighbourPartWithLines(parts, null, 'after', new Map())?.name).toBe('a.3');
    expect(neighbourPartWithLines(parts, null, 'before', new Map())?.name).toBe('a');
  });
});

describe('parseChainLineTarget', () => {
  const parts = [part('syslog.3.gz'), part('syslog:odd.2'), part('syslog', { is_active: true })];
  const ready = chain({ state: 'ready', parts });
  const pending = chain({ state: 'pending', parts });

  it('reads a number as a global line of a ready chain', () => {
    expect(parseChainLineTarget(' 123456 ', ready)).toEqual({ kind: 'global', line: 123456 });
  });

  it('reads part:line as a line of that part', () => {
    expect(parseChainLineTarget('syslog.3.gz:500', pending)).toEqual({
      kind: 'local',
      part: 'syslog.3.gz',
      line: 500,
    });
  });

  it('splits at the last colon, so a part name may hold one', () => {
    expect(parseChainLineTarget('syslog:odd.2:7', ready)).toEqual({
      kind: 'local',
      part: 'syslog:odd.2',
      line: 7,
    });
  });

  it.each([
    ['a global line before the chain is ready', '123', pending, 'index'],
    ['line 0', '0', ready, 'from 1'],
    ['a part line 0', 'syslog.3.gz:0', ready, 'from 1'],
    ['an unknown part', 'syslog.9.gz:5', ready, 'No part named syslog.9.gz'],
    ['text', 'abc', ready, 'part:line'],
    ['an empty value', '  ', ready, 'part:line'],
    ['a negative line', '-5', ready, 'part:line'],
  ])('refuses %s', (_name, text, description, message) => {
    const target = parseChainLineTarget(text, description);
    expect(target.kind).toBe('invalid');
    expect(target.kind === 'invalid' ? target.message : '').toContain(message);
  });
});
