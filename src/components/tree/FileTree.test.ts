// @vitest-environment jsdom
import '$lib/testing/matchMediaStub';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { get } from 'svelte/store';
import { health, tree } from '$lib/stores';
import { chainMode } from '$lib/stores/chainMode';
import { treeFocusRequested } from '$lib/stores/layout';
import { LOG_DIR, LOG_ROOT, LogDirBackend, serveLogDir } from '$lib/testing/fakeLogDir';
import FileTree from './FileTree.svelte';

let mounted: FileTree | null = null;

async function mount(features: string[], backend = new LogDirBackend({ features })) {
  serveLogDir(backend);
  await health.check();
  const target = document.createElement('div');
  document.body.appendChild(target);
  mounted = new FileTree({ target });
  await tick();
  return {
    target,
    toggle: () => target.querySelector<HTMLInputElement>('input[role="switch"]'),
  };
}

/** The tree row of `path`. */
function rowOf(target: HTMLElement, path: string): HTMLElement | undefined {
  const name = path.split('/').pop();
  return [...target.querySelectorAll<HTMLElement>('[role="treeitem"]')].find((row) =>
    row.textContent?.includes(name ?? ''),
  );
}

/** Let the reactive focus request run, then the tick it waits for. */
async function settle() {
  await tick();
  await tick();
}

afterEach(() => {
  mounted?.$destroy();
  mounted = null;
  chainMode.set(false);
  tree.selectPath(null);
  treeFocusRequested.set(false);
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('the chain mode switch of the files panel', () => {
  it('is not shown while the backend serves no log chains', async () => {
    const { toggle } = await mount([]);

    expect(toggle()).toBeNull();
  });

  it('is a labelled switch, off by default', async () => {
    const { toggle } = await mount(['log_chains']);

    const input = toggle();
    expect(input?.labels?.[0]?.textContent?.trim()).toBe('Group rotated logs');
    expect(input?.checked).toBe(false);
    expect(input?.getAttribute('aria-checked')).toBe('false');
  });

  it('turns chain mode on and off', async () => {
    const { toggle } = await mount(['log_chains']);

    toggle()?.click();
    await tick();
    expect(get(chainMode)).toBe(true);
    expect(toggle()?.checked).toBe(true);

    toggle()?.click();
    await tick();
    expect(get(chainMode)).toBe(false);
  });

  it('shows the mode a link set', async () => {
    const { toggle } = await mount(['log_chains']);

    chainMode.set(true);
    await tick();

    expect(toggle()?.checked).toBe(true);
    expect(toggle()?.getAttribute('aria-checked')).toBe('true');
  });
});

describe('the focus request of the files panel', () => {
  it('focuses the selected row and resets the request', async () => {
    const { target } = await mount([]);
    await tree.loadRoots();
    tree.selectPath(LOG_DIR);
    await tick();

    treeFocusRequested.set(true);
    await settle();

    expect(document.activeElement).toBe(rowOf(target, LOG_DIR));
    expect(rowOf(target, LOG_DIR)?.getAttribute('aria-selected')).toBe('true');
    expect(get(treeFocusRequested)).toBe(false);
  });

  it('focuses the first row when no row is selected', async () => {
    const { target } = await mount([]);
    await tree.loadRoots();
    await tick();

    treeFocusRequested.set(true);
    await settle();

    expect(document.activeElement).toBe(target.querySelector('[role="treeitem"]'));
    expect(document.activeElement).toBe(rowOf(target, LOG_ROOT));
  });

  it('waits for the roots when the request comes while they load', async () => {
    const backend = new LogDirBackend({ features: [] });
    backend.hold('/v1/tree');
    const { target } = await mount([], backend);
    const loading = tree.loadRoots();
    await tick();

    treeFocusRequested.set(true);
    await settle();
    expect(get(treeFocusRequested)).toBe(true);

    backend.release();
    await loading;
    await settle();

    expect(document.activeElement).toBe(rowOf(target, LOG_ROOT));
    expect(get(treeFocusRequested)).toBe(false);
  });
});
