// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import type { ChainResponse, FileLine, OpenFile, TimeRangeResponse } from '$lib/types';
import type { TimeJumpOutcome, TimeQuery } from '$lib/stores/files';
import {
  CHAIN_T0,
  HOUR_MS,
  ISO_FORMAT,
  chainDescription,
  chainPart,
  chainTabOf,
} from '$lib/testing/chainDescription';
import TimelineBar from './TimelineBar.svelte';

/** 2025-12-10 07:00:00 UTC. */
const HOUR_START = Date.UTC(2025, 11, 10, 7, 0, 0);
const HOUR = 3_600_000;
/** The width every test gives the track; jsdom does no layout. */
const TRACK_WIDTH = 200;

function rangeOf(path: string, firstMs: number, lastMs: number): TimeRangeResponse {
  return {
    path,
    format: 'iso',
    has_zone: false,
    day_first: null,
    display_zone: 'UTC',
    example: '2025-12-10 07:00:04.574',
    first_ms: firstMs,
    last_ms: lastMs,
    source: 'scan',
    cli_command: `rx time-range ${path}`,
  };
}

function openFile(path: string, overrides: Partial<OpenFile> = {}): OpenFile {
  return {
    path,
    name: path.split('/').pop() ?? path,
    lines: [],
    totalLines: null,
    startLine: 1,
    endLine: 0,
    loading: false,
    error: null,
    isCompressed: false,
    compressionFormat: null,
    reachedStart: true,
    reachedEnd: false,
    syntaxHighlighting: true,
    fileSize: 1000,
    regexFilter: null,
    showInvisibleChars: false,
    wordWrap: false,
    isIndexed: false,
    anomalies: null,
    anomalySummary: null,
    selectedAnomalyCategory: null,
    anchorLine: 1,
    indexBuild: null,
    fileType: null,
    pendingIndex: null,
    backgroundIndexBuild: null,
    timeRange: null,
    isReadingTimeRange: false,
    timeJump: null,
    ...overrides,
  };
}

/** Lines `first`… of a file, each with the time given for it. */
function stampedLines(first: number, stamps: (number | null)[]): FileLine[] {
  return stamps.map((timestampMs, i) => ({
    lineNumber: first + i,
    content: `LINE ${first + i}`,
    timestampMs,
  }));
}

/** middleware.log spans the hour; postgresql.log starts and ends 30 minutes later. */
const middleware = openFile('/logs/middleware.log', {
  timeRange: rangeOf('/logs/middleware.log', HOUR_START, HOUR_START + HOUR),
});
const postgresql = openFile('/logs/postgresql.log', {
  timeRange: rangeOf('/logs/postgresql.log', HOUR_START + HOUR / 2, HOUR_START + 2 * HOUR),
});

let bar: TimelineBar | null = null;

/** Mount the bar; `jump` answers every jump with `outcome`. */
function mount(
  props: {
    activeFile: OpenFile | undefined;
    canJump?: boolean;
    cursorMs?: number | null;
    canChooseZone?: boolean;
    chosenZone?: string | null;
  },
  outcome: TimeJumpOutcome = { kind: 'found', line: 1 },
) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const jump = vi.fn(async (_query: TimeQuery) => outcome);
  bar = new TimelineBar({
    target,
    props: { canJump: true, cursorMs: null, ...props, jump },
  });
  return { target, jump };
}

/** The bar's slider, `TRACK_WIDTH` px wide (jsdom does no layout). */
function sliderOf(target: HTMLElement): HTMLElement {
  const slider = target.querySelector<HTMLElement>('[role="slider"]');
  if (!slider) throw new Error('the bar has no slider');
  slider.getBoundingClientRect = () =>
    ({ left: 0, width: TRACK_WIDTH, top: 0, height: 20, right: TRACK_WIDTH }) as DOMRect;
  return slider;
}

async function pointer(element: HTMLElement, type: string, clientX: number) {
  element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX }));
  await tick();
}

async function keyDown(element: HTMLElement, init: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  element.dispatchEvent(event);
  await tick();
  return event;
}

/** Lets the jump's promise and the updates after it run. */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await tick();
}

