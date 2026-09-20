// @vitest-environment jsdom
import '$lib/testing/matchMediaStub';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tree } from '$lib/stores';
import type { TreeNode as TreeNodeType } from '$lib/types';
import TreeNode from './TreeNode.svelte';

let row: TreeNode | null = null;

const FOLDER = {
  name: 'logs',
  path: '/logs',
  type: 'directory',
  level: 0,
  expanded: false,
  loading: false,
  children: [],
} as unknown as TreeNodeType;

/** Mount a folder row and return it, with the tree's toggle stubbed out. */
function mount() {
  const toggle = vi.spyOn(tree, 'toggleExpanded').mockResolvedValue(undefined);
  const target = document.createElement('div');
  document.body.appendChild(target);
  row = new TreeNode({ target, props: { node: FOLDER } });
  const item = target.querySelector<HTMLElement>('[role="treeitem"]');
  if (!item) throw new Error('the tree row is not rendered');
  return { item, toggle };
}

function keyDown(item: HTMLElement, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  item.dispatchEvent(event);
  return event;
}

afterEach(() => {
  row?.$destroy();
  row = null;
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('TreeNode keys', () => {
  it.each(['Enter', ' '])('opens the folder on %j', (key) => {
    const { item, toggle } = mount();

    const event = keyDown(item, { key });

    expect(toggle).toHaveBeenCalledWith('/logs');
    expect(event.defaultPrevented).toBe(true);
  });

  it.each([{ key: 'a' }, { key: 'Enter', isComposing: true }])(
    'leaves %o to the browser',
    (init) => {
      const { item, toggle } = mount();

      const event = keyDown(item, init);

      expect(toggle).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    },
  );
});
