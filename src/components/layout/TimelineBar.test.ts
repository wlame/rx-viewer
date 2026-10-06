// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import type { FileLine, OpenFile, TimeRangeResponse } from '$lib/types';
import type { TimeJumpOutcome, TimeQuery } from '$lib/stores/files';
import type { TimeCursor } from '$lib/utils/timeCursor';
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
    timeRange: null,
    timeJump: null,
    cursorVersion: 0,
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
    openFiles: OpenFile[];
    activeFile?: OpenFile;
    canJump?: boolean;
    cursor?: TimeCursor | null;
  },
  outcome: TimeJumpOutcome = { kind: 'found', line: 1 },
) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const jump = vi.fn(async (_query: TimeQuery) => outcome);
  const clearCursor = vi.fn();
  bar = new TimelineBar({
    target,
    props: {
      canJump: true,
      activeFile: props.openFiles[0],
      cursor: null,
      ...props,
      jump,
      clearCursor,
    },
  });
  const slider = target.querySelector<HTMLElement>('[role="slider"]');
  if (slider) {
    slider.getBoundingClientRect = () =>
      ({ left: 0, width: TRACK_WIDTH, top: 0, height: 20, right: TRACK_WIDTH }) as DOMRect;
  }
  return { target, slider, jump, clearCursor };
}

function sliderOf(target: HTMLElement): HTMLElement {
  const slider = target.querySelector<HTMLElement>('[role="slider"]');
  if (!slider) throw new Error('the bar has no slider');
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
  it('is hidden for a backend without time queries', () => {
    const { target } = mount({ openFiles: [middleware], canJump: false });
    expect(target.innerHTML).toBe('');
  });

  it('is hidden when no open file has timestamps', () => {
    const { target } = mount({ openFiles: [openFile('/logs/plain.txt')] });
    expect(target.innerHTML).toBe('');
  });

  it('shows the text box alone while no range is known', () => {
    const unknown = openFile('/logs/a.log.gz', {
      timeRange: { ...rangeOf('/logs/a.log.gz', 0, 0), first_ms: null, last_ms: null },
    });
    const { target } = mount({ openFiles: [unknown] });

    expect(target.querySelector('[role="slider"]')).toBeNull();
    expect(target.querySelector('input[aria-label="Go to time"]')).not.toBeNull();
  });
});

describe('TimelineBar axis', () => {
  it('draws a band per file, names it, and highlights the active one', () => {
    const { target } = mount({ openFiles: [middleware, postgresql], activeFile: postgresql });

    const bands = [...target.querySelectorAll<HTMLElement>('[data-band]')];
    expect(bands.map((b) => b.title)).toEqual(['/logs/middleware.log', '/logs/postgresql.log']);
    expect(bands.map((b) => b.dataset.active)).toEqual(['false', 'true']);
    expect(bands[1].style.left).toBe('25%');
    expect(bands[1].style.width).toBe('75%');
  });

  it("labels the axis ends in the active file's layout", () => {
    const { target } = mount({ openFiles: [middleware, postgresql] });

    expect(target.textContent).toContain('2025-12-10 07:00:00.000');
    expect(target.textContent).toContain('2025-12-10 09:00:00.000');
  });

  it('draws a zero-width axis as one point with its label, and does not scrub', async () => {
    const point = openFile('/logs/one.log', {
      timeRange: rangeOf('/logs/one.log', HOUR_START, HOUR_START),
    });
    const { target, jump } = mount({ openFiles: [point] });
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
    const { target } = mount({ openFiles: [active] });

    const thumb = target.querySelector<HTMLElement>('[data-thumb]');
    expect(thumb?.style.left).toBe('25%');
    expect(sliderOf(target).getAttribute('aria-valuetext')).toBe('2025-12-10 07:15:00.000');
  });

  it('is hidden when no line up to the anchor has a time', () => {
    const active = { ...middleware, lines: stampedLines(1, [null, null]), anchorLine: 2 };
    const { target } = mount({ openFiles: [active] });

    expect(target.querySelector('[data-thumb]')).toBeNull();
  });

  it('follows the anchor into a new window', async () => {
    const first = { ...middleware, lines: stampedLines(1, [HOUR_START]), anchorLine: 1 };
    const { target } = mount({ openFiles: [first] });

    const next = {
      ...middleware,
      lines: stampedLines(5000, [null, HOUR_START + HOUR / 2]),
      anchorLine: 5001,
    };
    bar?.$set({ openFiles: [next], activeFile: next });
    await tick();

    expect(target.querySelector<HTMLElement>('[data-thumb]')?.style.left).toBe('50%');
  });
});

describe('TimelineBar scrubbing', () => {
  it('shows the time under the pointer and jumps once, on release', async () => {
    const { target, jump } = mount({ openFiles: [middleware] });
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
    const { target, jump } = mount({ openFiles: [middleware] });
    const slider = sliderOf(target);

    await pointer(slider, 'pointerdown', 150);
    await pointer(slider, 'pointerup', 150);

    expect(jump).toHaveBeenCalledWith(HOUR_START + (3 * HOUR) / 4);
  });

  it('does not scrub a file without timestamps', async () => {
    const plain = openFile('/logs/plain.txt');
    const { target, jump } = mount({ openFiles: [middleware, plain], activeFile: plain });
    const slider = sliderOf(target);

    expect(slider.getAttribute('aria-disabled')).toBe('true');
    await pointer(slider, 'pointerdown', 150);
    await pointer(slider, 'pointerup', 150);
    expect(jump).not.toHaveBeenCalled();
  });
});

