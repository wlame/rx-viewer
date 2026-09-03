import { describe, expect, it } from 'vitest';

import { resolveMatchLine } from './matchLine';
import type { TraceMatch, TraceResponse } from '../types';

function makeMatch(overrides: Partial<TraceMatch> = {}): TraceMatch {
  return {
    pattern: 'p1',
    file: 'f1',
    offset: 4096,
    relative_line_number: 12,
    absolute_line_number: -1,
    line_text: 'error happened here',
    submatches: [],
    ...overrides,
  };
}

function makeResponse(overrides: Partial<TraceResponse> = {}): TraceResponse {
  return {
    request_id: 'r1',
    path: ['/var/log/app.log'],
    time: 0.01,
    patterns: { p1: 'error' },
    files: { f1: '/var/log/app.log' },
    matches: [],
    scanned_files: [],
    skipped_files: [],
    max_results: null,
    file_chunks: { f1: 1 },
    context_lines: null,
    before_context: null,
    after_context: null,
    cli_command: null,
    ...overrides,
  };
}

describe('resolveMatchLine', () => {
  it('uses the relative line number when the file was scanned as one chunk', () => {
    const result = resolveMatchLine(makeMatch(), makeResponse({ file_chunks: { f1: 1 } }));

    expect(result).toEqual({ kind: 'line', line: 12 });
  });

  it('reports the line as unknown when the file was split into several chunks', () => {
    const result = resolveMatchLine(makeMatch(), makeResponse({ file_chunks: { f1: 3 } }));

    expect(result).toEqual({ kind: 'unknown', offset: 4096 });
  });

  it('uses the absolute line number whenever the backend knows it', () => {
    const match = makeMatch({ absolute_line_number: 90210 });

    expect(resolveMatchLine(match, makeResponse({ file_chunks: { f1: 3 } }))).toEqual({
      kind: 'line',
      line: 90210,
    });
    expect(resolveMatchLine(match, makeResponse({ file_chunks: { f1: 1 } }))).toEqual({
      kind: 'line',
      line: 90210,
    });
  });

  it('reports the line as unknown when the response carries no file_chunks', () => {
    const response = makeResponse();
    // An older backend, or a response shape that predates the field.
    delete (response as { file_chunks?: unknown }).file_chunks;

    expect(resolveMatchLine(makeMatch(), response)).toEqual({ kind: 'unknown', offset: 4096 });
  });

  it('reports the line as unknown when this file is missing from file_chunks', () => {
    const result = resolveMatchLine(makeMatch(), makeResponse({ file_chunks: { f2: 1 } }));

    expect(result).toEqual({ kind: 'unknown', offset: 4096 });
  });

  it('does not trust the relative line number on a cache hit without an absolute one', () => {
    // Both backends write file_chunks[id] = 0 for a result served from
    // the trace cache. Those matches carry an absolute line number, so
    // this combination should not occur; if it does, the chunk count
    // says nothing about the relative number and guessing would put the
    // cursor on the wrong line.
    const result = resolveMatchLine(makeMatch(), makeResponse({ file_chunks: { f1: 0 } }));

    expect(result).toEqual({ kind: 'unknown', offset: 4096 });
  });

  it('reports the line as unknown when there is no relative line number either', () => {
    const match = makeMatch({ relative_line_number: null });

    expect(resolveMatchLine(match, makeResponse({ file_chunks: { f1: 1 } }))).toEqual({
      kind: 'unknown',
      offset: 4096,
    });
  });
});
