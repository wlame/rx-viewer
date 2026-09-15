/**
 * How the analysis report names detectors and colours severities, from
 * the backend's own `/v1/detectors` answer.
 *
 * Detector sets and category names differ between backends, so no name
 * is written into the viewer: a detector the list knows shows its
 * category and description, any other name shows as itself. Severity
 * colours follow the levels of the answer's `severity_scale`, so the
 * colour cut-offs are the backend's, not the viewer's.
 */
import type { CategoryInfo, DetectorInfo, SeverityLevel } from '../types';

/** Colour classes for the scale's levels, counted from the highest level down. */
const SEVERITY_CLASSES_FROM_TOP = [
  'text-red-600 dark:text-red-400',
  'text-orange-500 dark:text-orange-400',
  'text-yellow-600 dark:text-yellow-400',
];

/** Colour of every lower level, and of every severity while the scale is unknown. */
const MUTED_SEVERITY_CLASS = 'text-gh-fg-muted dark:text-gh-fg-dark-muted';

/** A severity's place on the scale: its level and the level's rank from the top (0). */
interface ScalePosition {
  level: SeverityLevel;
  rankFromTop: number;
}

/**
 * Finds the level a severity falls in. Neighbouring levels share their
 * bound (0.4 is the top of "low" and the bottom of "medium"); the bound
 * belongs to the higher level. The scale may come in either order.
 */
function scalePosition(severity: number, scale: readonly SeverityLevel[]): ScalePosition | null {
  const ascending = [...scale].sort((a, b) => a.min - b.min);
  for (let i = ascending.length - 1; i >= 0; i--) {
    if (severity >= ascending[i].min) {
      return { level: ascending[i], rankFromTop: ascending.length - 1 - i };
    }
  }
  return null;
}

/** The scale level a severity falls in, or null when the scale is empty. */
export function severityLevel(
  severity: number,
  scale: readonly SeverityLevel[],
): SeverityLevel | null {
  return scalePosition(severity, scale)?.level ?? null;
}

/** The text colour classes of a severity, by its level on the scale. */
export function severityClass(severity: number, scale: readonly SeverityLevel[]): string {
  const position = scalePosition(severity, scale);
  if (!position) return MUTED_SEVERITY_CLASS;
  return SEVERITY_CLASSES_FROM_TOP[position.rankFromTop] ?? MUTED_SEVERITY_CLASS;
}

/** What the report shows for one detector. */
export interface DetectorLabel {
  /** The backend's detector name, shown as it is. */
  name: string;
  /** The detector's category, or null for a name the detector list lacks. */
  category: string | null;
  /** The detector's one-sentence description, or null when unknown. */
  description: string | null;
}

/** The label of a detector name; a name the list lacks shows as itself. */
export function detectorLabel(name: string, detectors: readonly DetectorInfo[]): DetectorLabel {
  const info = detectors.find((d) => d.name === name);
  return {
    name,
    category: info?.category ?? null,
    description: info?.description ?? null,
  };
}

/** The one-sentence description of a category, or null for one the list lacks. */
export function categoryDescription(
  name: string,
  categories: readonly CategoryInfo[],
): string | null {
  return categories.find((c) => c.name === name)?.description ?? null;
}

/** One entry of an analysis summary: a labelled key and its anomaly count. */
export interface SummaryEntry extends DetectorLabel {
  count: number;
}

/**
 * The entries of an index's `anomaly_summary`, in the summary's order.
 * rx-go keys the summary by detector; a key that names no detector (an
 * older backend keys it by category) shows as itself.
 */
export function summaryEntries(
  summary: Record<string, number> | null | undefined,
  detectors: readonly DetectorInfo[],
): SummaryEntry[] {
  return Object.entries(summary ?? {}).map(([key, count]) => ({
    ...detectorLabel(key, detectors),
    count,
  }));
}
