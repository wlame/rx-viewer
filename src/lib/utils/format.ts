/**
 * Formatting utilities
 */

/**
 * Format bytes to human-readable size
 */
export function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

/**
 * Format a number with thousands separator
 */
export function formatNumber(num: number): string {
  return num.toLocaleString();
}

/**
 * A count with its noun, singular for exactly one: "1 file", "2,461 matches".
 * The plural defaults to the singular plus "s".
 */
export function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`;
}

/** What a statistic the backend could not compute is shown as. */
export const ABSENT_STATISTIC = '—';

/**
 * A statistic with one decimal, or a dash when the backend left it null
 * because it could not compute it.
 */
export function formatStatistic(value: number | null): string {
  return value === null ? ABSENT_STATISTIC : value.toFixed(1);
}

/** A zone at the end of an ISO 8601 time: `Z`, `+02:00` or `-0000`. */
const TIME_ZONE_SUFFIX = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/** The date and time of a zone-less ISO 8601 value, down to the second. */
const LOCAL_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/;

/**
 * A time the backend wrote. One with a zone (rx-go writes UTC with `Z`)
 * is shown in the browser's zone. One without (rx-python writes the
 * server's local time) names no zone the browser could convert from, so
 * it is shown as written and marked as the server's time; reading it as
 * browser time would shift it by the difference between the two zones.
 * Text that is not a time is shown unchanged.
 */
export function formatServerTime(value: string): string {
  if (TIME_ZONE_SUFFIX.test(value)) {
    const time = new Date(value);
    return Number.isNaN(time.getTime()) ? value : time.toLocaleString();
  }
  const local = LOCAL_TIME.exec(value);
  return local ? `${local[1]} ${local[2]} (server time)` : value;
}
