import { writable, get } from 'svelte/store';
import { api } from '../api';
import { contractGate } from '../contractGate';
import { isChainIndexed } from '../utils/chainParts';
import { chainDirectoryOf, type DescribedChain } from '../utils/chainTree';
import { LatestRequest, LatestRequestMap, SUPERSEDED, isAbortError } from '../utils/latestRequest';
import type { ChainEntry, ChainResponse, TreeNode, TreeEntry } from '../types';
import { chainModeOn } from './chainMode';

/** Chains whose last description the tree keeps; the oldest is dropped first. */
export const MAX_DESCRIBED_CHAINS = 256;

interface TreeState {
  roots: TreeNode[];
  loading: boolean;
  error: string | null;
  /** The selected row: a file's or folder's path, or a chain's tab key (`chain:<handle>`). */
  selectedPath: string | null;
  /**
   * What the last description of each chain said (its state and reasons),
   * by handle, from a chain's tab; at most `MAX_DESCRIBED_CHAINS`. A
   * listing does not describe a chain, so this is how the files panel
   * learns that one is invalid.
   */
  describedChains: ReadonlyMap<string, DescribedChain>;
}

function entryToNode(entry: TreeEntry, level: number): TreeNode {
  return {
    ...entry,
    expanded: false,
    loading: false,
    children: [],
    level,
  };
}

