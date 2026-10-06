import type { TimeRangeResponse } from '../types';

/**
 * Times shown the way a file writes them.
 *
 * A time range answer names the file's timestamp family and gives its
 * first timestamp as written (`example`). The family fixes the order of
 * the fields; the example fixes what the family leaves open: `T` or a
 * space before the time, the fraction's separator and digits, the zone
 * suffix, a 12-hour clock, and which fields are padded. Each family is
 * one row of `FAMILIES`: a reader of its examples and a writer of its
 * layout. The options are read once per answer.
 *
 * The instant is shown in the answer's `display_zone`, the zone the
 * file's own lines show: `UTC`, a fixed `±HH:MM` (offset arithmetic) or
 * an IANA name (`Intl.DateTimeFormat`, which knows its daylight-saving
 * changes).
 */

/** The timestamp families rx recognizes, as a time range answer names them. */
export type TimeFamily = 'iso' | 'clf' | 'ctime' | 'syslog' | 'slash' | 'dotted' | 'epoch';

/** What a time range answer says about how its file writes a time. */
export type FileTimeLayout = Pick<
  TimeRangeResponse,
  'format' | 'example' | 'display_zone' | 'day_first'
>;

/**
 * How a number is padded to two places: `zero` (`06`), `space` (` 6`,
 * the syslog and ctime day) or `none` (`6`).
 */
export type Padding = 'zero' | 'space' | 'none';

/** The padding of each two-place field. */
export interface FieldPadding {
  month: Padding;
  day: Padding;
  hour: Padding;
  minute: Padding;
  second: Padding;
}

/** The zone after the time, as the example writes it. */
export type ZoneStyle =
  | { kind: 'none' }
  /** `Z` at UTC; another offset is written `±HH:MM`. */
  | { kind: 'utcLetter' }
  /** `±HH:MM`, `±HHMM` or `±HH`, after a space when `space`. */
  | { kind: 'offset'; space: boolean; colon: boolean; minutes: boolean }
  /** ` UTC` or ` GMT` at UTC; another offset is written ` ±HH:MM`. */
  | { kind: 'utcWord'; text: string }
  /** A word rx does not read as a zone (` MST`), written as it is. */
  | { kind: 'text'; text: string };

/** The AM/PM of a 12-hour clock as the example writes it. */
export interface Meridiem {
  /** Whether a space comes before it. */
  space: boolean;
  lowerCase: boolean;
}

/** The choices a family leaves open, read from an example. */
export interface LayoutOptions {
  /** `T` or a space between the date and the time (iso). */
  dateTimeSeparator: 'T' | ' ';
  /** `-` or `/` between the numbers of the date (iso). */
  dateSeparator: '-' | '/';
  /** The separator before the fraction of a second; null when there is none. */
  fractionSeparator: '.' | ',' | ':' | null;
  /**
   * The digits of the fraction. Milliseconds after a `:` are a count, not
   * a fraction, and are always written with 3.
   */
  fractionDigits: number;
  zone: ZoneStyle;
  /** The 12-hour clock's AM/PM; null for a 24-hour clock. */
  meridiem: Meridiem | null;
  /** Whether a slash date starts with the day (from the answer's `day_first`). */
  dayFirst: boolean;
  /** The digits of a slash date's year. */
  yearDigits: 2 | 4;
  padding: FieldPadding;
}

/** A wall-clock reading of an instant in a zone. */
interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
  /** East of UTC. */
  offsetMinutes: number;
}

/** One family: how to read its examples and how to write its layout. */
interface FamilyRow {
  /** The options of this family when an example does not say otherwise. */
  defaults: Partial<LayoutOptions>;
  /**
   * The options an example of this family shows, or null when the
   * example is not one: an escaped byte, or another family's text.
   * `dayFirst` is the day order of a slash date.
   */
  read: (example: string, dayFirst: boolean) => Partial<LayoutOptions> | null;
  /** The wall clock in this family's layout. */
  write: (wall: WallClock, options: LayoutOptions) => string;
}

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

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

const MS_PER_MINUTE = 60_000;

const BASE_OPTIONS: LayoutOptions = {
  dateTimeSeparator: ' ',
  dateSeparator: '-',
  fractionSeparator: null,
  fractionDigits: 0,
  zone: { kind: 'none' },
  meridiem: null,
  dayFirst: false,
  yearDigits: 4,
  padding: { month: 'zero', day: 'zero', hour: 'zero', minute: 'zero', second: 'zero' },
};

