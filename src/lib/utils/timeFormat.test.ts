import { describe, expect, it } from 'vitest';
import type { TimeRangeResponse } from '../types';
import { formatInFileLayout, parseExampleOptions } from './timeFormat';

/** A time range as rx-go answers it, with the layout fields a test names. */
function rangeOf(
  layout: Pick<TimeRangeResponse, 'format' | 'example' | 'display_zone'> &
    Partial<TimeRangeResponse>,
): TimeRangeResponse {
  return {
    path: '/logs/app.log',
    has_zone: false,
    day_first: null,
    first_ms: null,
    last_ms: null,
    source: 'scan',
    cli_command: 'rx time-range /logs/app.log',
    ...layout,
  };
}

/** Milliseconds since the epoch of a UTC reading written as RFC 3339 with `Z`. */
function utc(text: string): number {
  return Date.parse(text);
}

describe('formatInFileLayout', () => {
  // The real answers of rx-go 1.5 for the playground's logs.
  const middleware = rangeOf({
    format: 'iso',
    display_zone: 'UTC',
    example: '2025-12-10 07:00:04.574',
    first_ms: 1765350004574,
    last_ms: 1765353604390,
  });
  const core = rangeOf({
    format: 'syslog',
    display_zone: 'UTC',
    example: 'Dec 10 07:00:12.156',
    first_ms: 1765350012156,
  });
  const stdout = rangeOf({
    format: 'iso',
    display_zone: 'UTC',
    example: '2025-12-10 16:18:53,741',
    first_ms: 1765383533741,
  });
  const somelog = rangeOf({
    format: 'iso',
    display_zone: 'UTC',
    example: '2025-2-15 18:16:22:397',
    first_ms: 1739643382397,
  });
  const postgresql = rangeOf({
    format: 'iso',
    display_zone: 'UTC',
    example: '2025-12-10 07:00:30',
    first_ms: 1765350030000,
  });

  it.each([
    ['middleware.log', middleware, utc('2025-12-10T07:00:04.574Z'), '2025-12-10 07:00:04.574'],
    ['middleware.log at its last line', middleware, 1765353604390, '2025-12-10 08:00:04.390'],
    ['core.log (syslog)', core, 1765350012156, 'Dec 10 07:00:12.156'],
    ['core.log on a one-digit day', core, utc('2025-12-06T23:05:01.002Z'), 'Dec  6 23:05:01.002'],
    ['stdout (comma fraction)', stdout, 1765383533741, '2025-12-10 16:18:53,741'],
    ['SOMELOG (its own first line)', somelog, 1739643382397, '2025-2-15 18:16:22:397'],
    ['postgresql (no fraction)', postgresql, 1765350030000, '2025-12-10 07:00:30'],
  ])('renders %s as its lines write it', (_name, range, instant, expected) => {
    expect(formatInFileLayout(instant, range)).toBe(expected);
  });

  it('leaves out the padding an unpadded writer leaves out and writes colon milliseconds with three digits', () => {
    expect(formatInFileLayout(utc('2025-03-05T08:09:07.005Z'), somelog)).toBe('2025-3-5 8:9:7:005');
  });

  it('pads a field the example shows padded although another is not', () => {
    const mixed = rangeOf({ format: 'iso', display_zone: 'UTC', example: '2025-2-15 08:16:22' });

    expect(formatInFileLayout(utc('2025-03-05T09:01:02Z'), mixed)).toBe('2025-3-05 09:01:02');
  });

  it('keeps a zone word the parser does not read as text', () => {
    const range = rangeOf({
      format: 'iso',
      display_zone: 'UTC',
      example: '2025-12-10 07:49:50 MST',
    });

    expect(formatInFileLayout(utc('2025-12-10T07:49:50Z'), range)).toBe('2025-12-10 07:49:50 MST');
  });

  it.each([
    ['2025-12-10 07:49:50 UTC', '+00:00', '2025-12-10T07:49:50Z', '2025-12-10 07:49:50 UTC'],
    ['2025-12-10 07:49:50 UTC', '+02:00', '2025-12-10T07:49:50Z', '2025-12-10 09:49:50 +02:00'],
    [
      '2026-10-06T12:34:56.123+02:00',
      '+02:00',
      '2026-10-06T10:34:56.123Z',
      '2026-10-06T12:34:56.123+02:00',
    ],
    [
      '2026-10-06T12:34:56.123+0200',
      '-05:30',
      '2026-10-06T12:34:56.123Z',
      '2026-10-06T07:04:56.123-0530',
    ],
    ['2026-10-06T12:34:56+02', '+02:00', '2026-10-06T10:34:56Z', '2026-10-06T12:34:56+02'],
    ['2026-10-06T12:34:56+02', '+05:30', '2026-10-06T10:34:56Z', '2026-10-06T16:04:56+05:30'],
    ['2025-12-10T07:00:04Z', '+00:00', '2025-12-10T07:00:04Z', '2025-12-10T07:00:04Z'],
    ['2025-12-10T07:00:04Z', '+01:00', '2025-12-10T07:00:04Z', '2025-12-10T08:00:04+01:00'],
    ['2026/10/06 12:34:56 +0200', '+02:00', '2026-10-06T10:34:56Z', '2026/10/06 12:34:56 +0200'],
  ])('writes the zone of example %s in display zone %s', (example, zone, instant, expected) => {
    const range = rangeOf({ format: 'iso', has_zone: true, display_zone: zone, example });

    expect(formatInFileLayout(utc(instant), range)).toBe(expected);
  });

  it.each([
    ['+00:00', '[06/Oct/2026:12:34:56 +0000]'],
    ['+02:00', '[06/Oct/2026:14:34:56 +0200]'],
    ['-05:30', '[06/Oct/2026:07:04:56 -0530]'],
  ])('renders the access-log form in zone %s', (zone, expected) => {
    const range = rangeOf({
      format: 'clf',
      has_zone: true,
      display_zone: zone,
      example: '[06/Oct/2026:12:34:56 +0000]',
    });

    expect(formatInFileLayout(utc('2026-10-06T12:34:56Z'), range)).toBe(expected);
  });

  it.each([
    ['00:05:09', '10/06/2026 12:05:09 AM'],
    ['12:00:00', '10/06/2026 12:00:00 PM'],
    ['13:07:08', '10/06/2026 01:07:08 PM'],
  ])('renders %s UTC on a 12-hour slash clock', (clock, expected) => {
    const range = rangeOf({
      format: 'slash',
      day_first: false,
      display_zone: 'UTC',
      example: '10/06/2026 12:34:56 PM',
    });

    expect(formatInFileLayout(utc(`2026-10-06T${clock}Z`), range)).toBe(expected);
  });

  it('puts the day first in a day-first slash file and keeps its two-digit year', () => {
    const range = rangeOf({
      format: 'slash',
      day_first: true,
      display_zone: 'UTC',
      example: '06/10/26 14:34:56',
    });

    expect(formatInFileLayout(utc('2026-03-09T14:34:56Z'), range)).toBe('09/03/26 14:34:56');
  });

  it('puts the month first when day_first is false', () => {
    const range = rangeOf({
      format: 'slash',
      day_first: false,
      display_zone: 'UTC',
      example: '10/06/2026 14:34:56',
    });

    expect(formatInFileLayout(utc('2026-03-09T14:34:56Z'), range)).toBe('03/09/2026 14:34:56');
  });

  it.each([
    ['2025-03-30T00:59:59.000Z', '2025-03-30 01:59:59.000'],
    ['2025-03-30T01:00:00.000Z', '2025-03-30 03:00:00.000'],
    ['2025-10-26T00:59:59.000Z', '2025-10-26 02:59:59.000'],
    ['2025-10-26T01:00:00.000Z', '2025-10-26 02:00:00.000'],
  ])('reads %s in an IANA zone across a daylight-saving change', (instant, expected) => {
    const range = rangeOf({
      format: 'iso',
      display_zone: 'Europe/Berlin',
      example: '2025-12-10 07:00:04.574',
    });

    expect(formatInFileLayout(utc(instant), range)).toBe(expected);
  });

  it('writes the offset an IANA zone has at the instant', () => {
    const range = rangeOf({
      format: 'iso',
      display_zone: 'Europe/Berlin',
      example: '2025-03-30T01:59:59+01:00',
    });

    expect(formatInFileLayout(utc('2025-03-30T00:59:59Z'), range)).toBe(
      '2025-03-30T01:59:59+01:00',
    );
    expect(formatInFileLayout(utc('2025-03-30T01:00:00Z'), range)).toBe(
      '2025-03-30T03:00:00+02:00',
    );
  });

  it.each([
    ['+00:00', '2023-10-06T13:46:40.123Z'],
    ['+02:00', '2023-10-06T15:46:40.123+02:00'],
  ])('renders an epoch file as ISO 8601 in zone %s', (zone, expected) => {
    const range = rangeOf({
      format: 'epoch',
      has_zone: true,
      display_zone: zone,
      example: '1696600000.123',
    });

    expect(formatInFileLayout(1696600000123, range)).toBe(expected);
  });

  it('renders the ctime form with the weekday of the date', () => {
    const range = rangeOf({
      format: 'ctime',
      display_zone: 'UTC',
      example: 'Tue Oct 06 12:34:56.123456 2026',
    });

    expect(formatInFileLayout(utc('2026-10-06T12:34:56.789Z'), range)).toBe(
      'Tue Oct 06 12:34:56.789000 2026',
    );
    expect(formatInFileLayout(utc('2026-10-10T01:02:03Z'), range)).toBe(
      'Sat Oct 10 01:02:03.000000 2026',
    );
  });

  it('renders the dotted form', () => {
    const range = rangeOf({
      format: 'dotted',
      display_zone: 'UTC',
      example: '06.10.2026 12:34:56,789',
    });

    expect(formatInFileLayout(utc('2026-01-02T03:04:05.006Z'), range)).toBe(
      '02.01.2026 03:04:05,006',
    );
  });

  it.each([
    ['an unknown format', rangeOf({ format: 'julian', display_zone: 'UTC', example: '2461000.5' })],
    ['no format', rangeOf({ format: null, display_zone: null, example: null })],
    [
      'a zone the browser does not know',
      rangeOf({ format: 'iso', display_zone: 'Mars/Olympus_Mons', example: '2025-12-10 07:00:04' }),
    ],
  ])('renders ISO 8601 in UTC for %s', (_name, range) => {
    expect(formatInFileLayout(utc('2025-12-10T07:00:04.574Z'), range)).toBe(
      '2025-12-10T07:00:04.574Z',
    );
  });

  it('renders the family defaults for an example it cannot read', () => {
    const range = rangeOf({ format: 'iso', display_zone: 'UTC', example: '\\x00garbage' });

    expect(formatInFileLayout(utc('2025-12-10T07:00:04.574Z'), range)).toBe('2025-12-10 07:00:04');
  });
});