afterEach(() => {
  bar?.$destroy();
  bar = null;
  document.body.replaceChildren();
});

describe('TimelineBar visibility', () => {
  const plain = openFile('/logs/plain.txt', {
    timeRange: { ...rangeOf('/logs/plain.txt', 0, 0), format: null, first_ms: null, last_ms: null },
  });

  it.each([
    ['a backend without time queries', { activeFile: middleware, canJump: false }],
    ['no open file', { activeFile: undefined }],
    ['a file without timestamps', { activeFile: plain }],
    ['a file whose range is not known and not being read', { activeFile: openFile('/a.log') }],
  ])('is hidden for %s', (_name, props) => {
    const { target } = mount(props);
    expect(target.innerHTML).toBe('');
  });

  it("shows a note alone while the file's range is being read", () => {
    const reading = openFile('/logs/a.log', { isReadingTimeRange: true });
    const { target } = mount({ activeFile: reading });

    expect(target.querySelector('[data-reading-range]')?.textContent?.trim()).toBe(
      'Reading the time range…',
    );
    expect(target.querySelector('[role="slider"]')).toBeNull();
    expect(target.querySelector('input')).toBeNull();
  });

  it('hides the bar when the range read shows a file without timestamps', async () => {
    const reading = openFile(plain.path, { isReadingTimeRange: true });
    const { target } = mount({ activeFile: reading });

    bar?.$set({ activeFile: plain });
    await tick();

    expect(target.innerHTML).toBe('');
  });

  it('shows the text box alone while no range is known', () => {
    const unknown = openFile('/logs/a.log.gz', {
      timeRange: { ...rangeOf('/logs/a.log.gz', 0, 0), first_ms: null, last_ms: null },
    });
    const { target } = mount({ activeFile: unknown });

    expect(target.querySelector('[role="slider"]')).toBeNull();
    expect(target.querySelector('input[aria-label="Go to time"]')).not.toBeNull();
  });
});

describe('TimelineBar axis', () => {
  it("spans the active file's range on every switch, and a click at either end jumps inside it", async () => {
    const { target, jump } = mount({ activeFile: middleware });

    for (const [i, file] of [middleware, postgresql, middleware].entries()) {
      if (i > 0) {
        bar?.$set({ activeFile: file });
        await tick();
      }
      const slider = sliderOf(target);
      const range = file.timeRange!;

      expect(slider.getAttribute('aria-valuemin')).toBe(String(range.first_ms));
      expect(slider.getAttribute('aria-valuemax')).toBe(String(range.last_ms));
      await pointer(slider, 'pointerdown', 0);
      await pointer(slider, 'pointerup', 0);
      await settle();
      expect(jump).toHaveBeenLastCalledWith(range.first_ms);
      await pointer(slider, 'pointerdown', TRACK_WIDTH);
      await pointer(slider, 'pointerup', TRACK_WIDTH);
      await settle();
      expect(jump).toHaveBeenLastCalledWith(range.last_ms);
    }
  });

  it("draws one band across the axis and labels its ends in the file's layout", () => {
    const { target } = mount({ activeFile: postgresql });

    const bands = [...target.querySelectorAll<HTMLElement>('[data-band]')];
    expect(bands.map((b) => [b.title, b.style.left, b.style.width])).toEqual([
      ['/logs/postgresql.log', '0px', '100%'],
    ]);
    expect(target.textContent).toContain('2025-12-10 07:30:00.000');
    expect(target.textContent).toContain('2025-12-10 09:00:00.000');
  });

  it('forgets a time picked with the keys in the file shown before', async () => {
    const { target, jump } = mount({ activeFile: middleware });
    await keyDown(sliderOf(target), { key: 'End' });

    bar?.$set({ activeFile: postgresql });
    await tick();
    await keyDown(sliderOf(target), { key: 'Enter' });

    expect(jump).not.toHaveBeenCalled();
    expect(sliderOf(target).getAttribute('aria-valuenow')).toBe(
      String(postgresql.timeRange!.first_ms),
    );
  });

  it('draws a zero-width axis as one point with its label, and does not scrub', async () => {
    const point = openFile('/logs/one.log', {
      timeRange: rangeOf('/logs/one.log', HOUR_START, HOUR_START),
    });
    const { target, jump } = mount({ activeFile: point });
    const slider = sliderOf(target);

    expect(slider.getAttribute('aria-disabled')).toBe('true');
    expect(target.textContent).toContain('2025-12-10 07:00:00.000');
    await pointer(slider, 'pointerdown', 50);
    await pointer(slider, 'pointerup', 50);
    await keyDown(slider, { key: 'End' });
    await keyDown(slider, { key: 'Enter' });
    expect(jump).not.toHaveBeenCalled();
  });
});

