// @vitest-environment jsdom
import '$lib/testing/matchMediaStub';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { get, type Writable } from 'svelte/store';
import { files, health, trace } from '$lib/stores';
import { chainMode } from '$lib/stores/chainMode';
import { notifications } from '$lib/stores/notifications';
import { noLineAtOffset } from '$lib/offsetLines';
import {
  chainMatch,
  chainRef,
  chainSearchAnswer,
  mixedChainSearchAnswer,
} from '$lib/testing/chainSearchAnswer';
import type { SearchResponse, TraceResponse } from '$lib/types';
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
  response: SearchResponse | null;
  error: null;
}>;

const { openFileAtLine, openChainAt } = vi.hoisted(() => ({
  openFileAtLine: vi.fn(async (_path: string, _line: number) => {}),
  openChainAt: vi.fn(async (_handle: string, _position: unknown, _opening: unknown) => {}),
}));
vi.mock('$lib/fileOpening', () => ({ openFileAtLine, openChainAt }));

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
  openChainAt.mockClear();
  files.clearMatches();
  chainMode.set(false);
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

/** A backend that serves log chains, with chain mode as `isOn` says. */
async function chainModeWith(isOn: boolean) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ contract_version: '1.7', features: ['log_chains'] }),
      text: async () => '',
    })),
  );
  await health.check();
  chainMode.set(isOn);
}

/** Mount the results with `answer` and return the panel's element. */
async function mountWith(answer: SearchResponse): Promise<HTMLElement> {
  const target = document.createElement('div');
  document.body.appendChild(target);
  results = new SearchResults({ target });
  traceState.set({ searching: false, response: answer, error: null });
  await settle();
  return target;
}

