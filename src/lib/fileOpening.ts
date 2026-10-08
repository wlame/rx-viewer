/**
 * Opening a file from a place that lists it, with what that place knows
 * about the file: its size (for the highlighting default), whether it is
 * indexed, its line count, and whether it is text at all.
 */
import { get } from 'svelte/store';
import { api } from './api';
import { files } from './stores/files';
import { notifications } from './stores/notifications';
import type { ChainPosition } from './stores/chainTabs';
import { trace } from './stores/trace';
import { tree } from './stores/tree';
import type { FileMatch, SearchResponse, TreeEntry } from './types';
import { chainKey } from './utils/tabKey';

/** How long the refusal of a binary file stays on screen. */
const BINARY_NOTICE_MS = 5000;

/**
 * Open a file the tree lists. A file the backend marks as not text is
 * refused with a notification: rx-go answers a binary file's bytes as
 * if they were lines, so opening it would only show noise.
 */
export async function openTreeFile(
  entry: Pick<
    TreeEntry,
    'path' | 'name' | 'is_text' | 'size' | 'is_indexed' | 'line_count' | 'compression_format'
  >,
): Promise<void> {
  if (entry.is_text === false) {
    notifications.error(`Cannot open binary file: ${entry.name}`, BINARY_NOTICE_MS);
    return;
  }
  await files.openFile(entry.path, {
    fileSize: entry.size,
    isIndexed: entry.is_indexed ?? undefined,
    lineCount: entry.line_count ?? undefined,
    compressionFormat: entry.compression_format,
  });
}

/** The directory that holds `path`: `/logs` for `/logs/app.log`, `/` for `/app.log`. */
function parentDirectory(path: string): string {
  return path.slice(0, path.lastIndexOf('/')) || '/';
}

/**
 * What the backend lists about a file: the loaded tree's entry when it
 * has one, otherwise the entry in one listing of its directory, which
 * leaves the tree as it is. Null when neither names the file or the
 * listing fails; the file then opens with the defaults of a file of
 * unknown size.
 */
async function lookUpEntry(path: string): Promise<TreeEntry | null> {
  const known = tree.nodeAt(path);
  if (known) return known;
  try {
    const listing = await api.getTree(parentDirectory(path));
    return listing.entries?.find((entry) => entry.path === path) ?? null;
  } catch (e) {
    console.debug('Directory listing failed; opening with an unknown size:', path, e);
    return null;
  }
}

/**
 * Show a file at a line, for a place that names only the path (a search
 * result). An open file moves to the line. Otherwise the file's entry
 * gives the size the highlighting default needs, its line count and
 * whether it is indexed.
 */
export async function openFileAtLine(path: string, line: number): Promise<void> {
  if (get(files).openFiles.some((f) => f.path === path)) {
    await files.jumpToLine(path, line);
    return;
  }
  const entry = await lookUpEntry(path);
  await files.openFile(path, {
    scrollToLine: line,
    fileSize: entry?.size ?? null,
    isIndexed: entry?.is_indexed ?? undefined,
    lineCount: entry?.line_count ?? undefined,
    compressionFormat: entry?.compression_format ?? null,
  });
}

/** What a search result hands the chain's tab it opens. */
export interface ChainMatchOpening {
  /** The search's matches in the chain, by part and line in it. */
  marks: FileMatch[];
  /** The search the marks come from. */
  search: SearchResponse;
  /** The chain's fingerprint as the search found it. */
  fingerprint?: string;
}

/**
 * Show a log chain's tab at a position, for a search result in one of its
 * parts: the open tab moves there, or the tab opens there. The tab marks
 * `marks`, the search's matches in the chain by part and line in it, so
 * the marks stay on their lines however the tab numbers them.
 *
 * `fingerprint` is the chain's as the search found it. When the chain's
 * files changed since, the part and line of a match name other text: the
 * tab does not go there (a new tab opens at the chain's start), marks
 * nothing, and says to search again.
 *
 * The marks are set only while `search` is still the search the panel
 * shows: one started while the tab opened cleared every mark, and the
 * older search's do not come back.
 */
export async function openChainAt(
  handle: string,
  position: ChainPosition,
  { marks, search, fingerprint }: ChainMatchOpening,
): Promise<void> {
  const isSearchedChain = await files.openChain(handle, { position, fingerprint });
  if (get(trace).response !== search) return;
  files.setMatches(chainKey(handle), isSearchedChain ? marks : []);
}
