import { describe, expect, it } from 'vitest';

import { searchedFileCount } from './traceSummary';
import type { TraceResponse } from '../types';

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
    context_lines: {},
    before_context: null,
    after_context: null,
    cli_command: null,
    ...overrides,
  };
}

describe('searchedFileCount', () => {
  // scanned_files lists only what a directory expanded to, so a search of
  // named files — every "Only opened files" search — reported 0 files.
  it('counts a file named directly in the request', () => {
    expect(searchedFileCount(makeResponse())).toBe(1);
  });

  it('counts every file a directory expanded to', () => {
    const response = makeResponse({
      path: ['/var/log'],
      files: { f1: '/var/log/a.log', f2: '/var/log/b.log', f3: '/var/log/c.log' },
      scanned_files: ['/var/log/a.log', '/var/log/b.log', '/var/log/c.log'],
    });

    expect(searchedFileCount(response)).toBe(3);
  });

  it('counts nothing when no file was searched', () => {
    expect(searchedFileCount(makeResponse({ files: {} }))).toBe(0);
  });
});
