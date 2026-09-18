import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { files } from './stores/files';
import { notifications } from './stores/notifications';
import { openTreeFile } from './fileOpening';
import type { TreeNode } from './types';

/** A file entry as the tree lists it. */
function treeFile(path: string, fields: Partial<TreeNode> = {}): TreeNode {
  return {
    path,
    name: path.split('/').pop() ?? path,
    type: 'file',
    children_count: null,
    compression_format: null,
    is_compressed: false,
    is_indexed: false,
    is_text: true,
    line_count: null,
    modified_at: null,
    size: 100,
    size_human: null,
    level: 1,
    expanded: false,
    loading: false,
    children: [],
    ...fields,
  };
}

/** Answers every request with a seven-line sample; counts the requests. */
function serveSamples() {
  const spy = vi.fn(async (url: string) => {
    const lines = new URL(url, 'http://localhost').searchParams.get('lines') ?? '1-7';
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        path: '',
        samples: { [lines]: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] },
        before_context: 0,
        after_context: 0,
        lines: {},
        offsets: {},
        is_compressed: false,
        compression_format: null,
        cli_command: null,
      }),
      text: async () => '',
    };
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

describe('openTreeFile', () => {
  afterEach(() => {
    for (const file of get(files).openFiles) files.closeFile(file.path);
    for (const shown of get(notifications)) notifications.dismiss(shown.id);
    vi.unstubAllGlobals();
  });

  // rx-go answers a binary file's bytes as lines; the tree's is_text is
  // what says the file is not text.
  it('does not open a file the tree marks as not text, and says why', async () => {
    const fetchSpy = serveSamples();

    await openTreeFile(treeFile('/logs/core.bin', { is_text: false }));

    expect(get(files).openFiles).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(get(notifications).map((n) => [n.type, n.message])).toEqual([
      ['error', 'Cannot open binary file: core.bin'],
    ]);
  });

  it('opens a text file with what the tree knows about it', async () => {
    serveSamples();

    await openTreeFile(treeFile('/logs/app.log', { size: 5 * 1024 * 1024, line_count: 7 }));

    const opened = get(files).openFiles.find((f) => f.path === '/logs/app.log');
    expect(opened?.fileSize).toBe(5 * 1024 * 1024);
    expect(opened?.syntaxHighlighting).toBe(false);
    expect(opened?.totalLines).toBe(7);
  });
});
