import type { FileLine, OpenFile } from '../types';

/** How many lines one paging request loads from a plain or seekable file. */
export const LINES_PER_PAGE = 1000;

/**
 * How many lines one paging request loads from a compressed stream.
 * The backend decompresses a stream from the line index checkpoint
 * before a page, which can take seconds on a large file, so a stream
 * pages in fewer, larger requests.
 */
export const STREAM_LINES_PER_PAGE = 5000;

/** The compression formats, as the backend names them, that are always a stream. */
const STREAM_FORMATS: ReadonlySet<string> = new Set(['gzip', 'bz2', 'xz']);

/**
 * The page size the index's `file_type` gives. It is the only answer
 * that tells a seekable zstd file from a zstd stream: both are named
 * `zstd` everywhere else.
 */
const LINES_PER_PAGE_OF_FILE_TYPE: Record<NonNullable<OpenFile['fileType']>, number> = {
  text: LINES_PER_PAGE,
  binary: LINES_PER_PAGE,
  seekable_zstd: LINES_PER_PAGE,
  compressed: STREAM_LINES_PER_PAGE,
};

/** What the page size of a file depends on. */
export type PagedFile = Pick<OpenFile, 'isCompressed' | 'compressionFormat' | 'fileType'>;

/**
 * How many lines one paging request loads from `file`: 5,000 from a
 * gzip, bzip2 or xz file and from a zstd file its index calls a stream,
 * 1,000 from any other. A zstd file whose index is not known yet pages
 * as a seekable one; its pages within the start of the file are cheap
 * either way, and the index that makes a later page cheap tells which
 * it is.
 */
export function linesPerPage(file: PagedFile): number {
  if (file.fileType) return LINES_PER_PAGE_OF_FILE_TYPE[file.fileType];
  const isStream =
    file.isCompressed &&
    file.compressionFormat !== null &&
    STREAM_FORMATS.has(file.compressionFormat);
  return isStream ? STREAM_LINES_PER_PAGE : LINES_PER_PAGE;
}

/**
 * How many pages of lines an open file holds at most.
 *
 * A page is what one paging request loads (`linesPerPage`). Paging
 * starts when the view comes within 200 px of an edge of the held
 * lines, so right after a page arrives the view sits about one page
 * from that edge. Five pages leave about four pages of lines already
 * seen behind the view, which the user can scroll back through without
 * a request, and they bound what every page costs: the filter
 * re-processes the held lines and Monaco receives all of them. A file
 * holds 5,000 lines, and a compressed stream 25,000: its pages are the
 * expensive ones to load again.
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