// Readers of each family's examples. The groups they capture are named
// so the readers below share one way of turning them into options.
const CLOCK = String.raw`(?<hour>\d{1,2}):(?<minute>\d{1,2}):(?<second>\d{1,2})`;
const FRACTION = String.raw`(?:(?<fractionSeparator>[.,])(?<fraction>\d+))?`;

const ISO_EXAMPLE = new RegExp(
  String.raw`^\d{4}(?<dateSeparator>[-/])(?<month>\d{1,2})\k<dateSeparator>(?<day>\d{1,2})` +
    String.raw`(?<dateTimeSeparator>[T ])${CLOCK}` +
    String.raw`(?:(?<fractionSeparator>[.,])(?<fraction>\d+)|:(?<colonMillis>\d{1,3}))?` +
    String.raw`(?<zone>.*)$`,
);
const CLF_EXAMPLE = new RegExp(
  String.raw`^\[(?<day>\d{1,2})/[A-Za-z]{3}/\d{4}:${CLOCK} (?<zone>[+-]\d{2}:?\d{2})\]$`,
);
const CTIME_EXAMPLE = new RegExp(
  String.raw`^[A-Za-z]{3} [A-Za-z]{3}(?<dayGap> +)(?<day>\d{1,2}) ${CLOCK}${FRACTION} \d{4}$`,
);
const SYSLOG_EXAMPLE = new RegExp(
  String.raw`^[A-Za-z]{3}(?<dayGap> +)(?<day>\d{1,2}) ${CLOCK}${FRACTION}$`,
);
const SLASH_EXAMPLE = new RegExp(
  String.raw`^(?<firstNumber>\d{1,2})/(?<secondNumber>\d{1,2})/(?<year>\d{2}|\d{4}) ${CLOCK}${FRACTION}` +
    String.raw`(?:(?<meridiemSpace> ?)(?<meridiem>[AaPp][Mm]))?$`,
);
const DOTTED_EXAMPLE = new RegExp(
  String.raw`^(?<day>\d{1,2})\.(?<month>\d{1,2})\.\d{4} ${CLOCK}${FRACTION}$`,
);
const EPOCH_EXAMPLE = /^\d{10}(?:\.\d+)?$|^\d{13}$/;

/** The zone suffix of an iso or clf example. */
function zoneStyleOf(suffix: string): ZoneStyle | null {
  if (suffix === '') return { kind: 'none' };
  if (suffix === 'Z') return { kind: 'utcLetter' };
  if (suffix === ' UTC' || suffix === ' GMT') return { kind: 'utcWord', text: suffix };
  const offset = /^( ?)[+-]\d{2}(?:(:?)\d{2})?$/.exec(suffix);
  if (offset) {
    const hasMinutes = suffix.length > offset[1].length + 3;
    return {
      kind: 'offset',
      space: offset[1] === ' ',
      colon: offset[2] === ':',
      minutes: hasMinutes,
    };
  }
  if (/^ [A-Za-z]+$/.test(suffix)) return { kind: 'text', text: suffix };
  return null;
}

/**
 * The padding a number written in an example shows: one digit is
 * unpadded, a leading zero is padded. A number of 10 or more shows
 * neither, so it gets none here.
 */
function paddingShown(digits: string | undefined): Padding | undefined {
  if (digits === undefined) return undefined;
  if (digits.length === 1) return 'none';
  if (digits.startsWith('0')) return 'zero';
  return undefined;
}

/**
 * The padding of each field: a field that shows its padding keeps it;
 * the others follow the fields that show one when those all agree (a
 * writer that pads none of its fields, such as `2025-2-15 18:16:22`), and
 * are zero-padded otherwise.
 */
function paddingOf(fields: Partial<Record<keyof FieldPadding, string>>): Partial<FieldPadding> {
  const shown: Partial<FieldPadding> = {};
  for (const [name, digits] of Object.entries(fields) as [keyof FieldPadding, string][]) {
    const padding = paddingShown(digits);
    if (padding) shown[name] = padding;
  }
  const kinds = new Set(Object.values(shown));
  const rest: Padding = kinds.size === 1 ? [...kinds][0] : 'zero';
  const padding: Partial<FieldPadding> = {};
  for (const name of Object.keys(fields) as (keyof FieldPadding)[]) {
    padding[name] = shown[name] ?? rest;
  }
  return padding;
}

/** The padding of a syslog or ctime day: `Oct  6`, `Oct 06` or `Oct 6`. */
function dayPaddingOf(gap: string, digits: string): Padding {
  if (digits.length === 2) return digits.startsWith('0') ? 'zero' : 'space';
  return gap.length === 2 ? 'space' : 'none';
}

