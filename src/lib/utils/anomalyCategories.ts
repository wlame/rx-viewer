/**
 * Anomaly counts per category, for the editor's category chips.
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
