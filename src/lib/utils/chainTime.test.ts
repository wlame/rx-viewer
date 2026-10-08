import { describe, expect, it } from 'vitest';
import {
  CHAIN_T0 as T0,
  HOUR_MS as HOUR,
  ISO_FORMAT,
  chainDescription as chain,
  chainPart as part,
  chainTabOf,
} from '../testing/chainDescription';
import type { ChainResponse } from '../types';
import {
  chainRangeUnknownReason,
  chainTimeAxis,
  chainTimeLayout,
  chainTimeRefusal,
  partAtTime,
} from './chainTime';

function tabOf(description: ChainResponse | null, indexProblem: string | null = null) {
  return chainTabOf(description, { indexProblem });
}

describe('chainTimeLayout', () => {
  it('takes the layout of the first part with lines and a known format, in the chain order', () => {
    const described = chain({
      parts: [
        part('agent.log.3', { size: 0, time_format: { ...ISO_FORMAT, format: 'clf' } }),
        part('agent.log.2', { time_format: null }),
        part('agent.log.1', { example: '2026-10-01T00:00:00Z' }),
        part('agent.log', {
          time_format: { ...ISO_FORMAT, format: 'syslog' },
          example: 'Oct  1 00:00:00',
        }),
      ],
    });

    expect(chainTimeLayout(described)).toEqual({
      format: 'iso',
      example: '2026-10-01T00:00:00Z',
      day_first: null,
      display_zone: 'UTC',
    });
  });

  it('shows the zone a chain is read in, for parts that write a zone too', () => {
    const zoned = { format: 'iso' as const, has_zone: true, assumed_zone: 'Europe/Berlin' };
    const described = chain({ parts: [part('agent.log.1', { time_format: zoned })] });

    expect(chainTimeLayout(described)?.display_zone).toBe('Europe/Berlin');
  });

  it('gives no layout for a chain none of whose parts has a known format', () => {
    const described = chain({ parts: [part('agent.log.1', { time_format: null })] });
    expect(chainTimeLayout(described)).toBe(null);
  });

  it('gives the same layout object for the same description', () => {
    const described = chain();
    expect(chainTimeLayout(described)).toBe(chainTimeLayout(described));
  });
});

describe('chainTimeAxis', () => {
  it('spans a ready chain from its first to its last time', () => {
    expect(chainTimeAxis(chain())).toEqual({ startMs: T0, endMs: T0 + 2 * HOUR });
  });

  it.each([
    ['pending', { state: 'pending' as const, first_ms: null, last_ms: null }],
    ['invalid', { state: 'invalid' as const }],
    ['ready without a last time', { last_ms: null }],
  ])('gives no axis for a chain %s', (_case, fields) => {
    expect(chainTimeAxis(chain(fields))).toBe(null);
  });
});

describe('chainTimeRefusal', () => {
  it('lets a ready chain jump by time', () => {
    expect(chainTimeRefusal('agent.log', tabOf(chain()))).toBe(null);
  });

  it('says the chain is being read before its first description', () => {
    expect(chainTimeRefusal('agent.log', tabOf(null))).toBe(
      'The log chain agent.log is being read',
    );
  });

  it('says the line indexes of a pending chain are being built', () => {
    expect(chainTimeRefusal('agent.log', tabOf(chain({ state: 'pending' })))).toBe(
      'agent.log is not ready: the line indexes of its parts are being built',
    );
  });

  it('gives why a pending chain has no index task, as the backend words it', () => {
    const refused = chain({ state: 'pending', index_build_refused: 'as many tasks as can run' });
    expect(chainTimeRefusal('agent.log', tabOf(refused))).toBe(
      'agent.log is not ready: as many tasks as can run',
    );
  });

  it('gives why the index task of a pending chain failed', () => {
    expect(chainTimeRefusal('agent.log', tabOf(chain({ state: 'pending' }), 'disk full'))).toBe(
      'agent.log is not ready: disk full',
    );
  });

  it('names the failed checks of an invalid chain', () => {
    const invalid = chain({
      state: 'invalid',
      reasons: [
        { code: 'overlap', message: 'overlap', overlap_ms: 1, parts: [] },
        { code: 'unreadable', message: 'unreadable', overlap_ms: null, parts: [] },
      ],
    });
    expect(chainTimeRefusal('agent.log', tabOf(invalid))).toBe(
      'agent.log is not a valid log chain: overlap, unreadable',
    );
  });
});

describe('chainRangeUnknownReason', () => {
  it('names the end of a ready chain whose time is not known', () => {
    expect(chainRangeUnknownReason('agent.log', chain({ last_ms: null }))).toBe(
      'The last time of agent.log is not known',
    );
    expect(chainRangeUnknownReason('agent.log', chain({ first_ms: null }))).toBe(
      'The first time of agent.log is not known',
    );
  });

  it('says a chain that is not ready has no time range yet', () => {
    expect(chainRangeUnknownReason('agent.log', chain({ state: 'pending' }))).toBe(
      'The time range of agent.log is not known yet',
    );
  });
});

describe('partAtTime', () => {
  const described = chain({
    parts: [
      part('agent.log.2', { first_ms: T0, max_ms: T0 + HOUR }),
      part('agent.log.1', { size: 0 }),
      part('agent.log', { is_active: true, first_ms: T0 + 3 * HOUR }),
    ],
    last_ms: T0 + 4 * HOUR,
  });

  it.each([
    ['its first time', T0, 'agent.log.2'],
    ['inside a part', T0 + HOUR / 2, 'agent.log.2'],
    ['a gap, the part before it', T0 + 2 * HOUR, 'agent.log.2'],
    ['the first time of a later part', T0 + 3 * HOUR, 'agent.log'],
    ['before the chain, the first part', T0 - HOUR, 'agent.log.2'],
  ])('finds the part that holds %s', (_case, ms, name) => {
    expect(partAtTime(described, ms)?.name).toBe(name);
  });
});
