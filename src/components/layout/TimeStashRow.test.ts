// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { tick } from 'svelte';
import type { OpenFile, TimeRangeResponse } from '$lib/types';
import type { TimeJumpOutcome } from '$lib/stores/files';
import { notifications } from '$lib/stores/notifications';
import { CHAIN_T0, HOUR_MS, chainDescription, chainTabOf } from '$lib/testing/chainDescription';
import TimeStashRow from './TimeStashRow.svelte';

const MINUTE = 60_000;
/** middleware.log's first and last times: 2025-12-10 07:00:04.574 and 08:00:04.390 UTC. */
const FIRST_MS = Date.UTC(2025, 11, 10, 7, 0, 4, 574);
const LAST_MS = Date.UTC(2025, 11, 10, 8, 0, 4, 390);
const INSIDE = Date.UTC(2025, 11, 10, 7, 30);
/** A moment on the day before, outside middleware.log. */
const DAY_BEFORE = INSIDE - 24 * 60 * MINUTE;

function rangeOf(path: string, first: number | null, last: number | null): TimeRangeResponse {
  const hasTimes = first !== null;
  return {
    path,
    format: hasTimes ? 'iso' : null,
    has_zone: false,
    day_first: null,
    display_zone: 'UTC',
    example: hasTimes ? '2025-12-10 07:00:04.574' : null,
    first_ms: first,
    last_ms: last,
    source: 'scan',
    cli_command: `rx time-range ${path}`,
  };
}

/** An open file with only the fields the row reads filled in. */
function fileWith(path: string, timeRange: TimeRangeResponse | null): OpenFile {
  return { path, name: path.split('/').pop() ?? path, timeRange } as OpenFile;
}

const middleware = fileWith(
  '/logs/middleware.log',
  rangeOf('/logs/middleware.log', FIRST_MS, LAST_MS),
);
const previousDay = fileWith(
  '/logs/SOMELOG.log',
  rangeOf('/logs/SOMELOG.log', DAY_BEFORE - MINUTE, DAY_BEFORE + MINUTE),
);
const plain = fileWith('/logs/logs_stat.txt', rangeOf('/logs/logs_stat.txt', null, null));

let row: TimeStashRow | null = null;

function mount(props: {
  stash: readonly number[];
  activeFile: OpenFile | undefined;
  canJump?: boolean;
  outcome?: TimeJumpOutcome;
}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const jump = vi.fn(async () => props.outcome ?? ({ kind: 'found', line: 1 } as const));
  const remove = vi.fn();
  row = new TimeStashRow({
    target,
    props: {
      stash: props.stash,
      activeFile: props.activeFile,
      canJump: props.canJump ?? true,
      jump,
      remove,
    },
  });
  const entries = () => [...target.querySelectorAll<HTMLElement>('[data-stash-entry]')];
  const button = (i: number, attribute: string) => {
    const found = entries()[i]?.querySelector<HTMLButtonElement>(`button[${attribute}]`);
    if (!found) throw new Error(`entry ${i} has no button[${attribute}]`);
    return found;
  };
  return {
    target,
    jump,
    remove,
    entries,
    goButton: (i: number) => button(i, 'data-go'),
    removeButton: (i: number) => button(i, 'data-remove'),
  };
}

afterEach(() => {
  row?.$destroy();
  row = null;
  document.body.replaceChildren();
  for (const n of get(notifications)) notifications.dismiss(n.id);
});