/** The fraction options of a match: separator and digits, or none. */
function fractionOf(groups: Record<string, string | undefined>): Partial<LayoutOptions> {
  if (groups.colonMillis !== undefined) return { fractionSeparator: ':', fractionDigits: 3 };
  if (groups.fraction === undefined) return { fractionSeparator: null, fractionDigits: 0 };
  return {
    fractionSeparator: groups.fractionSeparator as '.' | ',',
    fractionDigits: groups.fraction.length,
  };
}

/** The digits of the clock fields of a match, as written. */
function clockFields(groups: Record<string, string | undefined>) {
  return { hour: groups.hour, minute: groups.minute, second: groups.second };
}

function readIso(example: string): Partial<LayoutOptions> | null {
  const groups = ISO_EXAMPLE.exec(example)?.groups;
  if (!groups) return null;
  const zone = zoneStyleOf(groups.zone ?? '');
  if (!zone) return null;
  return {
    dateSeparator: groups.dateSeparator as '-' | '/',
    dateTimeSeparator: groups.dateTimeSeparator as 'T' | ' ',
    ...fractionOf(groups),
    zone,
    padding: {
      ...BASE_OPTIONS.padding,
      ...paddingOf({ month: groups.month, day: groups.day, ...clockFields(groups) }),
    },
  };
}

function readClf(example: string): Partial<LayoutOptions> | null {
  const groups = CLF_EXAMPLE.exec(example)?.groups;
  if (!groups) return null;
  const zone = zoneStyleOf(groups.zone ?? '');
  if (!zone) return null;
  return {
    zone,
    padding: { ...BASE_OPTIONS.padding, ...paddingOf({ day: groups.day, ...clockFields(groups) }) },
  };
}

/** A reader for syslog and ctime, which differ only in their regular expression. */
function readNamedMonth(pattern: RegExp) {
  return (example: string): Partial<LayoutOptions> | null => {
    const groups = pattern.exec(example)?.groups;
    if (!groups) return null;
    return {
      ...fractionOf(groups),
      padding: {
        ...BASE_OPTIONS.padding,
        ...paddingOf(clockFields(groups)),
        day: dayPaddingOf(groups.dayGap ?? ' ', groups.day ?? ''),
      },
    };
  };
}

function readSlash(example: string, dayFirst: boolean): Partial<LayoutOptions> | null {
  const groups = SLASH_EXAMPLE.exec(example)?.groups;
  if (!groups) return null;
  const meridiem = groups.meridiem
    ? {
        space: groups.meridiemSpace === ' ',
        lowerCase: groups.meridiem === groups.meridiem.toLowerCase(),
      }
    : null;
  return {
    ...fractionOf(groups),
    meridiem,
    yearDigits: groups.year?.length === 2 ? 2 : 4,
    padding: {
      ...BASE_OPTIONS.padding,
      ...paddingOf({
        month: dayFirst ? groups.secondNumber : groups.firstNumber,
        day: dayFirst ? groups.firstNumber : groups.secondNumber,
        ...clockFields(groups),
      }),
    },
  };
}

function readDotted(example: string): Partial<LayoutOptions> | null {
  const groups = DOTTED_EXAMPLE.exec(example)?.groups;
  if (!groups) return null;
  return {
    ...fractionOf(groups),
    padding: {
      ...BASE_OPTIONS.padding,
      ...paddingOf({ month: groups.month, day: groups.day, ...clockFields(groups) }),
    },
  };
}

/** `n` padded to two places as `padding` says. */
function two(n: number, padding: Padding): string {
  if (padding === 'zero') return String(n).padStart(2, '0');
  if (padding === 'space') return String(n).padStart(2, ' ');
  return String(n);
}

function year4(year: number): string {
  return String(year).padStart(4, '0');
}

/** The fraction of a second as the options write it, separator included. */
function writeFraction(millisecond: number, options: LayoutOptions): string {
  const { fractionSeparator, fractionDigits } = options;
  if (fractionSeparator === null || fractionDigits === 0) return '';
  const ms = String(millisecond).padStart(3, '0');
  if (fractionSeparator === ':') return `:${ms}`;
  const digits =
    fractionDigits <= 3 ? ms.slice(0, fractionDigits) : ms + '0'.repeat(fractionDigits - 3);
  return fractionSeparator + digits;
}

