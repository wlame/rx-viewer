/**
 * The one check a tab makes when it shows a line again after its files
 * may have changed under it (a change on disk, a reload in another zone,
 * the end of an index task, a chain that is no chain any more, a mode
 * switch): is the line it shows the line it knew there?
 *
 * The text decides when the tab knew it: a zone change moves every time
 * and never a text. Else the time decides. A tab that knew neither can
 * tell nothing. A line the tab does not hold is another line.
 */
import type { FileLine, OpenFile } from '../types';

/** What a tab knew of a line: its text and its timestamp, each null when the tab did not know it. */
export interface KnownLine {
  text: string | null;
  timeMs: number | null;
}

/** How a shown line compares with the line a tab knew: the same, another one, or unknown. */
export type LineCheck = 'same' | 'other' | 'unknown';

/** Compare the line a tab shows (null when it holds none there) with the line it knew there. */
export function checkShownLine(
  shown: Pick<FileLine, 'content' | 'timestampMs'> | null,
  known: KnownLine,
): LineCheck {
  if (known.text === null && known.timeMs === null) return 'unknown';
  if (shown === null) return 'other';
  if (known.text !== null) return shown.content === known.text ? 'same' : 'other';
  return (shown.timestampMs ?? null) === known.timeMs ? 'same' : 'other';
}

/** The line a tab holds at the position `line`, or null when it does not hold it. */
export function heldLineAt(
  tab: Pick<OpenFile, 'lines' | 'startLine'>,
  line: number,
): FileLine | null {
  const held = tab.lines[line - tab.startLine];
  return held?.lineNumber === line ? held : null;
}

/**
 * The notice for a file tab a log chain's tab became (chain mode turned
 * off, or a chain that is no chain or no valid chain any more), opened at
 * `line`, when that line is not the line the chain's tab (`chainName`)
 * knew there: its file changed on disk meanwhile. Null when it is the
 * same line, when nothing is known to compare, and while the file tab
 * shows an error of its own.
 */
export function fileLineNotice(
  tab: OpenFile | undefined,
  line: number,
  known: KnownLine,
  chainName: string,
): string | null {
  if (!tab || tab.error !== null) return null;
  const shown = heldLineAt(tab, line);
  if (checkShownLine(shown, known) !== 'other') return null;
  return shown === null
    ? `${tab.name} holds no line ${line} now, where ${chainName} showed one: the file changed on disk`
    : `Line ${line} of ${tab.name} holds other text than ${chainName} showed there: the file changed on disk`;
}
