import { describe, expect, it } from 'vitest';
import type { ChainPart, ChainResponse, FileLine } from '../types';
import { LINES_PER_PAGE } from './slidingWindow';
import {
  NO_ZONES,
  chainGutterRuns,
  chainViewZones,
  chainZonesMemo,
  partTimeLabel,
} from './chainZones';

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
    index_build_refused: null,
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

  it('writes a part whose lines write a zone in the zone the chain is read in', () => {
    const zoned = { format: 'iso' as const, has_zone: true, assumed_zone: '+02:00' };
    const p = part('a.1', { time_format: zoned, example: '2026-10-01 00:00:00.000' });
    expect(partTimeLabel(T0, p)).toBe('2026-10-01 02:00:00.000');
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
      part('agent.log.5.gz', { key: '5' }),
      part('agent.log.3.gz', { key: '3' }),
      part('agent.log.1', { key: '1' }),
      part('agent.log', { is_active: true }),
    ];
    const zones = chainViewZones(
      held(
        1,
        ['agent.log.5.gz', 2],
        ['agent.log.3.gz', 1],
        ['agent.log.3.gz', 2],
        ['agent.log.1', 1],
      ),
      chain({
        name: 'agent.log',
        parts: numbered,
        missing: ['agent.log.2', 'agent.log.4'],
        missing_count: 2,
      }),
    );

    expect(zones.map((z) => [z.afterLineNumber, z.kind, z.text])).toEqual([
      [1, 'missing', 'missing: agent.log.4'],
      [1, 'part', 'agent.log.3.gz · 2 lines'],
      [3, 'missing', 'missing: agent.log.2'],
      [3, 'part', 'agent.log.1 · 2 lines'],
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

/** The numbers missing from the large chain: 50, 150, …, 9950. */
const LARGE_MISSING = Array.from({ length: 100 }, (_, k) => 100 * k + 50);

/**
 * The largest chain a backend describes: 10,000 parts, `agent.log.10099`
 * to `agent.log.1` without the 100 numbers of `LARGE_MISSING`, then the
 * active file; the editor holds one line of each. In `numbered` order
 * the numbers fall part by part. A chain's order is its parts' time
 * order, which their lines decide, so `mixed` orders the numbers by
 * another rule.
 */
function largeChain(order: 'numbered' | 'mixed'): { chain: ChainResponse; lines: FileLine[] } {
  const absent = new Set(LARGE_MISSING);
  let numbers: number[] = [];
  for (let n = 10_099; n >= 1; n--) if (!absent.has(n)) numbers.push(n);
  if (order === 'mixed')
    numbers = [...numbers].sort((a, b) => ((a * 7919) % 10_007) - ((b * 7919) % 10_007));
  const parts = numbers.map((n) => part(`agent.log.${n}`, { key: String(n), line_count: 1 }));
  parts.push(part('agent.log', { is_active: true, line_count: 1 }));
  return {
    chain: chain({
      name: 'agent.log',
      parts,
      missing: LARGE_MISSING.map((n) => `agent.log.${n}`),
      missing_count: LARGE_MISSING.length,
    }),
    lines: held(1, ...parts.map((p): [string, number] => [p.name, 1])),
  };
}

/** The fewest milliseconds `run` took in `times` runs. */
function fastestOf(times: number, run: () => void): number {
  let fastest = Infinity;
  for (let i = 0; i < times; i++) {
    const started = performance.now();
    run();
    fastest = Math.min(fastest, performance.now() - started);
  }
  return fastest;
}

describe('chainViewZones of a chain of 10,000 parts with 100 missing', () => {
  it.each(['numbered', 'mixed'] as const)(
    'puts each missing part before the part after its next higher number (%s order)',
    (order) => {
      const { chain: large, lines } = largeChain(order);
      const lineOf = new Map(lines.map((line, i) => [line.part, i]));
      const names = large.parts.map((p) => p.name);
      // The next higher number of a missing number n is n + 1, which is there.
      const after = (n: number) => names[names.indexOf(`agent.log.${n + 1}`) + 1];

      const zones = chainViewZones(lines, large);

      const missing = zones.filter((z) => z.kind === 'missing');
      expect(missing.map((z) => [z.afterLineNumber, z.text])).toEqual(
        LARGE_MISSING.map((n) => [lineOf.get(after(n)), `missing: agent.log.${n}`]).sort(
          (a, b) => Number(a[0]) - Number(b[0]),
        ),
      );
      expect(zones.filter((z) => z.kind === 'part')).toHaveLength(10_000);
    },
  );

  // A build takes about 2 ms here; the bound leaves room for a slower
  // machine and still fails a build that sorts the parts for each name.
  it('builds them for a page of lines within 15 ms, whatever the order of the numbers', () => {
    const { chain: large, lines } = largeChain('mixed');
    const page = lines.slice(0, LINES_PER_PAGE);

    const elapsed = fastestOf(5, () => chainViewZones(page, large));

    expect(elapsed).toBeLessThan(15);
  });
});

describe('chainZonesMemo', () => {
  const parts = [part('a.1', { key: '1' }), part('a', { is_active: true })];
  const lines = held(1, ['a.1', 1], ['a', 1]);

  it('gives the zones it built again for the same lines and description', () => {
    const zonesOf = chainZonesMemo();
    const description = chain({ name: 'a', parts });

    const first = zonesOf(lines, description);

    expect(first).toEqual(chainViewZones(lines, description));
    expect(zonesOf(lines, description)).toBe(first);
  });

  it('builds them again for another description or other lines', () => {
    const zonesOf = chainZonesMemo();
    const description = chain({ name: 'a', parts });
    const first = zonesOf(lines, description);

    const forDescription = zonesOf(lines, { ...description });
    const forLines = zonesOf([...lines], description);

    expect(forDescription).not.toBe(first);
    expect(forLines).not.toBe(forDescription);
    expect(forLines).toEqual(first);
  });

  it('gives one empty list while there is no description', () => {
    const zonesOf = chainZonesMemo();
    expect(zonesOf(lines, null)).toBe(NO_ZONES);
    expect(zonesOf([], null)).toBe(NO_ZONES);
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