function createTreeStore() {
  const { subscribe, update } = writable<TreeState>({
    roots: [],
    loading: false,
    error: null,
    selectedPath: null,
    describedChains: new Map(),
  });

  function findNode(nodes: TreeNode[], path: string): TreeNode | null {
    for (const node of nodes) {
      if (node.path === path) return node;
      if (node.children.length > 0) {
        const found = findNode(node.children, path);
        if (found) return found;
      }
    }
    return null;
  }

  function updateNode(
    nodes: TreeNode[],
    path: string,
    updater: (node: TreeNode) => TreeNode,
  ): TreeNode[] {
    return nodes.map((node) => {
      if (node.path === path) {
        return updater(node);
      }
      if (node.children.length > 0) {
        return {
          ...node,
          children: updateNode(node.children, path, updater),
        };
      }
      return node;
    });
  }

  // The roots load once per session but can be retried; only the newest
  // attempt may write. Directory loads are keyed by path so expanding one
  // folder does not cancel another.
  const latestRoots = new LatestRequest();
  const directoryLoads = new LatestRequestMap();

  async function loadRoots() {
    update((s) => ({ ...s, loading: true, error: null }));
    try {
      const response = await latestRoots.run((signal) => api.getTree(undefined, { signal }));
      if (response === SUPERSEDED) return;

      const roots = (response.entries ?? [])
        .filter((e) => e.type === 'directory')
        .map((e) => entryToNode(e, 0));
      update((s) => ({ ...s, roots, loading: false }));
      // The search roots open with the tree, so the first level of every
      // root is in view at once; deeper folders stay closed until clicked.
      // Each root is listed by its own request, all at the same time.
      await Promise.all(roots.map((root) => loadDirectory(root.path)));
    } catch (e) {
      if (isAbortError(e)) return;
      update((s) => ({
        ...s,
        loading: false,
        error: e instanceof Error ? e.message : 'Failed to load roots',
      }));
    }
  }

  /**
   * Load the roots unless they are loaded or loading. Loading them again
   * replaces every node, which collapses the expanded folders; Retry and
   * a first load are the only reasons to do that.
   */
  async function ensureRoots() {
    const state = get({ subscribe });
    if (state.roots.length > 0 || state.loading) return;
    await loadRoots();
  }

  /**
   * The chains of a directory, or undefined when they cannot be listed:
   * the directory then shows every file, and the tree shows no error.
   */
  async function chainListing(
    path: string,
    signal: AbortSignal,
  ): Promise<readonly ChainEntry[] | undefined> {
    try {
      return (await api.logChains(path, { signal })).chains;
    } catch (e) {
      if (isAbortError(e)) throw e;
      console.warn('The log chains of a directory could not be listed:', path, e);
      return undefined;
    }
  }

  /**
   * Load a directory's entries and expand it. With chain mode on, its
   * chains are asked for at the same time, and the directory shows them
   * once both answers are in; a chain listing that fails leaves every
   * file shown. When the mode turned on while the load ran, the chains
   * are asked for afterwards.
   */
  async function loadDirectory(path: string) {
    const state = get({ subscribe });
    const node = findNode(state.roots, path);
    if (!node || node.type !== 'directory') return;

    update((s) => ({
      ...s,
      roots: updateNode(s.roots, path, (n) => ({ ...n, loading: true })),
    }));

    try {
      const response = await directoryLoads.run(path, async (signal) => {
        // The mode needs the backend's features, which the first /health
        // answer gives; the first requests wait for it anyway.
        await contractGate.pass(signal);
        const withChains = get(chainModeOn);
        const [listing, chains] = await Promise.all([
          api.getTree(path, { signal }),
          withChains ? chainListing(path, signal) : undefined,
        ]);
        return { listing, chains, withChains };
      });
      if (response === SUPERSEDED) return;

      const { listing, chains, withChains } = response;
      const children = (listing.entries ?? []).map((e) => entryToNode(e, node.level + 1));
      update((s) => ({
        ...s,
        roots: updateNode(s.roots, path, (n) => ({
          ...n,
          loading: false,
          children,
          chains,
          expanded: true,
        })),
      }));
      if (!withChains) await ensureChains(path);
    } catch (e) {
      if (isAbortError(e)) return;
      update((s) => ({
        ...s,
        roots: updateNode(s.roots, path, (n) => ({ ...n, loading: false })),
        error: e instanceof Error ? e.message : 'Failed to load directory',
      }));
    }
  }

  /** The directories whose chains are being listed. */
  const chainLoads = new LatestRequestMap();
  const listingChains = new Set<string>();

  /**
   * List a loaded directory's chains, whatever it holds already, and keep
   * them. A directory the tree has not loaded is left alone.
   */
  async function refreshChains(path: string): Promise<void> {
    const node = findNode(get({ subscribe }).roots, path);
    if (!node || node.type !== 'directory') return;
    listingChains.add(path);
    try {
      const chains = await chainLoads.run(path, (signal) => chainListing(path, signal));
      if (chains === SUPERSEDED || chains === undefined) return;
      update((s) => ({
        ...s,
        roots: updateNode(s.roots, path, (n) => ({ ...n, chains })),
      }));
    } catch (e) {
      if (!isAbortError(e)) throw e;
    } finally {
      listingChains.delete(path);
    }
  }

  /**
   * List a loaded directory's chains while chain mode is on, unless they
   * are listed or being listed.
   */
  async function ensureChains(path: string): Promise<void> {
    if (!get(chainModeOn) || listingChains.has(path)) return;
    if (findNode(get({ subscribe }).roots, path)?.chains !== undefined) return;
    await refreshChains(path);
  }

  /**
   * The expanded directories on screen among `nodes` and under them: a
   * collapsed directory and every directory under it are left out, an
   * expanded one among them too, as the panel does not show them.
   */
  function shownDirectories(nodes: readonly TreeNode[]): string[] {
    return nodes.flatMap((node) =>
      node.type === 'directory' && node.expanded
        ? [node.path, ...shownDirectories(node.children)]
        : [],
    );
  }

  /**
   * List the chains of the expanded directories among `nodes` and under
   * them that the panel shows and that have none listed, all at once. A
   * collapsed directory is listed when it is expanded.
   */
  async function listChainsOfShownDirectories(
    nodes: readonly TreeNode[] = get({ subscribe }).roots,
  ): Promise<void> {
    await Promise.all(shownDirectories(nodes).map(ensureChains));
  }

  async function toggleExpanded(path: string) {
    const state = get({ subscribe });
    const node = findNode(state.roots, path);
    if (!node || node.type !== 'directory') return;

    if (node.expanded) {
      // Collapse
      update((s) => ({
        ...s,
        roots: updateNode(s.roots, path, (n) => ({ ...n, expanded: false })),
      }));
    } else if (node.children.length > 0) {
      // Already loaded, just expand. Its chains, and those of the expanded
      // folders it shows again, are asked for when not listed: the mode
      // may have turned on while it was collapsed, or a listing failed.
      update((s) => ({
        ...s,
        roots: updateNode(s.roots, path, (n) => ({ ...n, expanded: true })),
      }));
      const expanded = findNode(get({ subscribe }).roots, path);
      if (expanded) await listChainsOfShownDirectories([expanded]);
    } else {
      // Load and expand
      await loadDirectory(path);
    }
  }

  function selectPath(path: string | null) {
    update((s) => ({ ...s, selectedPath: path }));
  }

  /** Show a file as indexed after an index or analysis task built its index. */
  function markIndexed(path: string, lineCount: number | null) {
    update((s) => ({
      ...s,
      roots: updateNode(s.roots, path, (n) => ({
        ...n,
        is_indexed: true,
        line_count: lineCount ?? n.line_count,
      })),
    }));
  }

  /**
   * Keep what a chain's description said, for its row: its state and
   * reasons (an invalid chain is marked), and whether every part it
   * needs is indexed (`idx`), which a listing of its directory gave
   * before.
   */
  function noteChainDescription(chain: ChainResponse) {
    const handle = chain.path;
    const isIndexed = isChainIndexed(chain.parts);
    update((s) => {
      const described = new Map(s.describedChains);
      described.delete(handle);
      described.set(handle, { state: chain.state, reasons: chain.reasons });
      for (const oldest of described.keys()) {
        if (described.size <= MAX_DESCRIBED_CHAINS) break;
        described.delete(oldest);
      }
      return {
        ...s,
        describedChains: described,
        roots: updateNode(s.roots, chainDirectoryOf(handle), (n) => ({
          ...n,
          chains: n.chains?.map((c) => (c.path === handle ? { ...c, is_indexed: isIndexed } : c)),
        })),
      };
    });
  }

  /**
   * Expand all parent directories to reveal a file path and select it
   */
  async function expandToPath(filePath: string) {
    // Ensure roots are loaded first
    const state = get({ subscribe });
    if (state.roots.length === 0 && !state.loading) {
      await loadRoots();
    }

    // Wait for roots to finish loading if they're currently loading
    if (state.loading) {
      // Poll until loading is done
      await new Promise<void>((resolve) => {
        const unsubscribe = subscribe((s) => {
          if (!s.loading) {
            unsubscribe();
            resolve();
          }
        });
      });
    }

    // Get all parent directory paths
    const parts = filePath.split('/').filter((p) => p);
    const parentPaths: string[] = [];

    for (let i = 1; i < parts.length; i++) {
      parentPaths.push('/' + parts.slice(0, i).join('/'));
    }

    // Load and expand each parent directory in sequence
    for (const dirPath of parentPaths) {
      const currentState = get({ subscribe });
      const node = findNode(currentState.roots, dirPath);

      if (node && node.type === 'directory' && !node.expanded) {
        await loadDirectory(dirPath);
      }
    }

    // Select the file
    selectPath(filePath);
  }

  /** The tree's entry for a path, or null when the loaded tree does not list it. */
  function nodeAt(path: string): TreeNode | null {
    return findNode(get({ subscribe }).roots, path);
  }

  return {
    subscribe,
    nodeAt,
    loadRoots,
    ensureRoots,
    loadDirectory,
    toggleExpanded,
    selectPath,
    markIndexed,
    expandToPath,
    listChainsOfShownDirectories,
    refreshChains,
    noteChainDescription,
  };
}

export const tree = createTreeStore();

// Turning chain mode on (or the backend's features arriving with it on)
// lists the chains of the expanded directories on screen; a collapsed one
// is listed when it is expanded. The rows are worked out from the entries
// and the chains as they are shown, so turning the mode off and on again
// collapses nothing and asks for nothing.
chainModeOn.subscribe((on) => {
  if (on) void tree.listChainsOfShownDirectories();
});
