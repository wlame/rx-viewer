/**
 * Opening a file from a place that lists it, with what that place knows
 * about the file: its size (for the highlighting default), whether it is
 * indexed, its line count, and whether it is text at all.
 */
import { get } from 'svelte/store';
import { api } from './api';
import { files } from './stores/files';
import { notifications } from './stores/notifications';
import { tree } from './stores/tree';
import type { TreeEntry } from './types';

/** How long the refusal of a binary file stays on screen. */
const BINARY_NOTICE_MS = 5000;

/**
 * Open a file the tree lists. A file the backend marks as not text is
 * refused with a notification: rx-go answers a binary file's bytes as
 * if they were lines, so opening it would only show noise.
 */
export async function openTreeFile(
  entry: Pick<TreeEntry, 'path' | 'name' | 'is_text' | 'size' | 'is_indexed' | 'line_count'>,
): Promise<void> {
  if (entry.is_text === false) {
    notifications.error(`Cannot open binary file: ${entry.name}`, BINARY_NOTICE_MS);
    return;
  }
  await files.openFile(
    entry.path,
    undefined,
    entry.size,
    undefined,
    entry.is_indexed ?? undefined,
    entry.line_count ?? undefined,
  );
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
  await files.openFile(
    path,
    line,
    entry?.size ?? null,
    undefined,
    entry?.is_indexed ?? undefined,
    entry?.line_count ?? undefined,
  );
}
