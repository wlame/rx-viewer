/**
 * The pieces of the editor filter's pattern box that need no DOM: the
 * coloured copy of the pattern the overlay paints, and the line a
 * multi-line paste keeps.
 */
import Prism from 'prismjs';
import 'prismjs/components/prism-regex';

/** A run of the pattern and the classes the stylesheet colours it by. */
export interface HighlightPiece {
  text: string;
  /** Prism's `token <type> <alias>` classes, outer token first; empty for plain text. */
  className: string;
}

type PrismContent = string | Prism.Token | (string | Prism.Token)[];

/** Prism's own class list for one token: `token`, its type, its aliases. */
function tokenClasses(token: Prism.Token): string[] {
  const aliases = token.alias === undefined ? [] : [token.alias].flat();
  return ['token', token.type, ...aliases];
}

/** Append the leaves of `content` to `pieces`, each with its ancestors' classes. */
function collectPieces(content: PrismContent, inherited: string[], pieces: HighlightPiece[]) {
  if (typeof content === 'string') {
    if (content) pieces.push({ text: content, className: inherited.join(' ') });
    return;
  }
  if (Array.isArray(content)) {
    for (const part of content) collectPieces(part, inherited, pieces);
    return;
  }
  collectPieces(content.content, [...inherited, ...tokenClasses(content)], pieces);
}

/**
 * Split a regex pattern into runs coloured the way Prism's regex grammar
 * marks them. The runs' text, in order, is exactly `pattern`: they are
 * meant to be rendered as text nodes, so nothing in the pattern is ever
 * read as markup.
 *
 * Prism nests tokens (an escape inside a character class). A run carries
 * the classes of every token around it, outer first, so a stylesheet that
 * lists the inner token types after the outer ones colours it as the
 * nested markup would.
 */
export function regexHighlightPieces(pattern: string): HighlightPiece[] {
  if (!pattern) return [];
  const pieces: HighlightPiece[] = [];
  try {
    collectPieces(Prism.tokenize(pattern, Prism.languages.regex), [], pieces);
  } catch {
    return [{ text: pattern, className: '' }];
  }
  return pieces;
}

const LINE_BREAK = /\r\n|\r|\n/;

/** The text before the first line break of `text`, or all of it when it has none. */
export function firstLine(text: string): string {
  return text.split(LINE_BREAK, 1)[0];
}
