import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { files } from './stores/files';
import { notifications } from './stores/notifications';
import { openFileAtLine, openTreeFile } from './fileOpening';
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

/** The part of a `fetch` response the API client reads. */
interface FakeResponse {
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}

/** Answers every request with a seven-line sample; counts the requests. */
function serveSamples() {
  const spy = vi.fn(async (url: string): Promise<FakeResponse> => {
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

/**
 * Answers `/v1/tree` for `/logs` with `entries`, and every other request
 * with a seven-line sample.
 */
function serveDirectory(entries: TreeNode[]) {
  const samples = serveSamples();
  const spy = vi.fn(async (url: string): Promise<FakeResponse> => {
    if (!url.startsWith('/v1/tree')) return samples(url);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        path: '/logs',
        parent: null,
        is_search_root: true,
        entries,
        total_entries: entries.length,
        total_size: null,
        total_size_human: null,
      }),
      text: async () => '',
    };
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

describe('openFileAtLine', () => {
  afterEach(() => {
    for (const file of get(files).openFiles) files.closeFile(file.path);
    vi.unstubAllGlobals();
  });

  // A search result names a path only; without its size the file would
  // open with highlighting whatever its size.
  it('opens a large file from a search result without highlighting', async () => {
    serveDirectory([treeFile('/logs/big.log', { size: 5 * 1024 * 1024 })]);

    await openFileAtLine('/logs/big.log', 3);

    const opened = get(files).openFiles.find((f) => f.path === '/logs/big.log');
    expect(opened?.fileSize).toBe(5 * 1024 * 1024);
    expect(opened?.syntaxHighlighting).toBe(false);
  });

  it('opens a file the listing does not name with the unknown-size default', async () => {
    serveDirectory([]);

    await openFileAtLine('/logs/gone.log', 3);

    const opened = get(files).openFiles.find((f) => f.path === '/logs/gone.log');
    expect(opened?.fileSize).toBeNull();
    expect(opened?.syntaxHighlighting).toBe(true);
  });

  it('moves an open file to the line without asking for the listing', async () => {
    const fetchSpy = serveDirectory([treeFile('/logs/big.log', { size: 5 * 1024 * 1024 })]);
    await openFileAtLine('/logs/big.log', 3);
    const treeRequests = () => fetchSpy.mock.calls.filter(([url]) => url.startsWith('/v1/tree'));
    const before = treeRequests().length;

    await openFileAtLine('/logs/big.log', 5);

    expect(treeRequests().length).toBe(before);
    expect(get(files).openFiles.find((f) => f.path === '/logs/big.log')?.anchorLine).toBe(5);
  });
});
