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
