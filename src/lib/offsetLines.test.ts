import { afterEach, describe, expect, it, vi } from 'vitest';
import { OffsetLineResolver, offsetKey, noLineAtOffset } from './offsetLines';
import { SUPERSEDED } from './utils/latestRequest';
import type { TraceResponse } from './types';

const PATH = '/var/log/app.log';

/** A search answer whose matches carry only byte offsets, no line. */
function responseWithUnknownLines(offsets: number[]): TraceResponse {
  return {
    files: { f1: PATH },
    patterns: { p1: 'ERROR' },
    file_chunks: { f1: 4 },
    matches: offsets.map((offset) => ({
      file: 'f1',
      pattern: 'p1',
      offset,
      absolute_line_number: -1,
      relative_line_number: 1,
      line_text: 'ERROR',
    })),
    time: 0.1,
  } as unknown as TraceResponse;
}

interface PendingLookup {
  url: string;
  signal: AbortSignal | undefined;
  answer: (lines: Record<string, number>) => void;
}

/**
 * A backend whose `/v1/samples` answers only when the test says so, so a
 * lookup can be superseded while it is still in flight.
 */
function stubSlowSamples() {
  const pending: PendingLookup[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (url: string, init?: RequestInit) =>
        new Promise((resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          );
          pending.push({
            url,
            signal: init?.signal ?? undefined,
            answer: (lines) =>
              resolve({
                ok: true,
                status: 200,
                statusText: 'OK',
                json: async () => ({ path: PATH, offsets: lines, lines: {}, samples: {} }),
                text: async () => '',
              }),
          });
        }),
    ),
  );
  return pending;
}

/** A backend whose `/v1/samples` answers every request with an error. */
function stubRefusingSamples(status: number, detail: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: false,
      status,
      statusText: 'Error',
      json: async () => ({ detail }),
      text: async () => JSON.stringify({ detail }),
    })),
  );
}

/** Let the resolver's awaits run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('OffsetLineResolver', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('resolves the unknown lines of a search in one request per file', async () => {
    const pending = stubSlowSamples();
    const resolver = new OffsetLineResolver();
    const reported: Record<string, number>[] = [];

    const done = resolver.resolveAll(responseWithUnknownLines([100, 200]), (lines) =>
      reported.push(lines),
    );
    await settle();
    expect(pending).toHaveLength(1);
    expect(new URL(pending[0].url, 'http://localhost').searchParams.get('offsets')).toBe('100,200');
    pending[0].answer({ '100': 7, '200': 9 });
    await done;

    expect(reported).toEqual([{ [offsetKey(PATH, 100)]: 7, [offsetKey(PATH, 200)]: 9 }]);
  });

  it('aborts the lookup of a superseded search and never reports its lines', async () => {
    const pending = stubSlowSamples();
    const resolver = new OffsetLineResolver();
    const reported: Record<string, number>[] = [];

    const first = resolver.resolveAll(responseWithUnknownLines([100]), (lines) =>
      reported.push(lines),
    );
    await settle();
    const second = resolver.resolveAll(responseWithUnknownLines([300]), (lines) =>
      reported.push(lines),
    );
    await settle();

    expect(pending[0].signal?.aborted).toBe(true);
    pending[1].answer({ '300': 12 });
    await Promise.all([first, second]);
    expect(reported).toEqual([{ [offsetKey(PATH, 300)]: 12 }]);
  });

  it('aborts the lookup in flight when the search is cleared', async () => {
    const pending = stubSlowSamples();
    const resolver = new OffsetLineResolver();

    const first = resolver.resolveAll(responseWithUnknownLines([100]), () => {});
    await settle();
    await resolver.resolveAll(null, () => {});

    expect(pending[0].signal?.aborted).toBe(true);
    await first;
  });

  it('aborts a jump lookup when another result is clicked', async () => {
    const pending = stubSlowSamples();
    const resolver = new OffsetLineResolver();

    const first = resolver.resolveOne(PATH, 100);
    await settle();
    const second = resolver.resolveOne(PATH, 300);
    await settle();
    pending[1].answer({ '300': 12 });

    expect(pending[0].signal?.aborted).toBe(true);
    expect(await first).toBe(SUPERSEDED);
    expect(await second).toEqual({ line: 12 });
  });

  it('gives the reason a backend states when it refuses the lookup', async () => {
    stubRefusingSamples(
      400,
      "Byte offsets are not supported for compressed files. Use 'lines' parameter instead.",
    );
    const resolver = new OffsetLineResolver();

    expect(await resolver.resolveOne(PATH, 100)).toEqual({
      reason: "Byte offsets are not supported for compressed files. Use 'lines' parameter instead.",
    });
  });

  it('says the file has no line at an offset the answer leaves unknown', async () => {
    const pending = stubSlowSamples();
    const resolver = new OffsetLineResolver();

    const lookup = resolver.resolveOne(PATH, 300);
    await settle();
    pending[0].answer({ '300': -1 });

    expect(await lookup).toEqual({ reason: noLineAtOffset(300) });
  });

  it('reports why each offset of a failed batch stays unknown', async () => {
    stubRefusingSamples(500, 'read /var/log/app.log: input/output error');
    const resolver = new OffsetLineResolver();
    const reasons: Record<string, string>[] = [];

    await resolver.resolveAll(
      responseWithUnknownLines([100, 200]),
      () => {},
      (found) => reasons.push(found),
    );

    expect(reasons).toEqual([
      {
        [offsetKey(PATH, 100)]: 'read /var/log/app.log: input/output error',
        [offsetKey(PATH, 200)]: 'read /var/log/app.log: input/output error',
      },
    ]);
  });

  it('reports a batch offset the answer leaves unknown with its reason, and the rest as lines', async () => {
    const pending = stubSlowSamples();
    const resolver = new OffsetLineResolver();
    const lines: Record<string, number>[] = [];
    const reasons: Record<string, string>[] = [];

    const done = resolver.resolveAll(
      responseWithUnknownLines([100, 900]),
      (found) => lines.push(found),
      (found) => reasons.push(found),
    );
    await settle();
    pending[0].answer({ '100': 7, '900': -1 });
    await done;

    expect(lines).toEqual([{ [offsetKey(PATH, 100)]: 7 }]);
    expect(reasons).toEqual([{ [offsetKey(PATH, 900)]: noLineAtOffset(900) }]);
  });
});
