/**
 * Builders of log chain descriptions for tests: a part, a ready chain
 * `agent.log` of two parts, and a chain's tab, each with every field set
 * and any field given by the test.
 */
import type { ChainPart, ChainResponse, ChainTab } from '../types';

/** 2026-10-01 00:00:00 UTC, the first time of the chain `chainDescription` builds. */
export const CHAIN_T0 = Date.UTC(2026, 9, 1, 0, 0, 0);

export const HOUR_MS = 3_600_000;

/** ISO 8601 timestamps without a zone, read in UTC. */
export const ISO_FORMAT: NonNullable<ChainPart['time_format']> = {
  format: 'iso',
  has_zone: false,
  assumed_zone: 'UTC',
};

/** How a part of an ISO chain writes its first timestamp. */
export const ISO_EXAMPLE = '2026-10-01 00:00:00.000';

/** A frozen part of 2 lines that writes ISO timestamps; its times are not known. */
export function chainPart(name: string, fields: Partial<ChainPart> = {}): ChainPart {
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
    time_format: ISO_FORMAT,
    day_first: null,
    example: ISO_EXAMPLE,
    duplicates: [],
    ...fields,
  };
}

/** The ready chain `/l/agent.log`: `agent.log.1` from 00:00, the active `agent.log` from 01:00 to 02:00. */
export function chainDescription(fields: Partial<ChainResponse> = {}): ChainResponse {
  return {
    path: '/l/agent.log',
    name: 'agent.log',
    state: 'ready',
    reasons: [],
    fingerprint: '00000000000000a1',
    parts: [
      chainPart('agent.log.1', {
        key: '1',
        first_ms: CHAIN_T0,
        max_ms: CHAIN_T0 + HOUR_MS,
        global_start: 1,
      }),
      chainPart('agent.log', {
        is_active: true,
        first_ms: CHAIN_T0 + HOUR_MS,
        global_start: 3,
      }),
    ],
    missing: [],
    missing_count: 0,
    gaps: [],
    first_ms: CHAIN_T0,
    last_ms: CHAIN_T0 + 2 * HOUR_MS,
    frozen_line_count: 2,
    line_count: 4,
    index_build: null,
    index_build_refused: null,
    cli_command: 'rx logs show /l/agent.log',
    ...fields,
  };
}

/** What a chain's tab holds with `description`, by global numbers once it is ready. */
export function chainTabOf(
  description: ChainResponse | null,
  fields: Partial<ChainTab> = {},
): ChainTab {
  return {
    handle: description?.path ?? '/l/agent.log',
    description,
    numbering: description?.state === 'ready' ? 'global' : 'local',
    bases: new Map(),
    counts: new Map(),
    anchor: null,
    indexTask: null,
    indexProblem: null,
    invalidDetail: null,
    ...fields,
  };
}