describe('TimelineBar thumb', () => {
  it("sits at the anchor line's time, from the nearest earlier timestamped line", () => {
    const active = {
      ...middleware,
      lines: stampedLines(100, [HOUR_START + HOUR / 4, null, null]),
      anchorLine: 102,
    };
    const { target } = mount({ activeFile: active });

    const thumb = target.querySelector<HTMLElement>('[data-thumb]');
    expect(thumb?.style.left).toBe('25%');
    expect(sliderOf(target).getAttribute('aria-valuetext')).toBe('2025-12-10 07:15:00.000');
  });

  it('is hidden when no line up to the anchor has a time', () => {
    const active = { ...middleware, lines: stampedLines(1, [null, null]), anchorLine: 2 };
    const { target } = mount({ activeFile: active });

    expect(target.querySelector('[data-thumb]')).toBeNull();
  });

  it('follows the anchor into a new window', async () => {
    const first = { ...middleware, lines: stampedLines(1, [HOUR_START]), anchorLine: 1 };
    const { target } = mount({ activeFile: first });

    const next = {
      ...middleware,
      lines: stampedLines(5000, [null, HOUR_START + HOUR / 2]),
      anchorLine: 5001,
    };
    bar?.$set({ activeFile: next });
    await tick();

    expect(target.querySelector<HTMLElement>('[data-thumb]')?.style.left).toBe('50%');
  });
});

describe('TimelineBar scrubbing', () => {
  it('shows the time under the pointer and jumps once, on release', async () => {
    const { target, jump } = mount({ activeFile: middleware });
    const slider = sliderOf(target);

    await pointer(slider, 'pointermove', 50);
    expect(target.querySelector('[data-pointer-label]')?.textContent?.trim()).toBe(
      '2025-12-10 07:15:00.000',
    );

    await pointer(slider, 'pointerdown', 50);
    await pointer(slider, 'pointermove', 80);
    await pointer(slider, 'pointermove', 100);
    expect(target.querySelector('[data-pointer-label]')?.textContent?.trim()).toBe(
      '2025-12-10 07:30:00.000',
    );
    expect(jump).not.toHaveBeenCalled();

    await pointer(slider, 'pointerup', 100);
    expect(jump).toHaveBeenCalledTimes(1);
    expect(jump).toHaveBeenCalledWith(HOUR_START + HOUR / 2);
  });

  it('jumps to the time of a click on the axis', async () => {
    const { target, jump } = mount({ activeFile: middleware });
    const slider = sliderOf(target);

    await pointer(slider, 'pointerdown', 150);
    await pointer(slider, 'pointerup', 150);

    expect(jump).toHaveBeenCalledWith(HOUR_START + (3 * HOUR) / 4);
  });
});

