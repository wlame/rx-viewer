/**
 * Answers of `GET /v1/logs/trace` for tests: a match with every field a
 * chain search gives, and an answer with an empty table of each kind
 * unless the test gives one.
 */
import type { ChainMatch, ChainRef, ChainTraceResponse } from '../types';

/** A match of a chain search: line 1 of its file, in no chain, unless `fields` say otherwise. */
export function chainMatch(fields: Partial<ChainMatch> & Pick<ChainMatch, 'file'>): ChainMatch {
  return {
    pattern: 'p1',
    offset: 0,
    relative_line_number: null,
    absolute_line_number: 1,
    line_text: 'line',
    submatches: [],
    line_text_truncated: false,
    submatches_truncated: false,
    chain: null,
    chain_line: -1,
    ...fields,
  };
}

/** A chain of a chain search answer, with its handle split into the directory and the name. */
export function chainRef(
  handle: string,
  parts: string[],
  state: ChainRef['state'],
  fields: Partial<ChainRef> = {},
): ChainRef {
  return {
    path: handle,
    name: handle.slice(handle.lastIndexOf('/') + 1),
    parts,
    fingerprint: '00000000000000a1',
    state,
    reasons: [],
    ...fields,
  };
}

/** A chain search answer: no files, matches or chains unless `fields` give them. */
export function chainSearchAnswer(fields: Partial<ChainTraceResponse> = {}): ChainTraceResponse {
  return {
    request_id: 'r1',
    path: ['/logs'],
    patterns: { p1: 'timeout' },
    files: {},
    matches: [],
    chains: {},
    scanned_files: [],
    skipped_files: [],
    skip_reasons: [],
    max_results: null,
    file_chunks: {},
    context_lines: {},
    before_context: null,
    after_context: null,
    time: 0.01,
    cli_command: 'rx logs trace /logs --regexp=timeout',
    ...fields,
  };
}

/**
 * A search of `/logs` that reaches two chains and a file of its own:
 * `app.log` (ready; `app.log.2.gz` holds global lines 1–3000, `app.log.1`
 * 3001–4500, `app.log` from 4501), `svc.log` (pending, no global lines)
 * and `notes.txt`. Each match is listed in the order rx-go sends it.
 */
export function mixedChainSearchAnswer(): ChainTraceResponse {
  return chainSearchAnswer({
    files: {
      f1: '/logs/app.log.2.gz',
      f2: '/logs/app.log.1',
      f3: '/logs/app.log',
      f4: '/logs/notes.txt',
      f5: '/logs/svc.log.1',
      f6: '/logs/svc.log',
    },
    file_chunks: { f1: 1, f2: 1, f3: 1, f4: 1, f5: 1, f6: 1 },
    chains: {
      c1: chainRef('/logs/app.log', ['f1', 'f2', 'f3'], 'ready'),
      c2: chainRef('/logs/svc.log', ['f5', 'f6'], 'pending'),
    },
    matches: [
      chainMatch({
        file: 'f1',
        offset: 100,
        absolute_line_number: 12,
        chain: 'c1',
        chain_line: 12,
      }),
      chainMatch({
        file: 'f2',
        offset: 900,
        absolute_line_number: 500,
        chain: 'c1',
        chain_line: 3500,
      }),
      chainMatch({ file: 'f4', offset: 40, absolute_line_number: 3 }),
      chainMatch({ file: 'f5', offset: 70, absolute_line_number: 7, chain: 'c2' }),
    ],
  });
}
