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

/** The months as a file's time names them, in English whatever the browser's language. */
const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const MINUTES_PER_HOUR = 60;

/** `n` with leading zeros to `width` digits. */
function padded(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/** The offset of `time`'s local zone from UTC, `+02:00` or `-02:30`. */
function utcOffset(time: Date): string {
  const minutesEast = -time.getTimezoneOffset();
  const sign = minutesEast < 0 ? '-' : '+';
  const minutes = Math.abs(minutesEast);
  return `${sign}${padded(Math.floor(minutes / MINUTES_PER_HOUR))}:${padded(minutes % MINUTES_PER_HOUR)}`;
}

/** A file's time as the files panel shows it, and as its tooltip spells it out. */
export interface FileTime {
  /** `Oct 8 14:31` in the year of `now`, `2025-12-27` in any other. */
  text: string;
  /** `2026-10-08 14:31:07 +02:00`: to the second, with the zone's offset. */
  full: string;
}

/**
 * A file's modification time (`modified_at`) in the browser's time zone:
 * month, day and minute when it falls in the year `now` is in there, its
 * date otherwise, and in full with seconds and the offset from UTC. A
 * value that is not a time gives empty text.
 */
export function formatFileTime(iso: string, now: Date = new Date()): FileTime {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return { text: '', full: '' };
  const time = new Date(ms);
  const year = time.getFullYear();
  const date = `${padded(year, 4)}-${padded(time.getMonth() + 1)}-${padded(time.getDate())}`;
  const clock = `${padded(time.getHours())}:${padded(time.getMinutes())}`;
  const text =
    year === now.getFullYear()
      ? `${MONTH_NAMES[time.getMonth()]} ${time.getDate()} ${clock}`
      : date;
  return { text, full: `${date} ${clock}:${padded(time.getSeconds())} ${utcOffset(time)}` };
}
