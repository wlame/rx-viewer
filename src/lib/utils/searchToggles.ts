/**
 * The search panel's three toggles, with the meaning every editor search
 * box gives them: on means "match case", "match whole word" and "use
 * regular expression". Each one maps to a ripgrep matching flag that the
 * trace request sends when the toggle is away from ripgrep's default.
 */
import type { TraceMatchingFlags } from '../types';

export interface SearchToggles {
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
}

/** ripgrep's defaults: case-sensitive regular expressions, matching anywhere. */
export const DEFAULT_SEARCH_TOGGLES: Readonly<SearchToggles> = {
  matchCase: true,
  wholeWord: false,
  regex: true,
};

export interface SearchToggleSpec {
  key: keyof SearchToggles;
  /** Button text, as editors show it. */
  label: string;
  /** Accessible name and first part of the tooltip. */
  title: string;
  /** The trace parameter this toggle controls. */
  param: keyof TraceMatchingFlags;
  /** The ripgrep flag behind the parameter, for the tooltip. */
  ripgrepFlag: string;
  /** The toggle state that sends the parameter. */
  sendsWhen: boolean;
  /** `KeyboardEvent.code` that toggles it with Alt, as in VS Code. */
  shortcutCode: string;
}

export const SEARCH_TOGGLES: readonly SearchToggleSpec[] = [
  {
    key: 'matchCase',
    label: 'Aa',
    title: 'Match case',
    param: 'ignore_case',
    ripgrepFlag: '-i',
    sendsWhen: false,
    shortcutCode: 'KeyC',
  },
  {
    key: 'wholeWord',
    label: 'ab',
    title: 'Match whole word',
    param: 'word_regexp',
    ripgrepFlag: '-w',
    sendsWhen: true,
    shortcutCode: 'KeyW',
  },
  {
    key: 'regex',
    label: '.*',
    title: 'Use regular expression',
    param: 'fixed_strings',
    ripgrepFlag: '-F',
    sendsWhen: false,
    shortcutCode: 'KeyR',
  },
];

/** The trace parameters the toggles turn on; empty at the defaults. */
export function matchingFlagParams(toggles: SearchToggles): TraceMatchingFlags {
  const params: TraceMatchingFlags = {};
  for (const spec of SEARCH_TOGGLES) {
    if (toggles[spec.key] === spec.sendsWhen) params[spec.param] = true;
  }
  return params;
}

/**
 * The toggle states that send `flags`: the inverse of matchingFlagParams,
 * for rebuilding the panel from a URL. A toggle whose parameter is absent
 * is at its default, which is always the state that does not send it.
 */
export function togglesFromFlags(flags: TraceMatchingFlags): SearchToggles {
  const toggles = { ...DEFAULT_SEARCH_TOGGLES };
  for (const spec of SEARCH_TOGGLES) {
    toggles[spec.key] = flags[spec.param] ? spec.sendsWhen : !spec.sendsWhen;
  }
  return toggles;
}

/**
 * The tooltip of a toggle: its name, its shortcut, and which state sends
 * which ripgrep flag, so the equivalent command is never a guess.
 */
export function toggleTooltip(spec: SearchToggleSpec): string {
  const key = spec.shortcutCode.replace('Key', '');
  const state = spec.sendsWhen ? 'On' : 'Off';
  return `${spec.title} (Alt+${key}). ${state}: ripgrep ${spec.ripgrepFlag}`;
}
