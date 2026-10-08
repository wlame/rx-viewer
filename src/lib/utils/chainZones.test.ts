import { describe, expect, it } from 'vitest';
import type { ChainPart, ChainResponse, FileLine } from '../types';
import { chainGutterRuns, chainViewZones, partTimeLabel } from './chainZones';

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
    line_count: 2,
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

/** Held lines: each pair is a part and its local line, numbered from `start`. */
function held(start: number, ...lines: [string, number][]): FileLine[] {
  return lines.map(([name, local], i) => ({
    lineNumber: start + i,
    content: '',
    part: name,
    localLine: local,
  }));
}

const ISO = { format: 'iso' as const, has_zone: false, assumed_zone: 'UTC' };
const T0 = Date.UTC(2026, 9, 1, 0, 0, 0);
const HOUR = 3_600_000;

describe('partTimeLabel', () => {
  it('writes a time the way the part writes its timestamps', () => {
    const p = part('a.1', { time_format: ISO, example: '2026-10-01 00:00:00.000' });
    expect(partTimeLabel(T0 + 1500, p)).toBe('2026-10-01 00:00:01.500');
  });

  it('writes ISO 8601 in UTC for a part without a known format', () => {
    expect(partTimeLabel(T0, part('a.1'))).toBe('2026-10-01T00:00:00.000Z');
  });
});

describe('chainViewZones', () => {
  const parts = [
    part('app.log.2', {
      key: '2',
      time_format: ISO,
      example: '2026-10-01 00:00:00.000',
      first_ms: T0,
      max_ms: T0 + HOUR,
      line_count: 1200,
    }),
    part('app.log.1', { key: '1', line_count: null }),
    part('app.log', { is_active: true, line_count: null }),
  ];

  it('puts a zone above the first line of each part the editor holds, never moving a line', () => {
    const zones = chainViewZones(
      held(10, ['app.log.2', 1199], ['app.log.2', 1200], ['app.log.1', 1], ['app.log.1', 2]),
      chain({ parts }),
    );

    expect(zones).toEqual([{ afterLineNumber: 2, kind: 'part', text: 'app.log.1' }]);
  });

  it('names the part, its first and highest time and its lines', () => {
    const zones = chainViewZones(held(1, ['app.log.2', 1]), chain({ parts }));

    expect(zones).toEqual([
      {
        afterLineNumber: 0,
        kind: 'part',
        text: `app.log.2 · 2026-10-01 00:00:00.000 – 2026-10-01 01:00:00.000 · ${(1200).toLocaleString()} lines`,
      },
    ]);
  });

  it('puts a time gap before the part after it', () => {
    const gaps = [
      { after: 'app.log.2', before: 'app.log.1', from_ms: T0 + HOUR, to_ms: T0 + 5 * HOUR },
    ];
    const zones = chainViewZones(
      held(1, ['app.log.2', 1200], ['app.log.1', 1]),
      chain({ parts, gaps }),
    );

    expect(zones.map((z) => [z.afterLineNumber, z.kind, z.text])).toEqual([
      [1, 'gap', 'no lines from 2026-10-01 01:00:00.000 to 2026-10-01T05:00:00.000Z'],
      [1, 'part', 'app.log.1'],
    ]);
  });

  it('puts a missing numbered part where its number would be', () => {
    const numbered = [
      part('dpkg.log.5.gz', { key: '5' }),
      part('dpkg.log.3.gz', { key: '3' }),
      part('dpkg.log.1', { key: '1' }),
      part('dpkg.log', { is_active: true }),
    ];
    const zones = chainViewZones(
      held(1, ['dpkg.log.5.gz', 2], ['dpkg.log.3.gz', 1], ['dpkg.log.3.gz', 2], ['dpkg.log.1', 1]),
      chain({
        name: 'dpkg.log',
        parts: numbered,
        missing: ['dpkg.log.2', 'dpkg.log.4'],
        missing_count: 2,
      }),
    );

    expect(zones.map((z) => [z.afterLineNumber, z.kind, z.text])).toEqual([
      [1, 'missing', 'missing: dpkg.log.4'],
      [1, 'part', 'dpkg.log.3.gz · 2 lines'],
      [3, 'missing', 'missing: dpkg.log.2'],
      [3, 'part', 'dpkg.log.1 · 2 lines'],
    ]);
  });

  it('places a missing part of a numbered-ext chain by its number too', () => {
    const numbered = [part('app.3.log', { key: '3' }), part('app.1.log', { key: '1' })];
    const zones = chainViewZones(
      held(1, ['app.3.log', 2], ['app.1.log', 1]),
      chain({ name: 'app.log', parts: numbered, missing: ['app.2.log'], missing_count: 1 }),
    );

    expect(zones.map((z) => z.kind)).toEqual(['missing', 'part']);
  });
});

describe('chainGutterRuns', () => {
  const parts = [part('a.2'), part('a.1'), part('a', { is_active: true })];

  it('marks every second part of a ready chain, in runs of editor lines', () => {
    const lines = held(5, ['a.2', 9], ['a.2', 10], ['a.1', 1], ['a.1', 2], ['a', 1]);
    expect(chainGutterRuns(lines, parts, 'global')).toEqual([
      { first: 3, last: 4, className: 'chain-gutter-alt' },
    ]);
  });

  it('mutes the local numbers of a pending chain, every second part in its own shade', () => {
    const lines = held(5, ['a.2', 10], ['a.1', 1]);
    expect(chainGutterRuns(lines, parts, 'local')).toEqual([
      { first: 1, last: 1, className: 'chain-gutter-local' },
      { first: 2, last: 2, className: 'chain-gutter-local chain-gutter-alt' },
    ]);
  });
});
