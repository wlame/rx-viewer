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
 * Format a date string to relative time
 */
export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) {
    return 'just now';
  } else if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  } else if (diffHours < 24) {
    return `${diffHours}h ago`;
  } else if (diffDays < 7) {
    return `${diffDays}d ago`;
  } else {
    return date.toLocaleDateString();
  }
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

/**
 * Truncate a path to show the last N segments
 */
export function truncatePath(path: string, maxSegments: number = 3): string {
  const segments = path.split('/').filter(Boolean);
  if (segments.length <= maxSegments) {
    return path;
  }
  return '.../' + segments.slice(-maxSegments).join('/');
}