describe('TimelineBar keyboard', () => {
  const at = (ms: number) => ({
    ...middleware,
    lines: stampedLines(1, [ms]),
    anchorLine: 1,
  });

  it('is a labelled slider over the axis', () => {
    const { target } = mount({ activeFile: at(HOUR_START) });
    const slider = sliderOf(target);

    expect(slider.tabIndex).toBe(0);
    expect(slider.getAttribute('aria-label')).toBe('Time in middleware.log');
    expect(slider.getAttribute('aria-valuemin')).toBe(String(HOUR_START));
    expect(slider.getAttribute('aria-valuemax')).toBe(String(HOUR_START + HOUR));
    expect(slider.getAttribute('aria-valuenow')).toBe(String(HOUR_START));
  });

  it.each([
    [{ key: 'ArrowRight' }, HOUR_START + 18_000, '2025-12-10 07:00:18.000'],
    [{ key: 'ArrowRight', shiftKey: true }, HOUR_START + 180_000, '2025-12-10 07:03:00.000'],
    [{ key: 'End' }, HOUR_START + HOUR, '2025-12-10 08:00:00.000'],
  ])('moves with %o and jumps on Enter', async (init, expected, label) => {
    const { target, jump } = mount({ activeFile: at(HOUR_START) });
    const slider = sliderOf(target);

    const step = await keyDown(slider, init);
    expect(step.defaultPrevented).toBe(true);
    expect(slider.getAttribute('aria-valuetext')).toBe(label);
    expect(jump).not.toHaveBeenCalled();

    await keyDown(slider, { key: 'Enter' });
    expect(jump).toHaveBeenCalledWith(expected);
  });

  it('steps back from the thumb and goes to the start with Home', async () => {
    const { target, jump } = mount({ activeFile: at(HOUR_START + HOUR / 2) });
    const slider = sliderOf(target);

    await keyDown(slider, { key: 'ArrowLeft' });
    expect(slider.getAttribute('aria-valuenow')).toBe(String(HOUR_START + HOUR / 2 - 18_000));
    await keyDown(slider, { key: 'Home' });
    await keyDown(slider, { key: 'Enter' });
    expect(jump).toHaveBeenCalledWith(HOUR_START);
  });

  it('puts the time back on Escape and leaves other keys alone', async () => {
    const { target, jump } = mount({ activeFile: at(HOUR_START) });
    const slider = sliderOf(target);

    await keyDown(slider, { key: 'ArrowRight' });
    await keyDown(slider, { key: 'Escape' });
    expect(slider.getAttribute('aria-valuenow')).toBe(String(HOUR_START));
    expect((await keyDown(slider, { key: 'a' })).defaultPrevented).toBe(false);
    await keyDown(slider, { key: 'Enter' });
    expect(jump).not.toHaveBeenCalled();
  });
});

describe('TimelineBar text box', () => {
  async function typeAndEnter(target: HTMLElement, value: string) {
    const input = target.querySelector<HTMLInputElement>('input[aria-label="Go to time"]');
    if (!input) throw new Error('no text box');
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    const event = await keyDown(input, { key: 'Enter' });
    await settle();
    return { input, event };
  }

  it('sends the typed value as typed', async () => {
    const { target, jump } = mount({ activeFile: middleware });

    const { event } = await typeAndEnter(target, '2025-12-10 07:45:12.345');

    expect(event.defaultPrevented).toBe(true);
    expect(jump).toHaveBeenCalledWith('2025-12-10 07:45:12.345');
    expect(target.querySelector('[role="alert"]')).toBeNull();
  });

  it("shows the backend's message under the box, until the value changes", async () => {
    const message = 'cannot read "07:61" as a time';
    const { target } = mount({ activeFile: middleware }, { kind: 'refused', message });

    const { input } = await typeAndEnter(target, '07:61');

    const alert = target.querySelector('[role="alert"]');
    expect(alert?.textContent?.trim()).toBe(message);
    expect(input.getAttribute('aria-describedby')).toBe(alert?.id);

    input.value = '07:31';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    expect(target.querySelector('[role="alert"]')).toBeNull();
  });

  it("drops the backend's message when another file is shown", async () => {
    const message = 'cannot read "07:61" as a time';
    const { target } = mount({ activeFile: middleware }, { kind: 'refused', message });
    await typeAndEnter(target, '07:61');

    bar?.$set({ activeFile: postgresql });
    await tick();

    expect(target.querySelector('[role="alert"]')).toBeNull();
  });

  it('sends nothing for an empty box', async () => {
    const { target, jump } = mount({ activeFile: middleware });

    await typeAndEnter(target, '');

    expect(jump).not.toHaveBeenCalled();
  });
});