/** The clock, its fraction and its AM/PM. */
function writeClock(wall: WallClock, options: LayoutOptions): string {
  const { padding, meridiem } = options;
  const hour = meridiem ? wall.hour % 12 || 12 : wall.hour;
  let clock =
    `${two(hour, padding.hour)}:${two(wall.minute, padding.minute)}:` +
    two(wall.second, padding.second) +
    writeFraction(wall.millisecond, options);
  if (meridiem) {
    const text = wall.hour < 12 ? 'AM' : 'PM';
    clock += (meridiem.space ? ' ' : '') + (meridiem.lowerCase ? text.toLowerCase() : text);
  }
  return clock;
}

/** An offset east of UTC as `±HH:MM`, `±HHMM` or `±HH` (when its minutes are zero). */
function writeOffset(offsetMinutes: number, colon: boolean, minutes: boolean): string {
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  if (!minutes && mm === '00') return sign + hh;
  return sign + hh + (colon || !minutes ? ':' : '') + mm;
}

/** The zone suffix of the wall clock as the options write it. */
function writeZone(offsetMinutes: number, zone: ZoneStyle): string {
  switch (zone.kind) {
    case 'none':
      return '';
    case 'utcLetter':
      return offsetMinutes === 0 ? 'Z' : writeOffset(offsetMinutes, true, true);
    case 'offset':
      return (zone.space ? ' ' : '') + writeOffset(offsetMinutes, zone.colon, zone.minutes);
    case 'utcWord':
      return offsetMinutes === 0 ? zone.text : ` ${writeOffset(offsetMinutes, true, true)}`;
    case 'text':
      return zone.text;
  }
}

/** ISO 8601 with milliseconds and `Z` or `±HH:MM`: how an epoch time is shown. */
function writeIsoInstant(wall: WallClock): string {
  const date = `${year4(wall.year)}-${two(wall.month, 'zero')}-${two(wall.day, 'zero')}`;
  const clock =
    `${two(wall.hour, 'zero')}:${two(wall.minute, 'zero')}:${two(wall.second, 'zero')}.` +
    String(wall.millisecond).padStart(3, '0');
  return `${date}T${clock}${writeZone(wall.offsetMinutes, { kind: 'utcLetter' })}`;
}

/** The name of the day of the week of the wall clock's date. */
function weekdayOf(wall: WallClock): string {
  const date = new Date(0);
  date.setUTCFullYear(wall.year, wall.month - 1, wall.day);
  return WEEKDAY_NAMES[date.getUTCDay()];
}

/** One row per family: how its examples are read and its layout written. */
const FAMILIES: Record<TimeFamily, FamilyRow> = {
  iso: {
    defaults: {},
    read: readIso,
    write: (wall, o) => {
      const { padding: p } = o;
      const date =
        year4(wall.year) +
        o.dateSeparator +
        two(wall.month, p.month) +
        o.dateSeparator +
        two(wall.day, p.day);
      return (
        date + o.dateTimeSeparator + writeClock(wall, o) + writeZone(wall.offsetMinutes, o.zone)
      );
    },
  },
  clf: {
    defaults: { zone: { kind: 'offset', space: false, colon: false, minutes: true } },
    read: readClf,
    write: (wall, o) =>
      `[${two(wall.day, o.padding.day)}/${MONTH_NAMES[wall.month - 1]}/${year4(wall.year)}:` +
      `${writeClock(wall, o)} ${writeZone(wall.offsetMinutes, o.zone)}]`,
  },
  ctime: {
    defaults: { padding: { ...BASE_OPTIONS.padding, day: 'space' } },
    read: readNamedMonth(CTIME_EXAMPLE),
    write: (wall, o) =>
      `${weekdayOf(wall)} ${MONTH_NAMES[wall.month - 1]} ${two(wall.day, o.padding.day)} ` +
      `${writeClock(wall, o)} ${year4(wall.year)}`,
  },
  syslog: {
    defaults: { padding: { ...BASE_OPTIONS.padding, day: 'space' } },
    read: readNamedMonth(SYSLOG_EXAMPLE),
    write: (wall, o) =>
      `${MONTH_NAMES[wall.month - 1]} ${two(wall.day, o.padding.day)} ${writeClock(wall, o)}`,
  },
  slash: {
    defaults: {},
    read: readSlash,
    write: (wall, o) => {
      const month = two(wall.month, o.padding.month);
      const day = two(wall.day, o.padding.day);
      const year = o.yearDigits === 2 ? String(wall.year % 100).padStart(2, '0') : year4(wall.year);
      const date = o.dayFirst ? `${day}/${month}/${year}` : `${month}/${day}/${year}`;
      return `${date} ${writeClock(wall, o)}`;
    },
  },
  dotted: {
    defaults: {},
    read: readDotted,
    write: (wall, o) =>
      `${two(wall.day, o.padding.day)}.${two(wall.month, o.padding.month)}.${year4(wall.year)} ` +
      writeClock(wall, o),
  },
  epoch: {
    defaults: {},
    read: (example) => (EPOCH_EXAMPLE.test(example) ? {} : null),
    write: writeIsoInstant,
  },
};

