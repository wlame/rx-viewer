import type { FileLine } from '../types';

/** How many lines one paging request loads. */
export const LINES_PER_PAGE = 1000;

/**
 * How many pages of lines an open file holds at most.
 *
 * A page is what one paging request loads (`LINES_PER_PAGE`). Paging starts when the view comes within 200 px of an
 * edge of the held lines, so right after a page arrives the view sits
 * about one page from that edge. Five pages leave about four pages of
 * lines already seen behind the view, which the user can scroll back
 * through without a request, and they bound what every page costs: the
 * filter re-processes the held lines and Monaco receives all of them,
 * so both stay at 5,000 lines however far the user scrolls
 * through a file of any size.
 */
export const HELD_PAGES = 5;

/** The most lines a file holds for a page size. */
export function maxHeldLines(linesPerPage: number): number {
  return HELD_PAGES * linesPerPage;
}

/** The held lines after a page was added, and which end lost lines to the cap. */
export interface HeldWindow {
  lines: FileLine[];
  /** Lines at the start were dropped: the window no longer reaches line 1. */
  droppedBefore: boolean;
  /** Lines at the end were dropped: the window no longer reaches the end of the file. */
  droppedAfter: boolean;
}

/**
 * Add a page before or after the held lines and keep at most `maxLines`.
 *
 * The lines dropped are those at the far end from the page, which is
 * the end the view is moving away from. They load again when paging
 * comes back to them. A line the page repeats is kept once.
 */
export function addPage(
  held: readonly FileLine[],
  page: readonly FileLine[],
  direction: 'before' | 'after',
  maxLines: number,
): HeldWindow {
  const byNumber = new Map<number, FileLine>();
  for (const line of held) byNumber.set(line.lineNumber, line);
  for (const line of page) byNumber.set(line.lineNumber, line);
  const merged = Array.from(byNumber.values()).sort((a, b) => a.lineNumber - b.lineNumber);

  const excess = merged.length - maxLines;
  if (excess <= 0) return { lines: merged, droppedBefore: false, droppedAfter: false };
  if (direction === 'after') {
    return { lines: merged.slice(excess), droppedBefore: true, droppedAfter: false };
  }
  return { lines: merged.slice(0, maxLines), droppedBefore: false, droppedAfter: true };
}

/** The part of a window the editor numbers from: its first file line and its size. */
export interface EditorWindow {
  startLine: number;
  lineCount: number;
}

/**
 * The editor line that shows the same file line once the window moved.
 *
 * The editor numbers its lines from 1 at the window's first line, so a
 * page added at the start or lines dropped there shift every editor
 * line. Keeping the line at the top of the view on the same file line
 * keeps the screen still. Null when the new window does not hold that
 * file line, as after a jump to another part of the file.
 */
export function editorLineAfterMove(
  editorLine: number,
  previousStartLine: number,
  next: EditorWindow,
): number | null {
  const fileLine = previousStartLine + editorLine - 1;
  const nextEditorLine = fileLine - next.startLine + 1;
  if (nextEditorLine < 1 || nextEditorLine > next.lineCount) return null;
  return nextEditorLine;
}