describe('TimelineBar while the line index is built', () => {
  const building = (file: OpenFile) => ({
    ...file,
    lines: stampedLines(1, [HOUR_START]),
    anchorLine: 1,
    pendingIndex: 'building' as const,
  });

  it('shows the axis but neither scrubs nor jumps, and says why', async () => {
    const { target, jump } = mount({ activeFile: building(middleware) });
    const slider = sliderOf(target);

    expect(slider.getAttribute('aria-disabled')).toBe('true');
    expect(slider.title).toBe('The line index of middleware.log is being built');
    await pointer(slider, 'pointerdown', TRACK_WIDTH / 2);
    await pointer(slider, 'pointerup', TRACK_WIDTH / 2);
    await keyDown(slider, { key: 'End' });
    await keyDown(slider, { key: 'Enter' });
    await settle();

    expect(jump).not.toHaveBeenCalled();
  });

  it('disables the Go to time box with the reason', async () => {
    const { target, jump } = mount({ activeFile: building(middleware) });
    const input = target.querySelector<HTMLInputElement>('input[aria-label="Go to time"]');

    expect(input?.disabled).toBe(true);
    expect(input?.title).toBe('The line index of middleware.log is being built');
    input!.value = '07:30';
    input!.dispatchEvent(new Event('input', { bubbles: true }));
    await keyDown(input!, { key: 'Enter' });
    expect(jump).not.toHaveBeenCalled();
  });

  it('says the index is being built where a compressed file has no range yet', () => {
    const unknown = openFile('/logs/core.log.gz', {
      timeRange: { ...rangeOf('/logs/core.log.gz', 0, 0), first_ms: null, last_ms: null },
      pendingIndex: 'building',
    });
    const { target } = mount({ activeFile: unknown });

    expect(target.querySelector('[data-index-pending]')?.textContent?.trim()).toBe(
      'The line index of core.log.gz is being built',
    );
  });

  it('enables the axis and the box once the index is there', async () => {
    const { target, jump } = mount({ activeFile: building(middleware) });

    bar?.$set({ activeFile: { ...building(middleware), pendingIndex: null } });
    await tick();
    const slider = sliderOf(target);
    await pointer(slider, 'pointerdown', 0);
    await pointer(slider, 'pointerup', 0);
    await settle();

    expect(slider.getAttribute('aria-disabled')).toBe('false');
    expect(target.querySelector<HTMLInputElement>('input')?.disabled).toBe(false);
    expect(jump).toHaveBeenCalledWith(HOUR_START);
  });

  it('says the index could not be built after a failed build', () => {
    const { target } = mount({ activeFile: { ...building(middleware), pendingIndex: 'failed' } });

    expect(sliderOf(target).title).toBe('The line index of middleware.log could not be built');
  });
});

describe('TimelineBar time cursor', () => {
  it("marks a cursor inside the file's range, apart from the thumb", () => {
    const active = {
      ...middleware,
      lines: stampedLines(100, [HOUR_START + HOUR / 4]),
      anchorLine: 100,
    };
    const { target } = mount({ activeFile: active, cursorMs: HOUR_START + HOUR / 2 });

    expect(target.querySelector<HTMLElement>('[data-cursor]')?.style.left).toBe('50%');
    expect(target.querySelector<HTMLElement>('[data-thumb]')?.style.left).toBe('25%');
  });

  it.each([
    ['at the first time', HOUR_START, '0%'],
    ['at the last time', HOUR_START + HOUR, '100%'],
  ])('marks a cursor %s', (_name, cursorMs, left) => {
    const { target } = mount({ activeFile: middleware, cursorMs });

    expect(target.querySelector<HTMLElement>('[data-cursor]')?.style.left).toBe(left);
  });

  it("marks nothing for a cursor outside the file's range, and marks it again inside the next file's", async () => {
    const { target } = mount({ activeFile: middleware, cursorMs: HOUR_START + 1.25 * HOUR });
    expect(target.querySelector('[data-cursor]')).toBeNull();

    bar?.$set({ activeFile: postgresql });
    await tick();

    expect(target.querySelector<HTMLElement>('[data-cursor]')?.style.left).toBe('50%');
  });

  it('marks nothing while no cursor is set', () => {
    const { target } = mount({ activeFile: middleware });

    expect(target.querySelector('[data-cursor]')).toBeNull();
  });
});

