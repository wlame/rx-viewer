import { describe, expect, it } from 'vitest';
import {
  COMMON_ZONES,
  MAX_FILE_ZONES,
  fileZoneOf,
  isFileZone,
  isFixedOffset,
  matchingZones,
  normalizeFileZones,
  parseFileZoneParam,
  serializeFileZoneParam,
  withFileZone,
  withoutFileZone,
  type FileZone,
} from './fileZones';

/** `count` overrides of files /logs/0.log, /logs/1.log, …, each to UTC. */
function overrides(count: number): FileZone[] {
  return Array.from({ length: count }, (_, i) => ({ path: `/logs/${i}.log`, zone: 'UTC' }));
}

const noneOpen = () => false;

describe('isFixedOffset', () => {
  it.each(['+00:00', '-05:00', '+05:30', '+18:00', '-18:00', '+14:45'])('accepts %s', (value) => {
    expect(isFixedOffset(value)).toBe(true);
  });

  it.each(['+18:01', '+19:00', '+05:60', '05:00', '+5:00', '+05:0', '+0500', '+-1:00', ' +01:00'])(
    'refuses %s',
    (value) => {
      expect(isFixedOffset(value)).toBe(false);
    },
  );
});

describe('isFileZone', () => {
  it.each(['UTC', 'Europe/Berlin', 'America/New_York', 'Asia/Kolkata', '+02:00', '-03:30'])(
    'accepts %s',
    (value) => {
      expect(isFileZone(value)).toBe(true);
    },
  );

  it.each([
    ['empty', ''],
    ['the process zone', 'local'],
    ['the process zone in capitals', 'Local'],
    ['an unknown name', 'Mars/Olympus_Mons'],
    ['a name in other case', 'europe/berlin'],
    ['an offset out of range', '+19:00'],
    ['a value with an @', 'UTC@x'],
    ['a value past 64 bytes', `Europe/${'x'.repeat(64)}`],
  ])('refuses %s', (_name, value) => {
    expect(isFileZone(value)).toBe(false);
  });

  it('accepts every common zone', () => {
    expect(COMMON_ZONES.filter((zone) => !isFileZone(zone))).toEqual([]);
  });
});

describe('matchingZones', () => {
  const names = ['UTC', 'Europe/Berlin', 'Europe/London', 'America/New_York', 'Asia/Tokyo'];

  it('lists the common zones for an empty query', () => {
    expect(matchingZones(names, '  ')).toEqual({ zones: [...COMMON_ZONES], offset: null });
  });

  it('keeps the names that hold the query, without case, in the order given', () => {
    expect(matchingZones(names, 'eUrOpE').zones).toEqual(['Europe/Berlin', 'Europe/London']);
  });

  it('matches a space in the query to an underscore in the name', () => {
    expect(matchingZones(names, 'new york').zones).toEqual(['America/New_York']);
  });

  it('offers a typed offset first and lists nothing else', () => {
    expect(matchingZones(names, '+05:30')).toEqual({ zones: [], offset: '+05:30' });
  });

  it('offers no offset out of range', () => {
    expect(matchingZones(names, '+19:00')).toEqual({ zones: [], offset: null });
  });

  it('lists at most the limit', () => {
    expect(matchingZones(names, 'e', 2).zones).toHaveLength(2);
  });
});

describe('withFileZone', () => {
  it('adds a file at the end and replaces the zone of a file it holds in place', () => {
    const one = withFileZone([], '/a.log', 'Europe/Berlin', noneOpen);
    const two = withFileZone(one!, '/b.log', '+02:00', noneOpen);
    const changed = withFileZone(two!, '/a.log', 'UTC', noneOpen);

    expect(changed).toEqual([
      { path: '/a.log', zone: 'UTC' },
      { path: '/b.log', zone: '+02:00' },
    ]);
  });

  it('drops the oldest file that is not open to make room past the limit', () => {
    const full = overrides(MAX_FILE_ZONES);
    const isOpen = (path: string) => path === '/logs/0.log';

    const next = withFileZone(full, '/new.log', 'Europe/Berlin', isOpen)!;

    expect(next).toHaveLength(MAX_FILE_ZONES);
    expect(next.map((z) => z.path)).not.toContain('/logs/1.log');
    expect(next.map((z) => z.path)).toContain('/logs/0.log');
    expect(next.at(-1)).toEqual({ path: '/new.log', zone: 'Europe/Berlin' });
  });

  it('refuses a new file when every file it holds is open', () => {
    expect(withFileZone(overrides(MAX_FILE_ZONES), '/new.log', 'UTC', () => true)).toBeNull();
  });

  it('changes the zone of a file it holds when full', () => {
    const next = withFileZone(overrides(MAX_FILE_ZONES), '/logs/3.log', '+01:00', () => true);
    expect(next?.[3]).toEqual({ path: '/logs/3.log', zone: '+01:00' });
  });
});

describe('withoutFileZone', () => {
  it('removes the file and keeps the others in order', () => {
    expect(withoutFileZone(overrides(3), '/logs/1.log').map((z) => z.path)).toEqual([
      '/logs/0.log',
      '/logs/2.log',
    ]);
  });
});

describe('fileZoneOf', () => {
  it('gives the zone of a file it holds and null for another', () => {
    const zones = [{ path: '/a.log', zone: 'Europe/Berlin' }];
    expect(fileZoneOf(zones, '/a.log')).toBe('Europe/Berlin');
    expect(fileZoneOf(zones, '/b.log')).toBeNull();
  });
});

describe('the ftz parameter', () => {
  it('splits a value on its first @, so the path may hold one', () => {
    expect(parseFileZoneParam('Europe/Berlin@/logs/user@host/app.log')).toEqual({
      path: '/logs/user@host/app.log',
      zone: 'Europe/Berlin',
    });
  });

  it.each([
    ['no @', 'Europe/Berlin'],
    ['no path', 'Europe/Berlin@'],
    ['no zone', '@/logs/app.log'],
    ['an invalid zone', 'Mars/Base@/logs/app.log'],
  ])('reads nothing from a value with %s', (_name, value) => {
    expect(parseFileZoneParam(value)).toBeNull();
  });

  it('writes the zone, an @ and the path', () => {
    expect(serializeFileZoneParam({ path: '/logs/a@b.log', zone: '+02:00' })).toBe(
      '+02:00@/logs/a@b.log',
    );
  });
});

describe('normalizeFileZones', () => {
  it('keeps the first zone of a file named twice and the first entries up to the limit', () => {
    const many = [{ path: '/logs/0.log', zone: '+01:00' }, ...overrides(MAX_FILE_ZONES + 5)];

    const kept = normalizeFileZones(many);

    expect(kept).toHaveLength(MAX_FILE_ZONES);
    expect(kept[0]).toEqual({ path: '/logs/0.log', zone: '+01:00' });
    expect(kept.at(-1)?.path).toBe(`/logs/${MAX_FILE_ZONES - 1}.log`);
  });

  it('drops an entry whose zone is not one', () => {
    expect(normalizeFileZones([{ path: '/a.log', zone: 'local' }])).toEqual([]);
  });
});
