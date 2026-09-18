/**
 * Iterating the matches of a user's regex over one line of text.
 *
 * Every filter mode goes through `matchesIn` rather than its own
 * `exec` loop. A hand-written loop has to step `lastIndex` past an
 * empty match itself, or a pattern such as `^`, `\d*` or `x?` matches at
 * the same index forever and freezes the tab.
 */

/**
 * Every match of `regex` in `text`, left to right, empty matches included.
 *
 * `String.prototype.matchAll` steps one code point past an empty match
 * (a whole surrogate pair when the regex has the `u` or `v` flag), so the
 * iteration always ends. It runs on a fresh copy with the `g` flag added
 * when missing, so the caller's regex is neither required to be global nor
 * read or moved through its `lastIndex`.
 */
export function matchesIn(text: string, regex: RegExp): Iterable<RegExpExecArray> {
  const flags = regex.global ? regex.flags : `${regex.flags}g`;
  return text.matchAll(new RegExp(regex, flags));
}

/** The part of a line that a match, or one of its captured groups, covers. */
export interface MatchedSpan {
  start: number;
  end: number;
  text: string;
}

/**
 * The spans of `text` a filter acts on: each captured group of each
 * match when the pattern has groups, each whole match otherwise. Empty
 * spans are included; the caller decides what an empty one means.
 *
 * A group's position comes from the match's indices (the `d` flag), so a
 * group lands where it matched even when its text also occurs earlier in
 * the match. Whether the pattern has groups is read from the match
 * itself, so an escaped paren or a paren in a class is not a group. A
 * group that took no part in the match has no span, and a group nested
 * in one already taken is left out, so the spans of a match never overlap.
 */
export function matchedSpans(text: string, regex: RegExp): MatchedSpan[] {
  const withIndices = regex.hasIndices ? regex : new RegExp(regex, `${regex.flags}d`);
  const spans: MatchedSpan[] = [];
  for (const match of matchesIn(text, withIndices)) {
    if (match.length === 1) {
      spans.push({ start: match.index, end: match.index + match[0].length, text: match[0] });
      continue;
    }
    let takenUpTo = match.index;
    for (let group = 1; group < match.length; group++) {
      const range = match.indices?.[group];
      if (range === undefined || range[0] < takenUpTo) continue;
      spans.push({ start: range[0], end: range[1], text: match[group] });
      takenUpTo = range[1];
    }
  }
  return spans;
}
