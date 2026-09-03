/**
 * Rewrites raw log lines into the single string Monaco renders.
 *
 * Two transformations happen here, and both are why this is not a
 * one-liner:
 *
 * - Carriage returns. Monaco treats a lone \r as a line break, which
 *   would shift every line number after it. With invisible characters
 *   shown, a \r becomes U+240D so the user can see it; otherwise it is
 *   dropped entirely.
 * - The hide and show filter modes. Both replace text with a hair space
 *   (U+200A) and record what was replaced, so the editor can show the
 *   original in a hover. The key is "monacoLine:markerIndex", counting
 *   markers left to right on that line.
 *
 * The highlight mode is absent on purpose: it changes no text, so the
 * editor draws it with decorations instead.
 *
 * Returning the hidden-content map rather than assigning it to a
 * component variable is what makes this testable — and it removes the
 * ordering trap where a caller read the map before calling this.
 */

import type { RegexFilter } from '$lib/types';

/** A line as the editor holds it. Only `content` is read here. */
export interface EditorLine {
  content: string;
}

export interface ProcessedContent {
  /** The text handed to Monaco, newline-joined. */
  content: string;
  /** "monacoLine:markerIndex" to the text that marker replaced. */
  hiddenContent: Map<string, string>;
}

/** Hair space. Narrow enough to read as a gap, wide enough to hover. */
export const HIDDEN_MARKER = '\u200A';

/** Monaco renders a lone \r as a line break; U+240D shows it instead. */
const CR_SYMBOL = '\u240D';

export function processContent(
  lines: readonly EditorLine[],
  regexFilter: RegexFilter | null | undefined,
  showInvisibleChars: boolean,
): ProcessedContent {
  const hiddenContent = new Map<string, string>();

  const processedLines = showInvisibleChars
    ? lines.map((l) => l.content.replace(/\r/g, CR_SYMBOL))
    : lines.map((l) => l.content.replace(/\r/g, ''));

  const rawContent = processedLines.join('\n');

  // Apply regex filter for hide/show modes (not highlight - that uses decorations)
  if (regexFilter?.enabled && regexFilter?.compiledRegex) {
    const mode = regexFilter.mode;
    const pattern = regexFilter.pattern;

    // Check if regex has capturing groups
    const hasGroups = /\([^?]/.test(pattern) || /\(\?</.test(pattern);

    if (mode === 'hide') {
      // Hide matching groups (or entire match if no groups) - replace with marker
      try {
        const resultLines: string[] = [];

        processedLines.forEach((lineContent, lineIdx) => {
          const monacoLine = lineIdx + 1;
          const lineRegex = new RegExp(pattern, 'g');
          let match;

          // Collect all group matches with their positions
          const replacements: Array<{ start: number; end: number; text: string }> = [];

          while ((match = lineRegex.exec(lineContent)) !== null) {
            if (hasGroups && match.length > 1) {
              // Find and replace each captured group
              let matchOffset = match.index;
              for (let i = 1; i < match.length; i++) {
                if (match[i] !== undefined) {
                  const groupText = match[i];
                  const groupStart = lineContent.indexOf(groupText, matchOffset);
                  if (groupStart !== -1) {
                    replacements.push({
                      start: groupStart,
                      end: groupStart + groupText.length,
                      text: groupText,
                    });
                    matchOffset = groupStart + groupText.length;
                  }
                }
              }
            } else {
              // No groups - hide entire match
              replacements.push({
                start: match.index,
                end: match.index + match[0].length,
                text: match[0],
              });
            }
          }

          // Sort by position and apply replacements from end to start
          replacements.sort((a, b) => b.start - a.start);

          let result = lineContent;
          // Store in reverse order but with forward marker indices
          const reversedReplacements = [...replacements];
          for (let i = reversedReplacements.length - 1; i >= 0; i--) {
            const rep = reversedReplacements[i];
            // Key is line:markerIndex (0-based index of marker on this line)
            const key = `${monacoLine}:${reversedReplacements.length - 1 - i}`;
            hiddenContent.set(key, rep.text);
          }

          // Apply replacements from end to start
          for (const rep of replacements) {
            result = result.substring(0, rep.start) + HIDDEN_MARKER + result.substring(rep.end);
          }

          resultLines.push(result);
        });

        return { content: resultLines.join('\n'), hiddenContent };
      } catch (e) {
        return { content: rawContent, hiddenContent };
      }
    } else if (mode === 'show') {
      // Show only matching groups (or entire match if no groups) - replace non-matching parts with marker
      try {
        const resultLines: string[] = [];

        processedLines.forEach((lineContent, lineIdx) => {
          const monacoLine = lineIdx + 1;
          const lineRegex = new RegExp(pattern, 'g');
          let match;

          // Collect all "show" ranges (captured groups or entire matches)
          const showRanges: Array<{ start: number; end: number; text: string }> = [];

          while ((match = lineRegex.exec(lineContent)) !== null) {
            if (hasGroups && match.length > 1) {
              // Find actual positions of each captured group within the line
              let searchStart = match.index;
              for (let i = 1; i < match.length; i++) {
                if (match[i] !== undefined) {
                  const groupText = match[i];
                  const groupStart = lineContent.indexOf(groupText, searchStart);
                  if (groupStart !== -1) {
                    showRanges.push({
                      start: groupStart,
                      end: groupStart + groupText.length,
                      text: groupText,
                    });
                    searchStart = groupStart + groupText.length;
                  }
                }
              }
            } else {
              // No groups - show entire match
              showRanges.push({
                start: match.index,
                end: match.index + match[0].length,
                text: match[0],
              });
            }
          }

          // Build segments: alternating between hidden and shown parts
          const segments: Array<{ isMatch: boolean; text: string }> = [];
          let lastEnd = 0;

          // Sort showRanges by start position
          showRanges.sort((a, b) => a.start - b.start);

          for (const range of showRanges) {
            // Add hidden segment before this show range
            if (range.start > lastEnd) {
              segments.push({
                isMatch: false,
                text: lineContent.substring(lastEnd, range.start),
              });
            }
            // Add the shown segment
            segments.push({
              isMatch: true,
              text: range.text,
            });
            lastEnd = range.end;
          }

          // Add remaining hidden segment after last show range
          if (lastEnd < lineContent.length) {
            segments.push({
              isMatch: false,
              text: lineContent.substring(lastEnd),
            });
          }

          // Build result line
          if (segments.length === 0) {
            // No matches - entire line is hidden
            if (lineContent.length > 0) {
              const key = `${monacoLine}:0`;
              hiddenContent.set(key, lineContent);
              resultLines.push(HIDDEN_MARKER);
            } else {
              resultLines.push('');
            }
          } else {
            let resultLine = '';
            let markerIndex = 0;

            for (const seg of segments) {
              if (seg.isMatch) {
                resultLine += seg.text;
              } else if (seg.text.length > 0) {
                // Hidden segment (including whitespace-only)
                const key = `${monacoLine}:${markerIndex}`;
                hiddenContent.set(key, seg.text);
                resultLine += HIDDEN_MARKER;
                markerIndex++;
              }
            }

            resultLines.push(resultLine || HIDDEN_MARKER);
          }
        });

        return { content: resultLines.join('\n'), hiddenContent };
      } catch (e) {
        return { content: rawContent, hiddenContent };
      }
    }
  }

  return { content: rawContent, hiddenContent };
}