/** The label of each match row (its names and lines, not the line's text), white space folded. */
function rowTexts(target: HTMLElement): string[] {
  return [...target.querySelectorAll<HTMLButtonElement>('li button')].map((row) =>
    (row.querySelector('div')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
  );
}

function row(target: HTMLElement, index: number): HTMLButtonElement {
  const found = target.querySelectorAll<HTMLButtonElement>('li button')[index];
  if (!found) throw new Error(`no row ${index}`);
  return found;
}

describe('SearchResults of a chain search', () => {
  it("reads a ready chain's match as its chain line beside its part line, and the others as files", async () => {
    await chainModeWith(true);
    const target = await mountWith(mixedChainSearchAnswer());

    expect(rowTexts(target)).toEqual([
      'app.log:12 app.log.2.gz:12 (@100)',
      'app.log:3500 app.log.1:500 (@900)',
      'notes.txt :3 (@40)',
      'svc.log.1 :7 (@70)',
    ]);
  });

  it("names the chain of a pending chain's part in its tooltip", async () => {
    await chainModeWith(true);
    const target = await mountWith(mixedChainSearchAnswer());

    expect(row(target, 3).querySelector('[title]')?.getAttribute('title')).toContain('svc.log');
  });

  it('lists the matches in the order the backend sends them', async () => {
    await chainModeWith(true);
    const answer = mixedChainSearchAnswer();
    answer.matches.reverse();

    const target = await mountWith(answer);

    expect(rowTexts(target).map((text) => text.split(' ')[0])).toEqual([
      'svc.log.1',
      'notes.txt',
      'app.log:3500',
      'app.log:12',
    ]);
  });

  it('says how many log chains the search found', async () => {
    await chainModeWith(true);
    const target = await mountWith(mixedChainSearchAnswer());

    expect(target.textContent?.replace(/\s+/g, ' ')).toContain(
      'Found 4 matches in 6 files, 2 log chains',
    );
  });

  it("opens a ready chain's tab at the match's chain line, marking the chain's matches", async () => {
    await chainModeWith(true);
    const answer = mixedChainSearchAnswer();
    const target = await mountWith(answer);

    row(target, 1).click();
    await settle();

    // The chain's fingerprint as the search read it goes with the click.
    expect(openChainAt).toHaveBeenCalledWith(
      '/logs/app.log',
      { kind: 'global', line: 3500 },
      {
        marks: [
          { lineNumber: 12, part: 'app.log.2.gz', patternId: 'p1', pattern: 'timeout' },
          { lineNumber: 500, part: 'app.log.1', patternId: 'p1', pattern: 'timeout' },
        ],
        search: answer,
        fingerprint: '00000000000000a1',
      },
    );
    expect(openFileAtLine).not.toHaveBeenCalled();
  });

  it("opens a pending chain's tab at the part's own line", async () => {
    await chainModeWith(true);
    const answer = mixedChainSearchAnswer();
    const target = await mountWith(answer);

    row(target, 3).click();
    await settle();

    expect(openChainAt).toHaveBeenCalledWith(
      '/logs/svc.log',
      { kind: 'local', part: 'svc.log.1', line: 7 },
      {
        marks: [{ lineNumber: 7, part: 'svc.log.1', patternId: 'p1', pattern: 'timeout' }],
        search: answer,
        fingerprint: '00000000000000a1',
      },
    );
  });

  it('opens a file searched on its own as a file', async () => {
    await chainModeWith(true);
    const target = await mountWith(mixedChainSearchAnswer());

    row(target, 2).click();
    await settle();

    expect(openFileAtLine).toHaveBeenCalledWith('/logs/notes.txt', 3);
    expect(openChainAt).not.toHaveBeenCalled();
  });

  it("opens a chain match's part as a file once chain mode is off", async () => {
    await chainModeWith(false);
    const target = await mountWith(mixedChainSearchAnswer());

    row(target, 1).click();
    await settle();

    expect(openChainAt).not.toHaveBeenCalled();
    expect(openFileAtLine).toHaveBeenCalledWith('/logs/app.log.1', 500);
    expect(get(files).matches.get('/logs/app.log.1')).toEqual([
      { lineNumber: 500, patternId: 'p1', pattern: 'timeout' },
    ]);
  });

  it("opens a match of an invalid chain as its part's file", async () => {
    await chainModeWith(true);
    const answer = chainSearchAnswer({
      files: { f1: '/logs/bad.log.1', f2: '/logs/bad.log' },
      chains: { c1: chainRef('/logs/bad.log', ['f1', 'f2'], 'invalid') },
      matches: [chainMatch({ file: 'f1', absolute_line_number: 4, chain: 'c1' })],
    });
    const target = await mountWith(answer);

    row(target, 0).click();
    await settle();

    expect(openChainAt).not.toHaveBeenCalled();
    expect(openFileAtLine).toHaveBeenCalledWith('/logs/bad.log.1', 4);
  });

  it("opens the part's line a capped match resolves to when the chain gives no line", async () => {
    await chainModeWith(true);
    stubSamples({ offsets: { [OFFSET]: 321 } });
    const answer = chainSearchAnswer({
      files: { f1: '/logs/app.log.1' },
      file_chunks: { f1: 4 },
      chains: { c1: chainRef('/logs/app.log', ['f1'], 'ready') },
      matches: [chainMatch({ file: 'f1', offset: OFFSET, absolute_line_number: -1, chain: 'c1' })],
    });
    const target = await mountWith(answer);

    expect(rowTexts(target)).toEqual([`app.log.1 :321 (@${OFFSET})`]);
    expect(row(target, 0).querySelector('[title]')?.getAttribute('title')).toContain(
      'the search gave this match no line number',
    );
    row(target, 0).click();
    await settle();

    expect(openChainAt).toHaveBeenCalledWith(
      '/logs/app.log',
      { kind: 'local', part: 'app.log.1', line: 321 },
      {
        marks: [{ lineNumber: 321, part: 'app.log.1', patternId: 'p1', pattern: 'timeout' }],
        search: answer,
        fingerprint: '00000000000000a1',
      },
    );
  });
});

describe('SearchResults skipped files', () => {
  const DUPLICATE =
    'duplicate_part: the same part of its log chain as app.log.2.gz, which is searched';

  it('lists every skipped file with its reason, another encoding of a part among them', async () => {
    const answer = chainSearchAnswer({
      skipped_files: ['/logs/app.log.2', '/logs/login.bin'],
      skip_reasons: [
        { path: '/logs/app.log.2', reason: DUPLICATE },
        { path: '/logs/login.bin', reason: 'binary file' },
      ],
    });

    const target = await mountWith(answer);

    const skipped = target.querySelector('details');
    expect(skipped?.querySelector('summary')?.textContent?.trim()).toBe('2 files skipped');
    expect(skipped?.querySelector('li [title]')?.getAttribute('title')).toBe('/logs/app.log.2');
    expect(
      [...(skipped?.querySelectorAll('li') ?? [])].map((li) =>
        li.textContent?.replace(/\s+/g, ' ').trim(),
      ),
    ).toEqual([`app.log.2: ${DUPLICATE}`, 'login.bin: binary file']);
  });

  it('says how many more files were skipped than it lists', async () => {
    const paths = Array.from({ length: 103 }, (_, i) => `/logs/bin${i}`);
    const answer = chainSearchAnswer({
      skipped_files: paths,
      skip_reasons: paths.map((path) => ({ path, reason: 'binary file' })),
    });

    const target = await mountWith(answer);

    const items = target.querySelectorAll('details li');
    expect(items).toHaveLength(101);
    expect(items[100].textContent?.trim()).toBe('and 3 more');
  });

  it('shows no list when no file was skipped', async () => {
    const target = await mountWith(chainSearchAnswer());

    expect(target.querySelector('details')).toBeNull();
  });
});
