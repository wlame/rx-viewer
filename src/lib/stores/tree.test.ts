import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { FakeChain } from '../testing/fakeChain';
import { CHAIN_NAMES, LOG_DIR, LOG_ROOT, LogDirBackend, serveLogDir } from '../testing/fakeLogDir';
import { isChainRow, shownChildren } from '../utils/chainTree';
import { DEFAULT_SORT } from '../utils/treeSort';
import { chainMode } from './chainMode';
import { health } from './health';
import { MAX_DESCRIBED_CHAINS, tree } from './tree';

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

describe('the tree when the Files panel is shown again', () => {
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

describe('the tree opening and closing a folder', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('loads and opens a folder on expand, and closes it on collapse', async () => {
    serveTree();
    await tree.loadRoots();

    await tree.expand('/logs/app');
    expect(tree.nodeAt('/logs/app')?.expanded).toBe(true);
    expect(tree.nodeAt('/logs/app/a.log')).not.toBeNull();

    tree.collapse('/logs/app');
    expect(tree.nodeAt('/logs/app')?.expanded).toBe(false);
    expect(tree.nodeAt('/logs/app/a.log')).not.toBeNull();
  });

  it('asks once for a folder that expand meets while its rows load', async () => {
    const backend = new LogDirBackend({ features: [] });
    serveLogDir(backend);
    await tree.loadRoots();
    backend.hold('/v1/tree');

    const first = tree.expand(LOG_DIR);
    expect(tree.nodeAt(LOG_DIR)?.loading).toBe(true);
    const second = tree.expand(LOG_DIR);
    backend.release();
    await Promise.all([first, second]);

    expect(
      backend.requestsTo('/v1/tree').filter((r) => r === listed('/v1/tree', LOG_DIR)),
    ).toHaveLength(1);
    expect(tree.nodeAt(LOG_DIR)?.expanded).toBe(true);
  });

  it('leaves an open folder open on expand and a closed one closed on collapse', async () => {
    const fetchSpy = serveTree();
    await tree.loadRoots();
    const calls = fetchSpy.mock.calls.length;

    await tree.expand('/logs');
    tree.collapse('/logs/app');

    expect(tree.nodeAt('/logs')?.expanded).toBe(true);
    expect(tree.nodeAt('/logs/app')?.expanded).toBe(false);
    expect(fetchSpy.mock.calls.length).toBe(calls);
  });
});

/** The request of `pathname` for the directory `dir`, as the backend records it. */
function listed(pathname: string, dir: string): string {
  return `${pathname}?path=${encodeURIComponent(dir)}`;
}

/** The names of the chains a directory shows in chain mode. */
function chainNamesShown(dir: string): string[] {
  const node = tree.nodeAt(dir);
  if (!node) throw new Error(`${dir} is not in the tree`);
  return shownChildren(node, { chainModeOn: true, sort: DEFAULT_SORT })
    .filter(isChainRow)
    .map((row) => row.chain.name);
}

describe('the tree in chain mode', () => {
  let backend: LogDirBackend;

  /** Serve the log directory, set the mode, and load the roots. */
  async function start(
    mode: boolean,
    options: ConstructorParameters<typeof LogDirBackend>[0] = {},
  ) {
    backend = new LogDirBackend(options);
    serveLogDir(backend);
    await health.check();
    chainMode.set(mode);
    await tree.loadRoots();
  }

  afterEach(() => {
    chainMode.set(false);
    vi.unstubAllGlobals();
  });

  it('asks for a directory and its chains at the same time, and shows the chains', async () => {
    await start(true);
    backend.hold('/v1/tree');
    backend.hold('/v1/logs/chains');

    const loading = tree.toggleExpanded(LOG_DIR);
    await vi.waitFor(() => {
      expect(backend.requests).toContain(listed('/v1/tree', LOG_DIR));
      expect(backend.requests).toContain(listed('/v1/logs/chains', LOG_DIR));
    });
    backend.release();
    await loading;

    expect(chainNamesShown(LOG_DIR)).toEqual(CHAIN_NAMES);
    expect(tree.nodeAt(LOG_DIR)?.children).toHaveLength(70);
  });

  it('asks for no chains with the mode off', async () => {
    await start(false);

    await tree.toggleExpanded(LOG_DIR);

    expect(backend.requestsTo('/v1/logs/chains')).toEqual([]);
    expect(tree.nodeAt(LOG_DIR)?.chains).toBeUndefined();
  });

  it('lists the chains of every expanded folder on screen when the mode turns on, and collapses none', async () => {
    await start(false);
    await tree.toggleExpanded(LOG_DIR);
    await tree.toggleExpanded(`${LOG_DIR}/pkgcache`);

    chainMode.set(true);
    await vi.waitFor(() => expect(tree.nodeAt(LOG_DIR)?.chains).toBeDefined());

    expect(chainNamesShown(LOG_DIR)).toEqual(CHAIN_NAMES);
    expect([...backend.requestsTo('/v1/logs/chains')].sort()).toEqual(
      [LOG_ROOT, LOG_DIR, `${LOG_DIR}/pkgcache`]
        .map((dir) => listed('/v1/logs/chains', dir))
        .sort(),
    );
    expect(tree.nodeAt(LOG_DIR)?.expanded).toBe(true);
    expect(tree.nodeAt(`${LOG_DIR}/pkgcache`)?.expanded).toBe(true);
  });

  // A folder the panel does not show is listed when it is shown again.
  it('lists no chains of a collapsed folder when the mode turns on, and lists them when it is expanded', async () => {
    await start(false);
    await tree.toggleExpanded(LOG_DIR);
    await tree.toggleExpanded(LOG_DIR);

    chainMode.set(true);
    await vi.waitFor(() => expect(tree.nodeAt(LOG_ROOT)?.chains).toBeDefined());

    expect(backend.requestsTo('/v1/logs/chains')).toEqual([listed('/v1/logs/chains', LOG_ROOT)]);
    expect(tree.nodeAt(LOG_DIR)?.chains).toBeUndefined();

    await tree.toggleExpanded(LOG_DIR);

    expect(backend.requestsTo('/v1/logs/chains')).toContain(listed('/v1/logs/chains', LOG_DIR));
    expect(chainNamesShown(LOG_DIR)).toEqual(CHAIN_NAMES);
  });

  // An expanded folder inside a collapsed one is not on screen either; it
  // is listed when its parent is expanded.
  it('lists the chains of an expanded folder inside a collapsed one when the parent is expanded', async () => {
    const pkgcache = `${LOG_DIR}/pkgcache`;
    await start(false);
    await tree.toggleExpanded(LOG_DIR);
    await tree.toggleExpanded(pkgcache);
    await tree.toggleExpanded(LOG_DIR);

    chainMode.set(true);
    await vi.waitFor(() => expect(tree.nodeAt(LOG_ROOT)?.chains).toBeDefined());

    expect(backend.requestsTo('/v1/logs/chains')).toEqual([listed('/v1/logs/chains', LOG_ROOT)]);

    await tree.toggleExpanded(LOG_DIR);

    expect([...backend.requestsTo('/v1/logs/chains')].sort()).toEqual(
      [LOG_ROOT, LOG_DIR, pkgcache].map((dir) => listed('/v1/logs/chains', dir)).sort(),
    );
    expect(chainNamesShown(LOG_DIR)).toEqual(CHAIN_NAMES);
  });

  it('keeps the folders and the listed chains through the mode turning off and on', async () => {
    await start(true);
    await tree.toggleExpanded(LOG_DIR);
    await tree.toggleExpanded(`${LOG_DIR}/pkgcache`);
    const asked = backend.requestsTo('/v1/logs/chains').length;

    chainMode.set(false);
    chainMode.set(true);
    await Promise.resolve();

    expect(tree.nodeAt(`${LOG_DIR}/pkgcache`)?.expanded).toBe(true);
    expect(chainNamesShown(LOG_DIR)).toEqual(CHAIN_NAMES);
    expect(backend.requestsTo('/v1/logs/chains')).toHaveLength(asked);
  });

  it('lists the chains of a folder whose load began before the mode turned on', async () => {
    await start(false);
    backend.hold('/v1/tree');
    const loading = tree.toggleExpanded(LOG_DIR);
    await vi.waitFor(() => expect(backend.requests).toContain(listed('/v1/tree', LOG_DIR)));

    chainMode.set(true);
    backend.release();
    await loading;

    await vi.waitFor(() => expect(chainNamesShown(LOG_DIR)).toEqual(CHAIN_NAMES));
  });

  // A refused listing must not hide the tree, nor any file of the folder.
  it('shows every file of a folder whose chains cannot be listed, and no error', async () => {
    await start(true, { chainsStatus: 403 });

    await tree.toggleExpanded(LOG_DIR);

    expect(tree.nodeAt(LOG_DIR)?.chains).toBeUndefined();
    expect(tree.nodeAt(LOG_DIR)?.children).toHaveLength(70);
    expect(get(tree).error).toBeNull();
    expect(get(tree).roots).toHaveLength(1);
  });

  it('lists the chains of a folder again on request', async () => {
    await start(true);
    await tree.toggleExpanded(LOG_DIR);
    const asked = () =>
      backend.requests.filter((r) => r === listed('/v1/logs/chains', LOG_DIR)).length;
    const before = asked();

    await tree.refreshChains(LOG_DIR);

    expect(asked()).toBe(before + 1);
    expect(chainNamesShown(LOG_DIR)).toEqual(CHAIN_NAMES);
  });

  it('keeps the state and reasons a description gives, and its idx', async () => {
    await start(true);
    await tree.toggleExpanded(LOG_DIR);
    const handle = `${LOG_DIR}/pkg.log`;
    const reasons = [{ code: 'overlap', message: 'they overlap', overlap_ms: 5, parts: [] }];
    const described = new FakeChain({
      dir: LOG_DIR,
      name: 'pkg.log',
      parts: [
        { name: 'pkg.log.1', lines: 10 },
        { name: 'pkg.log', lines: 5, isActive: true },
      ],
      state: 'ready',
    }).description();

    tree.noteChainDescription({ ...described, state: 'invalid', reasons: reasons as never });

    expect(get(tree).describedChains.get(handle)).toEqual({ state: 'invalid', reasons });
    const entry = tree.nodeAt(LOG_DIR)?.chains?.find((c) => c.path === handle);
    expect(entry?.is_indexed).toBe(true);
  });

  it('keeps what the latest descriptions said, up to its limit', async () => {
    await start(true);
    const describe = (n: number) =>
      new FakeChain({
        dir: '/many',
        name: `c${n}.log`,
        parts: [{ name: `c${n}.log`, lines: 1, isActive: true }],
      }).description();

    for (let n = 0; n <= MAX_DESCRIBED_CHAINS; n++) tree.noteChainDescription(describe(n));

    const described = get(tree).describedChains;
    expect(described.size).toBe(MAX_DESCRIBED_CHAINS);
    expect(described.has('/many/c0.log')).toBe(false);
    expect(described.has(`/many/c${MAX_DESCRIBED_CHAINS}.log`)).toBe(true);
  });
});
