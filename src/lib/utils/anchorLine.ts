/**
 * The line the URL's `line` names for an open file: its anchor.
 *
 * The anchor is the line the user went to: the line a file was opened
 * at (line 1 when none was asked for), a go-to-line target, a search
 * match, an anomaly, the end of the file. It stays that line for as long
 * as the line is on screen. Once the user scrolls it out of view, the
 * anchor becomes the line at the center of the view; the editor reveals
 * a target in the center, so a link reopens the file showing the same
 * lines.
 *
 * The anchor is never the line at the center of the view while the
 * target is still visible: a file opened at line 1 shows line 1 at the
 * top, not in the center, and the center of a view that reveals line 169
 * can be line 168.
 */

/** The first and last file line on screen, both inclusive. */
export interface VisibleLines {
  first: number;
  last: number;
}

/** The anchor after the user scrolled the view to show `visible`. */
export function anchorAfterScroll(anchor: number, visible: VisibleLines): number {
  if (anchor >= visible.first && anchor <= visible.last) return anchor;
  return Math.floor((visible.first + visible.last) / 2);
}

/** What a loaded window tells about where the file ends. */
export interface WindowEnd {
  startLine: number;
  /** The last loaded line; below `startLine` when the window is empty. */
  endLine: number;
  /** The file ends inside or before the window. */
  reachedEnd: boolean;
}

/**
 * The anchor moved onto the file. A link may name a line the file does
 * not have; the backend's answer shows where the file ends, and a line
 * past it becomes the last line. A window that holds no line says
 * nothing about where the lines are and leaves the anchor as it is.
 */
export function clampAnchor(anchor: number, window: WindowEnd): number {
  if (window.endLine < window.startLine) return anchor;
  return window.reachedEnd && anchor > window.endLine ? window.endLine : anchor;
}
