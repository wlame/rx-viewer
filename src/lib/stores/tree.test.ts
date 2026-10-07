import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { tree } from './tree';

/** A tree entry for a directory or a file under `path`. */
function entry(path: string, type: 'directory' | 'file') {
  return {
    path,
    name: path.split('/').pop(),
    type,
    children_count: null,
    compression_format: null,
    is_compressed: null,
    is_indexed: null,
    is_text: null,
    line_count: null,
    modified_at: null,
    size: null,
    size_human: null,
  };
}

/**
 * Answers `/v1/tree`: the given roots, each holding one folder and one
 * file. One root, `/logs`, by default.
 */
function serveTree(roots: string[] = ['/logs']) {
  const spy = vi.fn(async (url: string) => {
    const path = new URL(url, 'http://localhost').searchParams.get('path');
    const entries =
      path === null
        ? roots.map((root) => entry(root, 'directory'))
        : [entry(`${path}/app`, 'directory'), entry(`${path}/a.log`, 'file')];
    const body = {
      path: path ?? '',
      parent: null,
      is_search_root: path === null,
      entries,
      total_entries: entries.length,
      total_size: null,
      total_size_human: null,
    };
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => body,
      text: async () => '',
    };
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

describe('the tree when the Files tab is shown again', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the expanded folders and asks for nothing', async () => {
    const fetchSpy = serveTree();
    await tree.ensureRoots();
    await tree.toggleExpanded('/logs/app');
    const callsBefore = fetchSpy.mock.calls.length;

    await tree.ensureRoots();

    expect(tree.nodeAt('/logs')?.expanded).toBe(true);
    expect(tree.nodeAt('/logs/app')?.expanded).toBe(true);
    expect(tree.nodeAt('/logs/a.log')).not.toBeNull();
    expect(fetchSpy.mock.calls.length).toBe(callsBefore);
  });

  it('loads the roots the first time', async () => {
    serveTree();
    await tree.loadRoots();
    expect(get(tree).roots.map((root) => root.path)).toEqual(['/logs']);
  });

  it('opens every root folder on the first load', async () => {
    serveTree(['/logs', '/srv']);
    await tree.loadRoots();

    for (const root of ['/logs', '/srv']) {
      expect(tree.nodeAt(root)?.expanded).toBe(true);
      expect(tree.nodeAt(`${root}/a.log`)).not.toBeNull();
    }
    // Only the roots open: their folders stay closed until clicked.
    expect(tree.nodeAt('/logs/app')?.expanded).toBe(false);
  });
});
