import { describe, expect, it } from 'vitest';

import { chainCount, pathInSearch, searchedFileCount, skippedFiles } from './traceSummary';
import { chainRef, chainSearchAnswer } from '../testing/chainSearchAnswer';
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
    skip_reasons: [],
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

describe('skippedFiles', () => {
  it('lists each skipped path with its reason, in the order of the answer', () => {
    const response = makeResponse({
      skipped_files: ['/var/log/login.bin', '/var/log/app.log.2'],
      skip_reasons: [
        { path: '/var/log/login.bin', reason: 'binary file' },
        {
          path: '/var/log/app.log.2',
          reason:
            'duplicate_part: the same part of its log chain as app.log.2.gz, which is searched',
        },
      ],
    });

    expect(skippedFiles(response)).toEqual({
      shown: [
        { path: '/var/log/login.bin', reason: 'binary file' },
        {
          path: '/var/log/app.log.2',
          reason:
            'duplicate_part: the same part of its log chain as app.log.2.gz, which is searched',
        },
      ],
      more: 0,
    });
  });

  // The list is keyed by path, so a path the answer names twice is one row.
  it('lists a path the answer names twice once, and counts it once', () => {
    const response = makeResponse({
      skipped_files: ['/var/log/login.bin', '/var/log/login.bin', '/var/log/core.bin'],
      skip_reasons: [{ path: '/var/log/login.bin', reason: 'binary file' }],
    });

    expect(skippedFiles(response, 1)).toEqual({
      shown: [{ path: '/var/log/login.bin', reason: 'binary file' }],
      more: 1,
    });
  });

  it('gives a path no reason when the answer gives it none', () => {
    const response = makeResponse({ skipped_files: ['/var/log/login.bin'], skip_reasons: [] });

    expect(skippedFiles(response).shown).toEqual([{ path: '/var/log/login.bin', reason: null }]);
  });

  // A directory walk can skip thousands of files; the list shows a few
  // and says how many more there are.
  it('shows at most the limit and counts the rest', () => {
    const paths = Array.from({ length: 5 }, (_, i) => `/var/log/bin${i}`);
    const response = makeResponse({
      skipped_files: paths,
      skip_reasons: paths.map((path) => ({ path, reason: 'binary file' })),
    });

    const { shown, more } = skippedFiles(response, 2);

    expect(shown.map((entry) => entry.path)).toEqual(['/var/log/bin0', '/var/log/bin1']);
    expect(more).toBe(3);
  });

  it('lists nothing when nothing was skipped', () => {
    expect(skippedFiles(makeResponse())).toEqual({ shown: [], more: 0 });
  });
});

describe('chainCount', () => {
  it('counts the chains a chain search found', () => {
    const response = chainSearchAnswer({
      chains: {
        c1: chainRef('/var/log/app.log', ['f1'], 'ready'),
        c2: chainRef('/var/log/svc.log', ['f2'], 'pending'),
      },
    });

    expect(chainCount(response)).toBe(2);
  });

  it('counts no chain in a trace answer', () => {
    expect(chainCount(makeResponse())).toBe(0);
  });
});

describe('pathInSearch', () => {
  it.each([
    { path: '/srv/logs/stats/stats_1', searched: ['/srv/logs'], expected: 'stats/stats_1' },
    // The deepest searched path that holds it names it.
    { path: '/srv/logs/stats/stats_1', searched: ['/srv', '/srv/logs'], expected: 'stats/stats_1' },
    // A path the search named itself reads as its name.
    { path: '/srv/logs/login.bin', searched: ['/srv/logs/login.bin'], expected: 'login.bin' },
    // A searched path is a whole directory, not a prefix of a name.
    { path: '/srv/logs2/login.bin', searched: ['/srv/logs'], expected: '/srv/logs2/login.bin' },
    { path: '/srv/logs/login.bin', searched: ['/'], expected: 'srv/logs/login.bin' },
    { path: '/srv/logs/login.bin', searched: [], expected: '/srv/logs/login.bin' },
  ])('writes $path searched in $searched as $expected', ({ path, searched, expected }) => {
    expect(pathInSearch(path, searched)).toBe(expected);
  });
});
