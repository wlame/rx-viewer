/**
 * The times of a log chain as the time features of its tab read them:
 * the one layout its times are written in, its time axis, the part that
 * holds an instant, and why the tab cannot be moved by time yet.
 *
 * A chain is read as one file holding its parts in order would be: a
 * typed time is read in the format of its first part with timestamps
 * (rx-go reads a query that way), so its times are written in that
 * part's layout too. Everything here is pure; the layout of a
 * description is worked out once.
 */
import type { ChainPart, ChainResponse, ChainTab } from '../types';
import { isEmptyPart } from './chainParts';
import { partTimeLayout } from './chainZones';
import type { TimeAxis } from './timeline';
import type { FileTimeLayout } from './timeFormat';

const layouts = new WeakMap<ChainResponse, FileTimeLayout | null>();

/**
 * The layout a chain's times are written in: that of its first part, in
 * the chain's order, with lines and a known timestamp format, shown in
 * the zone the chain is read in; null when no part names a format. The
 * same object for the same description.
 */
export function chainTimeLayout(chain: ChainResponse): FileTimeLayout | null {
  if (layouts.has(chain)) return layouts.get(chain) ?? null;
  const first = chain.parts.find((part) => !isEmptyPart(part) && part.time_format !== null);
  const layout = first ? partTimeLayout(first) : null;
  layouts.set(chain, layout);
  return layout;
}

/** The axis of a ready chain, from its first to its last time; null while either is not known. */
export function chainTimeAxis(chain: ChainResponse): TimeAxis | null {
  if (chain.state !== 'ready' || chain.first_ms === null || chain.last_ms === null) return null;
  return { startMs: chain.first_ms, endMs: chain.last_ms };
}

/**
 * Why a chain's tab cannot be moved by time yet, or null when it can (the
 * chain is ready). A pending chain gives the backend's reason it has no
 * index task (from the last description or answer about one part), or
 * why its task failed, when it knows one.
 */
export function chainTimeRefusal(
  name: string,
  tab: Pick<ChainTab, 'description' | 'indexProblem'> & Partial<Pick<ChainTab, 'buildRefused'>>,
): string | null {
  const chain = tab.description;
  if (chain === null) return `The log chain ${name} is being read`;
  if (chain.state === 'ready') return null;
  if (chain.state === 'invalid') {
    const codes = chain.reasons.map((reason) => reason.code).join(', ');
    return `${name} is not a valid log chain${codes ? `: ${codes}` : ''}`;
  }
  const why =
    tab.buildRefused ??
    chain.index_build_refused ??
    tab.indexProblem ??
    'the line indexes of its parts are being built';
  return `${name} is not ready: ${why}`;
}

/** Why a chain has no time axis: which end of a ready chain is not known, or no range yet. */
export function chainRangeUnknownReason(name: string, chain: ChainResponse): string {
  if (chain.state === 'ready' && chain.first_ms === null) {
    return `The first time of ${name} is not known`;
  }
  if (chain.state === 'ready' && chain.last_ms === null) {
    return `The last time of ${name} is not known`;
  }
  return `The time range of ${name} is not known yet`;
}

/**
 * The part that holds the instant `ms`: the last part with lines whose
 * first time is at or before it, so an instant in a gap belongs to the
 * part before the gap and one before the chain to its first part. Null
 * when no part's first time is known.
 */
export function partAtTime(chain: ChainResponse, ms: number): ChainPart | null {
  let holder: ChainPart | null = null;
  for (const part of chain.parts) {
    if (part.first_ms === null || isEmptyPart(part)) continue;
    if (holder !== null && part.first_ms > ms) break;
    holder = part;
  }
  return holder;
}