describe('TimeStashRow', () => {
  it('shows the hint while the stash is empty', () => {
    const { target, entries } = mount({ stash: [], activeFile: middleware });

    expect(entries()).toHaveLength(0);
    expect(target.textContent).toContain('+ on the cursor saves a moment here');
  });

  it('writes each entry the way the active file writes a time, and in ISO UTC for a file without timestamps', async () => {
    const { entries } = mount({ stash: [INSIDE], activeFile: middleware });
    expect(entries()[0].textContent).toContain('2025-12-10 07:30:00.000');

    row?.$set({ activeFile: plain });
    await tick();
    expect(entries()[0].textContent).toContain('2025-12-10T07:30:00.000Z');
  });

  it('enables the entries inside the active file, its first and last times included, and disables the rest with the reason', () => {
    const { goButton, entries } = mount({
      stash: [DAY_BEFORE, FIRST_MS, INSIDE, LAST_MS, LAST_MS + 1],
      activeFile: middleware,
    });

    expect([0, 1, 2, 3, 4].map((i) => goButton(i).disabled)).toEqual([
      true,
      false,
      false,
      false,
      true,
    ]);
    expect(entries()[0].title).toBe('Before the first time in middleware.log');
    expect(entries()[4].title).toBe('After the last time in middleware.log');
  });

  it('follows the active file: another day, a file without timestamps, a range not known yet', async () => {
    const { goButton, entries } = mount({ stash: [DAY_BEFORE, INSIDE], activeFile: previousDay });
    expect([goButton(0).disabled, goButton(1).disabled]).toEqual([false, true]);

    row?.$set({ activeFile: plain });
    await tick();
    expect([goButton(0).disabled, goButton(1).disabled]).toEqual([true, true]);
    expect(entries()[0].title).toBe('logs_stat.txt has no timestamps');

    row?.$set({ activeFile: fileWith('/logs/new.log', null) });
    await tick();
    expect(goButton(1).disabled).toBe(true);
    expect(entries()[1].title).toBe('The time range of new.log is not known yet');
  });

  it('jumps the active file to an enabled entry once, and not to a disabled one', async () => {
    const { goButton, jump } = mount({ stash: [DAY_BEFORE, INSIDE], activeFile: middleware });

    goButton(1).click();
    goButton(0).click();
    await tick();

    expect(jump).toHaveBeenCalledExactlyOnceWith(INSIDE);
  });

  it('removes an entry with its ×, enabled or not', () => {
    const { removeButton, remove } = mount({ stash: [DAY_BEFORE, INSIDE], activeFile: middleware });

    removeButton(0).click();
    removeButton(1).click();

    expect(remove.mock.calls).toEqual([[DAY_BEFORE], [INSIDE]]);
  });

  it('labels the controls with the time they act on', () => {
    const { goButton, removeButton } = mount({ stash: [INSIDE], activeFile: middleware });

    expect(goButton(0).getAttribute('aria-label')).toBe('Go to 2025-12-10 07:30:00.000');
    expect(removeButton(0).getAttribute('aria-label')).toBe(
      'Remove 2025-12-10 07:30:00.000 from the stash',
    );
  });

  it('says so when the backend refuses the jump', async () => {
    const { goButton, jump } = mount({
      stash: [INSIDE],
      activeFile: middleware,
      outcome: { kind: 'refused', message: 'no route' },
    });

    goButton(0).click();
    await vi.waitFor(() => expect(jump).toHaveBeenCalled());
    await tick();

    expect(get(notifications).map((n) => n.message)).toEqual([
      'Cannot go to 2025-12-10 07:30:00.000 in middleware.log: no route',
    ]);
  });
});

describe('TimeStashRow on a log chain', () => {
  const chainTab = (state: 'ready' | 'pending') =>
    ({
      path: 'chain:/l/agent.log',
      name: 'agent.log',
      timeRange: null,
      pendingIndex: null,
      chain: chainTabOf(
        chainDescription(state === 'ready' ? {} : { state, first_ms: null, last_ms: null }),
      ),
    }) as OpenFile;
  const insideChain = CHAIN_T0 + HOUR_MS;
  const afterChain = CHAIN_T0 + 3 * HOUR_MS;

  it("jumps the chain's tab to an entry inside its range, and disables one outside it", async () => {
    const { entries, goButton, jump } = mount({
      stash: [insideChain, afterChain],
      activeFile: chainTab('ready'),
    });

    expect(entries()[0].textContent).toContain('2026-10-01 01:00:00.000');
    expect(goButton(0).disabled).toBe(false);
    expect(goButton(1).disabled).toBe(true);
    expect(entries()[1].title).toBe('After the last time in agent.log');
    goButton(0).click();
    await tick();
    expect(jump).toHaveBeenCalledWith(insideChain);
  });

  it('disables every entry while the chain is pending, saying why', () => {
    const { entries, goButton } = mount({ stash: [insideChain], activeFile: chainTab('pending') });

    expect(goButton(0).disabled).toBe(true);
    expect(entries()[0].title).toBe(
      'agent.log is not ready: the line indexes of its parts are being built',
    );
  });
});
