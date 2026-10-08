/**
 * The one check a tab makes when it shows a line again after its files
 * may have changed under it (a change on disk, a reload in another zone,
 * the end of an index task, a chain that is no chain any more, a mode
 * switch): is the line it shows the line it knew there?
 *
 * A tab that knew the text and the time of a line knows it again only by
 * both: two lines may hold one text (a blank line, a repeated `\tat …`
 * frame), but not at one time as well. A time is known only in the zone
 * it was read in (`knownInZone`), since a zone moves every time and never
 * a text; and a shown line without a time (one the backend did not
 * compute, such as a part's first lines before its chain is ready) leaves
 * the text to decide. A tab that knew only the time compares the time. A
 * tab that knew neither can tell nothing. A line the tab does not hold is
 * another line.
 */
import type { FileLine, OpenFile } from '../types';
import { nearestHeldLine } from './chainWindow';

/** What a tab knew of a line: its text and its timestamp, each null when the tab did not know it. */
export interface KnownLine {
  text: string | null;
  timeMs: number | null;
  /**
   * In a log chain: the part and the line in it that hold the line, when
   * that is known too (a link names them). A line elsewhere is another
   * line, whatever its text or time.
   */
  place?: { part: string; line: number } | null;
}

/** How a shown line compares with the line a tab knew: the same, another one, or unknown. */
export type LineCheck = 'same' | 'other' | 'unknown';

/** Compare the line a tab shows (null when it holds none there) with the line it knew there. */
export function checkShownLine(
  shown: Pick<FileLine, 'content' | 'timestampMs' | 'part' | 'localLine'> | null,
  known: KnownLine,
): LineCheck {
  if (known.text === null && known.timeMs === null) return 'unknown';
  if (shown === null) return 'other';
  const place = known.place ?? null;
  if (place !== null && (shown.part !== place.part || shown.localLine !== place.line)) {
    return 'other';
  }
  const shownTime = shown.timestampMs ?? null;
  if (known.text === null) return shownTime === known.timeMs ? 'same' : 'other';
  if (shown.content !== known.text) return 'other';
  const isTimeSame = known.timeMs === null || shownTime === null || shownTime === known.timeMs;
  return isTimeSame ? 'same' : 'other';
}

/**
 * `known` as a line read in `shownZone` compares with it: with its time
 * only when that time was read in `knownZone` and the two zones are one
 * (null for a file read as its lines write times), since a zone moves
 * every time and never a text.
 */
export function knownInZone(
  known: KnownLine,
  knownZone: string | null,
  shownZone: string | null,
): KnownLine {
  return knownZone === shownZone ? known : { ...known, timeMs: null };
}

/**
 * The position of the held line nearest to `target` that is the known
 * line, as `checkShownLine` reads one apart from its place: with the
 * known text, at the known time too where both are known; with no text
 * known, at the known time on the known place's line (a file a rotation
 * renamed keeps its lines' numbers). The target itself, else the nearest
 * on either side, the one after it when two are as near (the line a
 * time names is the first at or after it, so a line with the same time
 * and text is more often after it). Null when no held line is the known
 * one, the held lines do not hold the target, or nothing is known.
 */
export function nearestKnownLine(
  lines: readonly FileLine[],
  startLine: number,
  target: number,
  known: KnownLine,
): number | null {
  const { text, timeMs } = known;
  if (text !== null) {
    const sameLine: KnownLine = { text, timeMs, place: null };
    const isKnown = (held: FileLine) => checkShownLine(held, sameLine) === 'same';
    return nearestHeldLine(lines, startLine, target, isKnown);
  }
  const line = known.place?.line;
  if (timeMs === null || line === undefined) return null;
  const isKnown = (held: FileLine) => held.timestampMs === timeMs && held.localLine === line;
  return nearestHeldLine(lines, startLine, target, isKnown);
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
