/**
 * Anomaly counts per category, and stepping between the anomalies of
 * one category, for the editor's category chips.
 *
 * The count is taken from the anomalies themselves rather than from the
 * index's `anomaly_summary`, whose keys differ by backend: rx-python
 * keys it by category and rx-go by detector name. Every anomaly carries
 * its category in both, and a chip selects anomalies by category, so
 * counting here is the one way the chips and the highlighting agree.
 */

/** The one field this module reads from an anomaly. */
interface Categorized {
  category: string;
}

/**
 * Counts anomalies per category, with categories in name order.
 *
 * Returns null for a file that was never analyzed (no anomaly list at
 * all), and an empty object for one analyzed with nothing found.
 */
export function countAnomaliesByCategory(
  anomalies: readonly Categorized[] | null | undefined,
): Record<string, number> | null {
  if (!anomalies) return null;

  const counts = new Map<string, number>();
  for (const anomaly of anomalies) {
    counts.set(anomaly.category, (counts.get(anomaly.category) ?? 0) + 1);
  }
  const names = [...counts.keys()].sort();
  return Object.fromEntries(names.map((name) => [name, counts.get(name) as number]));
}

/** The fields pickAnomalyTarget reads from an anomaly. */
interface Positioned extends Categorized {
  start_line: number;
}

/**
 * Picks the anomaly of `category` to show next, relative to the line at
 * the center of the view.
 *
 * "Next" is the first anomaly starting more than one line below the
 * center and "previous" the last starting more than one line above it,
 * so a step always moves off the anomaly the view is already centered
 * on. Past either end it wraps around. Returns null when the category
 * has no anomalies.
 */
export function pickAnomalyTarget<T extends Positioned>(
  anomalies: readonly T[] | null | undefined,
  category: string,
  centerLine: number,
  direction: 'next' | 'previous',
): T | null {
  const inCategory = (anomalies ?? [])
    .filter((anomaly) => anomaly.category === category)
    .sort((a, b) => a.start_line - b.start_line);
  if (inCategory.length === 0) return null;

  if (direction === 'next') {
    return inCategory.find((anomaly) => anomaly.start_line > centerLine + 1) ?? inCategory[0];
  }
  const above = inCategory.filter((anomaly) => anomaly.start_line < centerLine - 1);
  return above.length > 0 ? above[above.length - 1] : inCategory[inCategory.length - 1];
}
