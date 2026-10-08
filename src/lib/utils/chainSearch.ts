/**
 * A search in chain mode (`GET /v1/logs/trace`): where each match sits
 * in its log chain, where a click takes the chain's tab, and which held
 * lines of that tab the search marks.
 *
 * A chain search answers like a trace, plus a `chains` table and, on each
 * match, the id of its chain and its global line in it (`chain_line`, -1
 * when the answer cannot give it: a pending or invalid chain, or a match
 * whose own line number is -1). A match keeps its part's own path, line
 * number and byte offset, so the rest of the search panel reads it as it
 * reads a trace match.
 */
import type { ChainPosition } from '../stores/chainTabs';
import type {
  ChainState,
  ChainTraceResponse,
  FileLine,
  FileMatch,
  OpenFile,
  SearchMatch,
  SearchResponse,
} from '../types';

/** Whether `response` is a chain search's answer rather than a trace's. */
export function isChainSearchAnswer(response: SearchResponse): response is ChainTraceResponse {
  return 'chains' in response;
}

/** Where a chain search places a match: its chain and the part it is in. */
export interface ChainMatchPlace {
  /** The chain's handle: its directory joined with its name. */
  handle: string;
  /** The chain's name, as its rows and its tab show it. */
  name: string;
  /** The chain's state when the search described it. */
  state: ChainState;
  /** The match's global line in its chain, or null when the answer does not give it. */
  chainLine: number | null;
  /** The name of the part the match is in: the last element of its path. */
  part: string;
  /**
   * The fingerprint of the chain's files when the search read them: a
   * chain whose files changed since numbers its parts and lines otherwise.
   */
  fingerprint: string;
}

/** The last element of a path. */
function fileNameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/**
 * The chain and part of `match`, or null for a file searched on its own,
 * for any match of a trace answer, and for a match whose chain or file
 * the answer's tables do not hold.
 */
export function chainPlaceOf(match: SearchMatch, response: SearchResponse): ChainMatchPlace | null {
  if (!isChainSearchAnswer(response) || !match.chain) return null;
  if (!Object.hasOwn(response.chains, match.chain) || !Object.hasOwn(response.files, match.file)) {
    return null;
  }
  const chain = response.chains[match.chain];
  const chainLine = match.chain_line ?? -1;
  return {
    handle: chain.path,
    name: chain.name,
    state: chain.state,
    chainLine: chainLine >= 1 ? chainLine : null,
    part: fileNameOf(response.files[match.file]),
    fingerprint: chain.fingerprint,
  };
}

/** Why a match of a chain in each state has no line in the chain. */
const NO_CHAIN_LINE: Record<ChainState, string> = {
  pending: 'no line in the chain while its parts are being indexed',
  // A ready chain gives a line to every match the search numbered.
  ready: 'the search gave this match no line number, so it has no line in the chain',
  invalid: 'no line in the chain, which is invalid',
};

/** The tooltip of a chain match's part when the answer gives the match no chain line. */
export function noChainLineTitle(place: ChainMatchPlace): string {
  return `${place.part}, a part of the log chain ${place.name}: ${NO_CHAIN_LINE[place.state]}`;
}

/**
 * Whether a click on a match opens its chain's tab. It does while chain
 * mode is on and the chain can be read. Otherwise the match's part opens
 * as the file it is: with the mode off a chain's tab cannot open, and an
 * invalid chain's tab shows no lines.
 */
export function opensChainTab(
  place: ChainMatchPlace | null,
  isModeOn: boolean,
): place is ChainMatchPlace {
  return place !== null && isModeOn && place.state !== 'invalid';
}

/**
 * Where the chain's tab goes for a match whose line in its part is
 * `localLine`: its global line when the answer gives one, else that line
 * of the part, which a chain's tab reaches in every state.
 */
export function chainPositionOf(place: ChainMatchPlace, localLine: number): ChainPosition {
  if (place.chainLine !== null) return { kind: 'global', line: place.chainLine };
  return { kind: 'local', part: place.part, line: localLine };
}

/**
 * The marks of the chain `handle`'s tab: each of its matches whose line
 * in its part `localLineOf` knows, by part and that line.
 */
export function chainTabMatches(
  response: SearchResponse,
  handle: string,
  localLineOf: (match: SearchMatch) => number | null,
): FileMatch[] {
  const marks: FileMatch[] = [];
  for (const match of response.matches) {
    const place = chainPlaceOf(match, response);
    if (place?.handle !== handle) continue;
    const line = localLineOf(match);
    if (line === null) continue;
    marks.push({
      lineNumber: line,
      part: place.part,
      patternId: match.pattern,
      pattern: Object.hasOwn(response.patterns, match.pattern)
        ? response.patterns[match.pattern]
        : match.pattern,
    });
  }
  return marks;
}

/** One key per part and line in it; a line number holds no `:`, so no two pairs share a key. */
function partLineKey(part: string, line: number): string {
  return `${line}:${part}`;
}

/**
 * The positions of the held lines of a chain's tab that `matches` mark.
 * Each held line names its part and its line in it, so a mark lands on
 * the same text in global and in part-local numbering. One pass over the
 * held lines.
 */
export function chainMatchedLines(
  lines: readonly FileLine[],
  matches: readonly FileMatch[],
): number[] {
  const marked = new Set<string>();
  for (const match of matches) {
    if (match.part !== undefined) marked.add(partLineKey(match.part, match.lineNumber));
  }
  if (marked.size === 0) return [];
  const positions: number[] = [];
  for (const line of lines) {
    if (line.part === undefined || line.localLine === undefined) continue;
    if (marked.has(partLineKey(line.part, line.localLine))) positions.push(line.lineNumber);
  }
  return positions;
}

/**
 * The lines of a tab that its search matches mark, by the tab's own
 * numbering: a file's matches at their lines, a chain's at the held
 * lines of their parts.
 */
export function matchedTabLines(
  tab: Pick<OpenFile, 'lines'> & { chain?: unknown },
  matches: readonly FileMatch[],
): number[] {
  if (tab.chain) return chainMatchedLines(tab.lines, matches);
  return matches.map((match) => match.lineNumber);
}
