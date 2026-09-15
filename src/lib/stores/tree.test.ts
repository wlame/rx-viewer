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

/** Answers `/v1/tree`: one root, `/logs`, holding one folder and one file. */
function serveTree() {
  const spy = vi.fn(async (url: string) => {
    const path = new URL(url, 'http://localhost').searchParams.get('path');
    const entries =
      path === null
        ? [entry('/logs', 'directory')]
        : [entry('/logs/app', 'directory'), entry('/logs/a.log', 'file')];
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
    await tree.toggleExpanded('/logs');
    const callsBefore = fetchSpy.mock.calls.length;

    await tree.ensureRoots();

    expect(tree.nodeAt('/logs')?.expanded).toBe(true);
    expect(tree.nodeAt('/logs/a.log')).not.toBeNull();
    expect(fetchSpy.mock.calls.length).toBe(callsBefore);
  });

  it('loads the roots the first time', async () => {
    serveTree();
    await tree.loadRoots();
    expect(get(tree).roots.map((root) => root.path)).toEqual(['/logs']);
  });
});
