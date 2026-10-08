/** Files this size and larger open with syntax highlighting off. */
const HIGHLIGHT_SIZE_LIMIT = 1024 * 1024;

/**
 * Whether a file opens with syntax highlighting: on below 1 MB, off from
 * 1 MB up, on when the size is unknown. A log chain's size is the sum of
 * its parts'.
 */
export function defaultSyntaxHighlighting(fileSize: number | null | undefined): boolean {
  return fileSize === null || fileSize === undefined || fileSize < HIGHLIGHT_SIZE_LIMIT;
}