describe('parseExampleOptions', () => {
  it.each([
    [
      'iso with a dot fraction',
      '2025-12-10 07:00:04.574',
      'iso',
      {
        dateTimeSeparator: ' ',
        dateSeparator: '-',
        fractionSeparator: '.',
        fractionDigits: 3,
        zone: { kind: 'none' },
        meridiem: null,
      },
    ],
    [
      'iso with T, six digits and a numeric zone',
      '2026-10-06T12:34:56.123456+02:00',
      'iso',
      {
        dateTimeSeparator: 'T',
        fractionSeparator: '.',
        fractionDigits: 6,
        zone: { kind: 'offset', space: false, colon: true, minutes: true },
      },
    ],
    [
      'iso with colon milliseconds and unpadded fields',
      '2025-2-15 18:16:22:397',
      'iso',
      {
        fractionSeparator: ':',
        fractionDigits: 3,
        padding: { month: 'none', day: 'none', hour: 'none', minute: 'none', second: 'none' },
      },
    ],
    [
      'iso with a comma fraction',
      '2025-12-10 16:18:53,741',
      'iso',
      { fractionSeparator: ',', fractionDigits: 3 },
    ],
    [
      'iso with slashes and a zone word',
      '2026/10/06 12:34:56 UTC',
      'iso',
      { dateSeparator: '/', fractionSeparator: null, zone: { kind: 'utcWord', text: ' UTC' } },
    ],
    ['iso with Z', '2025-12-10T07:00:04Z', 'iso', { zone: { kind: 'utcLetter' } }],
    [
      'iso with a word the parser leaves out',
      '2025-12-10 07:49:50 MST',
      'iso',
      { zone: { kind: 'text', text: ' MST' } },
    ],
    [
      'iso with a spaced compact offset',
      '2026-10-06 12:34:56 +0200',
      'iso',
      { zone: { kind: 'offset', space: true, colon: false, minutes: true } },
    ],
    [
      'iso with an hour-only offset',
      '2026-10-06T12:34:56-05',
      'iso',
      { zone: { kind: 'offset', space: false, colon: false, minutes: false } },
    ],
    [
      'syslog with a space-padded day',
      'Oct  6 12:34:56',
      'syslog',
      { padding: { day: 'space' }, fractionSeparator: null },
    ],
    ['syslog with a two-digit day', 'Dec 10 07:00:12.156', 'syslog', { padding: { day: 'space' } }],
    ['syslog with an unpadded day', 'Oct 6 12:34:56', 'syslog', { padding: { day: 'none' } }],
    [
      'ctime with a zero-padded day',
      'Tue Oct 06 12:34:56.123456 2026',
      'ctime',
      { padding: { day: 'zero' }, fractionDigits: 6 },
    ],
    [
      'slash with AM/PM',
      '10/06/2026 12:34:56 PM',
      'slash',
      { meridiem: { space: true, lowerCase: false }, yearDigits: 4 },
    ],
    [
      'slash with a lower-case meridiem and no space',
      '1/6/26 1:34:56pm',
      'slash',
      { meridiem: { space: false, lowerCase: true }, yearDigits: 2 },
    ],
    [
      'clf',
      '[06/Oct/2026:12:34:56 +0000]',
      'clf',
      { zone: { kind: 'offset', space: false, colon: false, minutes: true } },
    ],
    ['dotted', '06.10.2026 12:34:56,789', 'dotted', { fractionSeparator: ',', fractionDigits: 3 }],
  ] as const)('reads %s', (_name, example, family, expected) => {
    expect(parseExampleOptions(example, family)).toMatchObject(expected);
  });

  it('takes the day order of a slash file from the answer, not the example', () => {
    expect(parseExampleOptions('06/10/26 14:34:56', 'slash', true).dayFirst).toBe(true);
    expect(parseExampleOptions('06/10/26 14:34:56', 'slash').dayFirst).toBe(false);
  });

  it.each([
    ['a null example', null],
    ['an example of another family', 'Dec 10 07:00:12.156'],
    ['an escaped byte', '2025-12-10\\x0007:00:04'],
  ])('gives the family defaults for %s', (_name, example) => {
    expect(parseExampleOptions(example, 'iso')).toEqual(parseExampleOptions(null, 'iso'));
    expect(parseExampleOptions(null, 'iso')).toMatchObject({
      dateTimeSeparator: ' ',
      dateSeparator: '-',
      fractionSeparator: null,
      fractionDigits: 0,
      zone: { kind: 'none' },
      meridiem: null,
      padding: { month: 'zero', day: 'zero', hour: 'zero', minute: 'zero', second: 'zero' },
    });
  });
});