describe('TimelineBar keyboard', () => {
  const at = (ms: number) => ({
    ...middleware,
    lines: stampedLines(1, [ms]),
    anchorLine: 1,
  });

  it('is a labelled slider over the axis', () => {
    const { target } = mount({ openFiles: [at(HOUR_START)] });
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
    const { target, jump } = mount({ openFiles: [at(HOUR_START)] });
    const slider = sliderOf(target);

    const step = await keyDown(slider, init);
    expect(step.defaultPrevented).toBe(true);
    expect(slider.getAttribute('aria-valuetext')).toBe(label);
    expect(jump).not.toHaveBeenCalled();

    await keyDown(slider, { key: 'Enter' });
    expect(jump).toHaveBeenCalledWith(expected);
  });

  it('steps back from the thumb and goes to the start with Home', async () => {
    const { target, jump } = mount({ openFiles: [at(HOUR_START + HOUR / 2)] });
    const slider = sliderOf(target);

    await keyDown(slider, { key: 'ArrowLeft' });
    expect(slider.getAttribute('aria-valuenow')).toBe(String(HOUR_START + HOUR / 2 - 18_000));
    await keyDown(slider, { key: 'Home' });
    await keyDown(slider, { key: 'Enter' });
    expect(jump).toHaveBeenCalledWith(HOUR_START);
  });

  it('puts the time back on Escape and leaves other keys alone', async () => {
    const { target, jump } = mount({ openFiles: [at(HOUR_START)] });
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
    const { target, jump } = mount({ openFiles: [middleware] });

    const { event } = await typeAndEnter(target, '2025-12-10 07:45:12.345');

    expect(event.defaultPrevented).toBe(true);
    expect(jump).toHaveBeenCalledWith('2025-12-10 07:45:12.345');
    expect(target.querySelector('[role="alert"]')).toBeNull();
  });

  it("shows the backend's message under the box, until the value changes", async () => {
    const message = 'cannot read "07:61" as a time';
    const { target } = mount({ openFiles: [middleware] }, { kind: 'refused', message });

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
    const { target } = mount({ openFiles: [middleware, postgresql] }, { kind: 'refused', message });
    await typeAndEnter(target, '07:61');

    bar?.$set({ activeFile: postgresql });
    await tick();

    expect(target.querySelector('[role="alert"]')).toBeNull();
  });

  it('sends nothing for an empty box', async () => {
    const { target, jump } = mount({ openFiles: [middleware] });

    await typeAndEnter(target, '');

    expect(jump).not.toHaveBeenCalled();
  });
});

describe('TimelineBar time cursor', () => {
  const at = (ms: number): TimeCursor => ({ query: ms, version: 1, instantMs: ms });

  it('draws the cursor apart from the thumb, with its label and a button that clears it', async () => {
    const active = openFile(middleware.path, {
      timeRange: middleware.timeRange,
      lines: stampedLines(100, [HOUR_START + HOUR / 4]),
      anchorLine: 100,
    });
    const { target, clearCursor } = mount({
      openFiles: [active, postgresql],
      cursor: at(HOUR_START + HOUR),
    });

    const marker = target.querySelector<HTMLElement>('[data-cursor]');
    expect(marker?.style.left).toBe('50%');
    expect(target.querySelector<HTMLElement>('[data-thumb]')?.style.left).toBe('12.5%');
    expect(target.querySelector('[data-cursor-chip]')?.textContent).toContain(
      '2025-12-10 08:00:00.000',
    );

    const clear = target.querySelector<HTMLButtonElement>(
      'button[aria-label="Clear the time cursor"]',
    );
    clear?.click();
    expect(clearCursor).toHaveBeenCalledTimes(1);
  });

  it('labels a typed cursor with its text until a file finds its time', async () => {
    const { target } = mount({
      openFiles: [middleware],
      cursor: { query: '07:30', version: 1, instantMs: null },
    });

    expect(target.querySelector('[data-cursor-chip]')?.textContent).toContain('07:30');
    expect(target.querySelector('[data-cursor]')).toBeNull();

    bar?.$set({ cursor: { query: '07:30', version: 1, instantMs: HOUR_START + HOUR / 2 } });
    await tick();
    expect(target.querySelector('[data-cursor-chip]')?.textContent).toContain(
      '2025-12-10 07:30:00.000',
    );
    expect(target.querySelector<HTMLElement>('[data-cursor]')?.style.left).toBe('50%');
  });

  it('draws a cursor past the axis at its end, marked as outside', () => {
    const { target } = mount({ openFiles: [middleware], cursor: at(HOUR_START + 3 * HOUR) });

    const marker = target.querySelector<HTMLElement>('[data-cursor]');
    expect(marker?.style.left).toBe('100%');
    expect(marker?.dataset.outside).toBe('after');
    expect(target.querySelector('[data-cursor-chip]')?.getAttribute('title')).toContain(
      'after the last time of the open files',
    );
  });

  it('shows nothing of a cursor that is not set', () => {
    const { target } = mount({ openFiles: [middleware] });

    expect(target.querySelector('[data-cursor]')).toBeNull();
    expect(target.querySelector('[data-cursor-chip]')).toBeNull();
  });
});