function isFamily(name: string | null): name is TimeFamily {
  return name !== null && Object.hasOwn(FAMILIES, name);
}

/**
 * The options an example of `family` shows, over the family's defaults.
 * An example the family's reader does not recognise (null, escaped bytes,
 * another family's text) gives the defaults. A slash date's day order
 * cannot be read from one example, so the caller passes the answer's
 * `day_first`.
 */
export function parseExampleOptions(
  example: string | null,
  family: TimeFamily,
  dayFirst = false,
): LayoutOptions {
  const row = FAMILIES[family];
  const read = example === null ? null : row.read(example, dayFirst);
  return { ...BASE_OPTIONS, ...row.defaults, ...(read ?? {}), dayFirst };
}

/** A zone's wall clock of an instant, or null for a zone this browser cannot read. */
type ZoneReader = (instantMs: number) => WallClock | null;

const FIXED_OFFSET = /^([+-])(\d{2}):(\d{2})$/;

/** The wall clock of an instant at a fixed offset east of UTC. */
function wallAtOffset(instantMs: number, offsetMinutes: number): WallClock {
  const shifted = new Date(instantMs + offsetMinutes * MS_PER_MINUTE);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    millisecond: shifted.getUTCMilliseconds(),
    offsetMinutes,
  };
}

/**
 * The reader of an IANA zone. `formatToParts` gives the wall clock's
 * numbers; their distance from the instant is the zone's offset there.
 */
function ianaReader(zone: string): ZoneReader | null {
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
  } catch {
    return null;
  }
  return (instantMs) => {
    const parts: Record<string, number> = {};
    for (const part of format.formatToParts(instantMs)) {
      if (part.type !== 'literal') parts[part.type] = Number(part.value);
    }
    const millisecond = ((instantMs % 1000) + 1000) % 1000;
    const date = new Date(0);
    date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
    date.setUTCHours(parts.hour, parts.minute, parts.second, millisecond);
    const offsetMinutes = Math.round((date.getTime() - instantMs) / MS_PER_MINUTE);
    return wallAtOffset(instantMs, offsetMinutes);
  };
}

/** The reader of a `display_zone`; null for one this browser does not know. */
function zoneReader(zone: string | null): ZoneReader | null {
  if (zone === null || zone === 'UTC') return (instantMs) => wallAtOffset(instantMs, 0);
  const fixed = FIXED_OFFSET.exec(zone);
  if (fixed) {
    const minutes = Number(fixed[2]) * 60 + Number(fixed[3]);
    const offset = fixed[1] === '-' ? -minutes : minutes;
    return (instantMs) => wallAtOffset(instantMs, offset);
  }
  return ianaReader(zone);
}

/** A file's way of writing a time, read once per answer. */
type Renderer = (instantMs: number) => string;

/**
 * ISO 8601 in UTC, for an answer whose family or zone is not one this
 * viewer reads: an unambiguous time rather than a wrong wall clock.
 */
const renderIsoUtc: Renderer = (instantMs) => writeIsoInstant(wallAtOffset(instantMs, 0));

function rendererOf(layout: FileTimeLayout): Renderer {
  const reader = zoneReader(layout.display_zone);
  if (!isFamily(layout.format) || !reader) return renderIsoUtc;
  const row = FAMILIES[layout.format];
  const options = parseExampleOptions(layout.example, layout.format, layout.day_first === true);
  return (instantMs) => {
    const wall = reader(instantMs);
    return wall ? row.write(wall, options) : renderIsoUtc(instantMs);
  };
}

const renderers = new WeakMap<FileTimeLayout, Renderer>();

/**
 * `instantMs`, milliseconds since the epoch, written the way the file of
 * `range` writes its timestamps, in the zone its lines show
 * (`display_zone`): `2025-12-10 07:00:04.574`, `Dec 10 07:00:12.156`,
 * `2025-12-10 16:18:53,741`. An epoch file's times are shown as ISO 8601;
 * so is a time in a family or zone this viewer does not know, in UTC.
 */
export function formatInFileLayout(instantMs: number, range: FileTimeLayout): string {
  let render = renderers.get(range);
  if (!render) {
    render = rendererOf(range);
    renderers.set(range, render);
  }
  return render(instantMs);
}
