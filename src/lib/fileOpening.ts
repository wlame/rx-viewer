/**
 * Opening a file from a place that lists it, with what that place knows
 * about the file: its size (for the highlighting default), whether it is
 * indexed, its line count, and whether it is text at all.
 */
import { files } from './stores/files';
import { notifications } from './stores/notifications';
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