describe('TimelineBar time zone', () => {
  const zoneButton = (target: HTMLElement) =>
    target.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]');

  it("shows the file's zone before the axis on a backend that lists file_tz", () => {
    const { target } = mount({ activeFile: middleware, canChooseZone: true });

    const button = zoneButton(target);
    expect(button?.textContent?.trim()).toBe('UTC');
    const slider = target.querySelector('[role="slider"]')!;
    expect(button!.compareDocumentPosition(slider) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('marks the zone chosen for the file', () => {
    const berlin = openFile('/logs/middleware.log', {
      timeRange: { ...middleware.timeRange!, display_zone: 'Europe/Berlin' },
    });
    const { target } = mount({
      activeFile: berlin,
      canChooseZone: true,
      chosenZone: 'Europe/Berlin',
    });

    expect(zoneButton(target)?.dataset.chosen).toBe('true');
    expect(zoneButton(target)?.textContent?.trim()).toBe('Europe/Berlin');
  });

  it('shows no zone on a backend without file_tz', () => {
    const { target } = mount({ activeFile: middleware });

    expect(target.querySelector('[role="slider"]')).not.toBeNull();
    expect(zoneButton(target)).toBeNull();
  });

  it("shows the zone while the file's range is not known, so a chosen zone can be reset", () => {
    const unknown = openFile('/logs/app.log.gz', {
      timeRange: { ...middleware.timeRange!, first_ms: null, last_ms: null, source: 'none' },
    });
    const { target } = mount({ activeFile: unknown, canChooseZone: true, chosenZone: 'UTC' });

    expect(zoneButton(target)).not.toBeNull();
  });
});

describe('TimelineBar on a log chain', () => {
  /**
   * agent.log.3.gz 00:00–00:54, agent.log.2 missing, agent.log.1
   * 01:00–02:00, no lines to agent.log at 05:00–06:00.
   */
  const ready = chainDescription({
    parts: [
      chainPart('agent.log.3.gz', {
        key: '3',
        first_ms: CHAIN_T0,
        max_ms: CHAIN_T0 + 0.9 * HOUR_MS,
      }),
      chainPart('agent.log.1', {
        key: '1',
        first_ms: CHAIN_T0 + HOUR_MS,
        max_ms: CHAIN_T0 + 2 * HOUR_MS,
      }),
      chainPart('agent.log', { is_active: true, first_ms: CHAIN_T0 + 5 * HOUR_MS }),
    ],
    missing: ['agent.log.2'],
    missing_count: 1,
    gaps: [
      {
        after: 'agent.log.1',
        before: 'agent.log',
        from_ms: CHAIN_T0 + 2 * HOUR_MS,
        to_ms: CHAIN_T0 + 5 * HOUR_MS,
      },
    ],
    last_ms: CHAIN_T0 + 6 * HOUR_MS,
  });
  const pending = chainDescription({ ...ready, state: 'pending', first_ms: null, last_ms: null });

  function chainFile(description: ChainResponse | null, fields: Partial<OpenFile> = {}) {
    return openFile('chain:/l/agent.log', {
      name: 'agent.log',
      chain: chainTabOf(description),
      ...fields,
    });
  }

  const titles = (target: HTMLElement, selector: string) =>
    [...target.querySelectorAll<HTMLElement>(selector)].map((element) => element.title);
  const leftOf = (target: HTMLElement, selector: string) =>
    [...target.querySelectorAll<HTMLElement>(selector)].map((e) => parseFloat(e.style.left));

  it("spans the chain from its first to its last time, labelled in its first part's layout", () => {
    const { target } = mount({ activeFile: chainFile(ready) });
    const slider = sliderOf(target);

    expect(slider.getAttribute('aria-valuemin')).toBe(String(CHAIN_T0));
    expect(slider.getAttribute('aria-valuemax')).toBe(String(CHAIN_T0 + 6 * HOUR_MS));
    expect(slider.getAttribute('aria-disabled')).toBe('false');
    expect(target.textContent).toContain('2026-10-01 00:00:00.000');
    expect(target.textContent).toContain('2026-10-01 06:00:00.000');
  });

  it("ticks each part edge with the part's name, shades the gap and marks the missing part", () => {
    const { target } = mount({ activeFile: chainFile(ready) });

    expect(titles(target, '[data-part-edge]')).toEqual([
      'agent.log.1 from 2026-10-01 01:00:00.000',
      'agent.log from 2026-10-01 05:00:00.000',
    ]);
    expect(leftOf(target, '[data-part-edge]').map((left) => Math.round(left * 100))).toEqual([
      1667, 8333,
    ]);
    const [gap] = target.querySelectorAll<HTMLElement>('[data-gap]');
    expect(gap.title).toBe('No lines from 2026-10-01 02:00:00.000 to 2026-10-01 05:00:00.000');
    expect(parseFloat(gap.style.left)).toBeCloseTo(100 / 3);
    expect(parseFloat(gap.style.width)).toBeCloseTo(50);
    expect(titles(target, '[data-missing-part]')).toEqual(['Missing: agent.log.2']);
    expect(leftOf(target, '[data-missing-part]')[0]).toBeCloseTo((0.95 / 6) * 100);
  });

  it('names the part of the time under the thumb in the value it reads out', () => {
    const lines = stampedLines(3, [CHAIN_T0 + 1.5 * HOUR_MS]);
    const { target } = mount({ activeFile: chainFile(ready, { lines, anchorLine: 3 }) });

    expect(sliderOf(target).getAttribute('aria-valuetext')).toBe(
      '2026-10-01 01:30:00.000, in agent.log.1',
    );
  });

  it('says why it does not jump while the chain is pending, and jumps once it is ready', async () => {
    const { target, jump } = mount({ activeFile: chainFile(pending) });
    const reason = 'agent.log is not ready: the line indexes of its parts are being built';

    expect(target.querySelector('[role="slider"]')).toBeNull();
    expect(target.querySelector('[data-index-pending]')?.textContent?.trim()).toBe(reason);
    const input = target.querySelector<HTMLInputElement>('input[aria-label="Go to time"]');
    expect(input?.disabled).toBe(true);
    expect(input?.title).toBe(reason);

    bar?.$set({ activeFile: chainFile(ready) });
    await tick();
    const slider = sliderOf(target);
    await pointer(slider, 'pointerdown', 0);
    await pointer(slider, 'pointerup', 0);
    await settle();

    expect(slider.getAttribute('aria-disabled')).toBe('false');
    expect(target.querySelector<HTMLInputElement>('input')?.disabled).toBe(false);
    expect(jump).toHaveBeenCalledWith(CHAIN_T0);
  });

  it('says why an invalid chain does not jump', () => {
    const invalid = chainDescription({
      ...pending,
      state: 'invalid',
      reasons: [{ code: 'overlap', message: 'overlap', overlap_ms: 5000, parts: [] }],
    });
    const { target } = mount({ activeFile: chainFile(invalid) });

    expect(target.querySelector('[data-index-pending]')?.textContent?.trim()).toBe(
      'agent.log is not a valid log chain: overlap',
    );
  });

  it('says the chain is being read before its first description', () => {
    const { target } = mount({ activeFile: chainFile(null) });

    expect(target.querySelector('[data-reading-range]')).not.toBeNull();
  });

  it('names the end of a ready chain whose last time is not known', () => {
    const { target } = mount({ activeFile: chainFile({ ...ready, last_ms: null }) });

    expect(target.textContent).toContain('The last time of agent.log is not known');
  });

  it('shows the zone the chain is read in, and marks the zone chosen for it', async () => {
    const zoneButton = () =>
      target.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]');
    const { target } = mount({ activeFile: chainFile(ready), canChooseZone: true });
    expect(zoneButton()?.textContent?.trim()).toBe('UTC');

    const inZone = {
      ...ready,
      parts: ready.parts.map((part) => ({
        ...part,
        time_format: { ...ISO_FORMAT, assumed_zone: '+02:00' },
      })),
    };
    bar?.$set({ activeFile: chainFile(inZone), chosenZone: '+02:00' });
    await tick();

    expect(zoneButton()?.dataset.chosen).toBe('true');
    expect(zoneButton()?.textContent?.trim()).toBe('+02:00');
    expect(target.textContent).toContain('2026-10-01 02:00:00.000');
  });
});
