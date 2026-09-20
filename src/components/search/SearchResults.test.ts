// @vitest-environment jsdom
import '$lib/testing/matchMediaStub';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { get, type Writable } from 'svelte/store';
import { trace } from '$lib/stores';
import { notifications } from '$lib/stores/notifications';
import { noLineAtOffset } from '$lib/offsetLines';
import type { TraceResponse } from '$lib/types';
import SearchResults from './SearchResults.svelte';

const PATH = '/logs/app.log.gz';
const OFFSET = 4096;

// The panel reads the search answer from the trace store; the test sets
// it directly instead of running a search.
vi.mock('$lib/stores', async (importOriginal) => {
  const original = await importOriginal<typeof import('$lib/stores')>();
  const { writable: makeWritable } = await import('svelte/store');
  return {
    ...original,
    trace: makeWritable({ searching: false, response: null, error: null }),
    tree: makeWritable({ roots: [], loading: false }),
  };
});
const traceState = trace as unknown as Writable<{
  searching: boolean;
  response: TraceResponse | null;
  error: null;
}>;

const openFileAtLine = vi.hoisted(() => vi.fn(async (_path: string, _line: number) => {}));
vi.mock('$lib/fileOpening', () => ({ openFileAtLine }));

/** A capped search of a compressed file whose one match has no line yet. */
function answerWithUnknownLine(): TraceResponse {
  return {
    files: { f1: PATH },
    patterns: { p1: 'timeout' },
    file_chunks: { f1: 1 },
    matches: [
      {
        file: 'f1',
        pattern: 'p1',
        offset: OFFSET,
        absolute_line_number: -1,
        relative_line_number: null,
        line_text: 'request timeout',
      },
    ],
    time: 0.1,
    max_results: 1,
  } as unknown as TraceResponse;
}

/** `/v1/samples` answers with `offsets`, or refuses with `detail`. */
function stubSamples(
  answer: { offsets: Record<string, number> } | { status: number; detail: string },
) {
  const fetchMock = vi.fn(async () =>
    'offsets' in answer
      ? {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async (): Promise<unknown> => ({
            path: PATH,
            offsets: answer.offsets,
            lines: {},
            samples: {},
          }),
          text: async (): Promise<string> => '',
        }
      : {
          ok: false,
          status: answer.status,
          statusText: 'Error',
          json: async (): Promise<unknown> => ({ detail: answer.detail }),
          text: async (): Promise<string> => JSON.stringify({ detail: answer.detail }),
        },
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const settle = async () => {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await tick();
  }
};

let results: SearchResults | null = null;

async function mountWithAnswer() {
  const target = document.createElement('div');
  document.body.appendChild(target);
  results = new SearchResults({ target });
  traceState.set({ searching: false, response: answerWithUnknownLine(), error: null });
  await settle();
  const row = target.querySelector<HTMLButtonElement>('li button');
  if (!row) throw new Error('the match row is not rendered');
  return row;
}

afterEach(() => {
  results?.$destroy();
  results = null;
  traceState.set({ searching: false, response: null, error: null });
  openFileAtLine.mockClear();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  for (const n of get(notifications)) notifications.dismiss(n.id);
});

describe('SearchResults with a line the search left unknown', () => {
  it('shows the line the backend resolves from the offset and jumps to it', async () => {
    stubSamples({ offsets: { [OFFSET]: 321 } });
    const row = await mountWithAnswer();

    expect(row.textContent).toContain(':321');
    row.click();
    await settle();

    expect(openFileAtLine).toHaveBeenCalledWith(PATH, 321);
  });

  it('says why the line stays unknown when the backend refuses the offset', async () => {
    const reason =
      "Byte offsets are not supported for compressed files. Use 'lines' parameter instead.";
    stubSamples({ status: 400, detail: reason });
    const row = await mountWithAnswer();

    expect(row.textContent).toContain('line unknown');
    expect(row.textContent).toContain(reason);
  });

  it('tells the user why a click cannot jump instead of doing nothing', async () => {
    stubSamples({ offsets: { [OFFSET]: -1 } });
    const row = await mountWithAnswer();

    row.click();
    await settle();

    expect(openFileAtLine).not.toHaveBeenCalled();
    expect(row.textContent).toContain(noLineAtOffset(OFFSET));
    expect(get(notifications).map((n) => n.message)).toContainEqual(
      expect.stringContaining(noLineAtOffset(OFFSET)),
    );
  });
});
