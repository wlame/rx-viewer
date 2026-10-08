import { describe, expect, it } from 'vitest';
import {
  CHAIN_T0 as T0,
  HOUR_MS as HOUR,
  chainDescription,
  chainPart as part,
} from '../testing/chainDescription';
import type { ChainResponse } from '../types';
import { MAX_TIMELINE_MARKS, chainTimelineMarks } from './chainTimeline';

/**
 * agent.log.4.gz 00:00–00:54, agent.log.3 missing, agent.log.2.gz
 * 01:00–02:00, agent.log.1 empty, a gap to agent.log at 05:00–06:00.
 */
function described(fields: Partial<ChainResponse> = {}): ChainResponse {
  return chainDescription({
    parts: [
      part('agent.log.4.gz', { key: '4', first_ms: T0, max_ms: T0 + 0.9 * HOUR }),
      part('agent.log.2.gz', { key: '2', first_ms: T0 + HOUR, max_ms: T0 + 2 * HOUR }),
      part('agent.log.1', { key: '1', size: 0, line_count: 0 }),
      part('agent.log', { is_active: true, first_ms: T0 + 5 * HOUR }),
    ],
    missing: ['agent.log.3'],
    missing_count: 1,
    gaps: [
      {
        after: 'agent.log.2.gz',
        before: 'agent.log',
        from_ms: T0 + 2 * HOUR,
        to_ms: T0 + 5 * HOUR,
      },
    ],
    last_ms: T0 + 6 * HOUR,
    ...fields,
  });
}

describe('chainTimelineMarks', () => {
  it('ticks each part edge after the first part with lines, named by its part', () => {
    const marks = chainTimelineMarks(described());

    expect(marks?.ticks.map((tick) => [tick.fraction, tick.title])).toEqual([
      [1 / 6, 'agent.log.2.gz from 2026-10-01 01:00:00.000'],
      [5 / 6, 'agent.log from 2026-10-01 05:00:00.000'],
    ]);
  });

  it('shades each time gap from its start to its end', () => {
    const marks = chainTimelineMarks(described());

    expect(marks?.gaps).toEqual([
      {
        fromFraction: 2 / 6,
        toFraction: 5 / 6,
        title: 'No lines from 2026-10-01 02:00:00.000 to 2026-10-01 05:00:00.000',
      },
    ]);
  });

  it('marks a missing part between the parts it would sit between', () => {
    const marks = chainTimelineMarks(described());

    expect(marks?.missing).toEqual([
      { fraction: (0.95 * HOUR) / (6 * HOUR), title: 'Missing: agent.log.3' },
    ]);
  });

  it('gives no marks for a chain without a time axis', () => {
    expect(chainTimelineMarks(described({ state: 'pending', first_ms: null, last_ms: null }))).toBe(
      null,
    );
  });

  it('gives the same marks for the same description', () => {
    const chain = described();
    expect(chainTimelineMarks(chain)).toBe(chainTimelineMarks(chain));
  });

  it('merges the marks of 10,000 parts into a bounded number, naming the parts of a merged tick', () => {
    const count = 10_000;
    const parts = Array.from({ length: count }, (_, i) =>
      part(`agent.log.${count - i}`, {
        key: String(count - i),
        first_ms: T0 + i * 1000,
        max_ms: T0 + i * 1000 + 999,
      }),
    );
    const gaps = parts.slice(1).map((p, i) => ({
      after: parts[i].name,
      before: p.name,
      from_ms: T0 + i * 1000 + 999,
      to_ms: T0 + (i + 1) * 1000,
    }));
    // Every 100th number is missing: 100 names, each placed between two parts.
    const present = parts.filter((p) => Number(p.key) % 100 !== 50);
    const missing = parts.filter((p) => Number(p.key) % 100 === 50).map((p) => p.name);
    const marks = chainTimelineMarks(
      described({ parts: present, gaps, missing, last_ms: T0 + count * 1000 }),
    );

    expect(marks?.ticks.length).toBeLessThanOrEqual(MAX_TIMELINE_MARKS + 1);
    expect(marks?.gaps.length).toBeLessThanOrEqual(MAX_TIMELINE_MARKS + 1);
    expect(marks?.missing.length).toBe(100);
    const merged = marks?.ticks.find((tick) => tick.title.includes('parts start'));
    expect(merged?.title).toMatch(/^agent\.log\.\d+ … agent\.log\.\d+: \d+ parts start here$/);
  });
});
