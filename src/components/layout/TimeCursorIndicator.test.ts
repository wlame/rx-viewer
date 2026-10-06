// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import type { OpenFile, TimeRangeResponse } from '$lib/types';
import TimeCursorIndicator from './TimeCursorIndicator.svelte';

/** 2025-12-10 07:30:00 UTC. */
const CURSOR = Date.UTC(2025, 11, 10, 7, 30, 0);

function rangeOf(path: string, format: string | null): TimeRangeResponse {
  return {
    path,
    format,
    has_zone: false,
    day_first: null,
    display_zone: 'UTC',
    example: format ? '2025-12-10 07:00:04.574' : null,
    first_ms: format ? Date.UTC(2025, 11, 10, 7, 0, 4, 574) : null,
    last_ms: format ? Date.UTC(2025, 11, 10, 8, 0, 4, 390) : null,
    source: 'scan',
    cli_command: `rx time-range ${path}`,
  };
}

/** An open file with only the fields the indicator reads filled in. */
function fileWith(path: string, timeRange: TimeRangeResponse | null): OpenFile {
  return { path, name: path.split('/').pop() ?? path, timeRange } as OpenFile;
}

const middleware = fileWith('/logs/middleware.log', rangeOf('/logs/middleware.log', 'iso'));
const plain = fileWith('/logs/logs_stat.txt', rangeOf('/logs/logs_stat.txt', null));

let indicator: TimeCursorIndicator | null = null;

function mount(props: {
  cursorMs: number | null;
  activeFile: OpenFile | undefined;
  canAdd?: boolean;
  addTitle?: string;
}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const addToStash = vi.fn();
  const clearCursor = vi.fn();
  indicator = new TimeCursorIndicator({
    target,
    props: {
      cursorMs: props.cursorMs,
      activeFile: props.activeFile,
      addToStash: props.canAdd === false ? null : addToStash,
      clearCursor,
      ...(props.addTitle === undefined ? {} : { addTitle: props.addTitle }),
    },
  });
  const button = (label: string) =>
    target.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  return {
    target,
    addToStash,
    clearCursor,
    add: () => button('Add the time cursor to the stash'),
    clear: () => button('Clear the time cursor'),
    label: () => target.querySelector('[data-time-cursor-label]')?.textContent,
  };
}

afterEach(() => {
  indicator?.$destroy();
  indicator = null;
  document.body.replaceChildren();
});

describe('TimeCursorIndicator', () => {
  it('shows nothing while no cursor is set', () => {
    const { target } = mount({ cursorMs: null, activeFile: middleware });

    expect(target.innerHTML).toBe('');
  });

  it('writes the cursor the way the active file writes a time, and in ISO UTC for a file without timestamps', async () => {
    const { label } = mount({ cursorMs: CURSOR, activeFile: middleware });
    expect(label()).toBe('2025-12-10 07:30:00.000');

    indicator?.$set({ activeFile: plain });
    await tick();
    expect(label()).toBe('2025-12-10T07:30:00.000Z');

    indicator?.$set({ activeFile: fileWith('/logs/new.log', null) });
    await tick();
    expect(label()).toBe('2025-12-10T07:30:00.000Z');
  });

  it('adds the cursor to the stash with + and clears it with ×', () => {
    const { add, clear, addToStash, clearCursor } = mount({
      cursorMs: CURSOR,
      activeFile: middleware,
    });

    add()?.click();
    clear()?.click();

    expect(addToStash).toHaveBeenCalledExactlyOnceWith(CURSOR);
    expect(clearCursor).toHaveBeenCalledTimes(1);
  });

  it('disables + while there is nothing to add', () => {
    const { add, addToStash } = mount({ cursorMs: CURSOR, activeFile: middleware, canAdd: false });

    expect(add()?.disabled).toBe(true);
    add()?.click();
    expect(addToStash).not.toHaveBeenCalled();
  });

  it('says why + is disabled in its tooltip, and what it does otherwise', async () => {
    const { add } = mount({ cursorMs: CURSOR, activeFile: middleware });
    expect(add()?.title).toBe('Add the time cursor to the stash');

    indicator?.$set({ addToStash: null, addTitle: 'The stash holds this time already' });
    await tick();

    expect(add()?.title).toBe('The stash holds this time already');
  });
});
