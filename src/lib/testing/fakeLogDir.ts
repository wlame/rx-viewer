/**
 * A log directory that mixes rotated logs with files of other kinds, as
 * `/v1/tree` and `/v1/logs/chains` list it, for tests.
 *
 * Seven chains: numbered from 1 with an empty active file and gzip parts
 * (`choices.log`, `pkg.log` up to `.11.gz`), numbered from 0
 * (`boot.msg.0`), dated with a second number (`access.log-20260302-…gz`,
 * `messages-…`, `kernel.log` with days left out), and one whose parts
 * are all empty (`agent.log`, indexed). Beside them: nine directories,
 * single files whose names start like a chain's (`agent-bpf.log`,
 * `agentctl.log`, an empty `agentd.log`), and binary files whose names
 * look rotated (`failures` and `failures.1`, `sessions` and
 * `sessions.1`, `lastseen`), which the backend puts in no chain.
 *
 * The tree lists 70 entries; with the chains grouped, 26 rows remain:
 * the 9 directories, the 7 chains and the 10 files of no chain.
 */
import { vi } from 'vitest';
import type { ChainEntry, ChainsResponse, TreeEntry, TreeResponse } from '../types';

export const LOG_DIR = '/srv/logs';

/** The search root that holds `LOG_DIR`. */
export const LOG_ROOT = '/srv';

const DIRECTORIES = [
  'pkgcache',
  'perf',
  'monitor',
  'timesync',
  'vswitch',
  'restricted',
  'metrics',
  'cache',
  'sub',
];

/** A file of the directory: text unless `binary`, gzip when its name ends in `.gz`. */
interface FileSpec {
  name: string;
  binary?: boolean;
  empty?: boolean;
}

/** Days of the dated parts, each with its epoch second, as `{name}-{day}-{epoch}.gz` names them. */
const DAYS: [day: string, epoch: number][] = [
  ['20260302', 1772409600],
  ['20260303', 1772496000],
  ['20260304', 1772582400],
  ['20260305', 1772668800],
  ['20260306', 1772755200],
  ['20260307', 1772841600],
  ['20260308', 1772928000],
];

function dated(name: string, days: [string, number][]): string[] {
  return days.map(([day, epoch]) => `${name}-${day}-${epoch}.gz`);
}

function numbered(name: string, highest: number, plainUpTo: number, lowest = 1): string[] {
  const parts: string[] = [];
  for (let n = highest; n >= lowest; n--) {
    parts.push(n <= plainUpTo ? `${name}.${n}` : `${name}.${n}.gz`);
  }
  return parts;
}

interface ChainSpec {
  name: string;
  /** The parts in the provisional order, oldest first, the active file last. */
  parts: string[];
  /** Every part is empty. */
  empty?: boolean;
  /** The active file is empty. */
  emptyActive?: boolean;
}

/** The seven chains, each with its parts as the listing orders them. */
const CHAINS: ChainSpec[] = [
  {
    name: 'access.log',
    parts: [...dated('access.log', DAYS), 'access.log'],
  },
  {
    name: 'agent.log',
    parts: [...numbered('agent.log', 7, 7), 'agent.log'],
    empty: true,
  },
  {
    name: 'boot.msg',
    parts: [...numbered('boot.msg', 2, 0, 0), 'boot.msg'],
  },
  {
    name: 'choices.log',
    parts: [...numbered('choices.log', 6, 1), 'choices.log'],
    emptyActive: true,
  },
  {
    name: 'kernel.log',
    parts: [...dated('kernel.log', [DAYS[0], DAYS[4], DAYS[5]]), 'kernel.log'],
    emptyActive: true,
  },
  {
    name: 'messages',
    parts: [...dated('messages', DAYS), 'messages'],
  },
  {
    name: 'pkg.log',
    parts: [...numbered('pkg.log', 11, 1), 'pkg.log'],
    emptyActive: true,
  },
];

/** The files of no chain. */
const SINGLE_FILES: FileSpec[] = [
  { name: 'agent-bpf.log' },
  { name: 'agentctl.log' },
  { name: 'agentd.log', empty: true },
  { name: 'failures', binary: true },
  { name: 'failures.1', binary: true },
  { name: 'fonts.log' },
  { name: 'lastseen', binary: true },
  { name: 'resolver' },
  { name: 'sessions', binary: true },
  { name: 'sessions.1', binary: true },
];

/** The chains' names, as the listing names them. */
export const CHAIN_NAMES = CHAINS.map((chain) => chain.name);

/** The names of the files that belong to no chain. */
export const SINGLE_FILE_NAMES = SINGLE_FILES.map((file) => file.name);

/** The names of the directories. */
export const DIRECTORY_NAMES = [...DIRECTORIES];

function chainFiles(chain: ChainSpec): FileSpec[] {
  return chain.parts.map((name) => ({
    name,
    empty: chain.empty || (chain.emptyActive && name === chain.name),
  }));
}

const ALL_FILES: FileSpec[] = [...CHAINS.flatMap(chainFiles), ...SINGLE_FILES];

/**
 * The modification time of the directory's newest files, as `/v1/tree`
 * writes one: every active file and every file of no chain.
 */
export const LOG_FILE_TIME = '2026-03-08T09:15:42.123456Z';

const DAY_MS = 86_400_000;
/** The epoch second a dated part's name ends with (`…-20260302-1772409600.gz`). */
const DATED_PART = /-(\d{10})\.gz$/;
/** The number a numbered part's name ends with (`app.log.3`, `app.log.3.gz`). */
const NUMBERED_PART = /\.(\d+)(\.gz)?$/;

/**
 * A file's modification time as rotation leaves it: a dated part at its
 * day, a part numbered N that many days before `LOG_FILE_TIME`, any other
 * file at `LOG_FILE_TIME`. So an order by date is not the order by name.
 */
function timeOf(file: FileSpec): string {
  const dated = DATED_PART.exec(file.name);
  if (dated) return new Date(Number(dated[1]) * 1000).toISOString();
  const days = Number(NUMBERED_PART.exec(file.name)?.[1] ?? 0);
  if (days === 0) return LOG_FILE_TIME;
  return new Date(Date.parse(LOG_FILE_TIME) - days * DAY_MS).toISOString();
}

/** The invented size of a file: 0 when it is empty, else a few hundred bytes from its name. */
function sizeOf(file: FileSpec): number {
  if (file.empty) return 0;
  return 200 + [...file.name].reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

/** The order `/v1/tree` lists names in: case-insensitive. */
function byName(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
}

/** A tree entry as `/v1/tree` gives it. */
export function treeEntry(
  path: string,
  type: 'directory' | 'file',
  fields: Partial<TreeEntry> = {},
): TreeEntry {
  return {
    path,
    name: path.slice(path.lastIndexOf('/') + 1),
    type,
    children_count: null,
    compression_format: null,
    is_compressed: null,
    is_indexed: null,
    is_text: null,
    line_count: null,
    modified_at: null,
    size: null,
    size_human: null,
    ...fields,
  };
}

function fileEntry(dir: string, file: FileSpec): TreeEntry {
  const isGzip = file.name.endsWith('.gz');
  return treeEntry(`${dir}/${file.name}`, 'file', {
    is_text: !file.binary,
    is_compressed: isGzip,
    compression_format: isGzip ? 'gzip' : null,
    is_indexed: false,
    modified_at: timeOf(file),
    size: sizeOf(file),
  });
}

/** The entries of `LOG_DIR` as `/v1/tree` lists them: directories first, each kind by name. */
export function logDirEntries(dir = LOG_DIR): TreeEntry[] {
  const directories = [...DIRECTORIES]
    .sort(byName)
    .map((name) => treeEntry(`${dir}/${name}`, 'directory', { children_count: 0 }));
  const files = [...ALL_FILES].sort((a, b) => byName(a.name, b.name));
  return [...directories, ...files.map((file) => fileEntry(dir, file))];
}

function chainEntry(dir: string, chain: ChainSpec): ChainEntry {
  const files = chainFiles(chain);
  return {
    path: `${dir}/${chain.name}`,
    name: chain.name,
    parts: [...chain.parts],
    has_active: true,
    missing: [],
    missing_count: 0,
    size: files.reduce((sum, file) => sum + sizeOf(file), 0),
    compression_formats: chain.parts.some((name) => name.endsWith('.gz')) ? ['gzip'] : [],
    is_indexed: chain.empty ?? false,
    unreadable: [],
    too_many_parts: false,
  };
}

/** The chains of `LOG_DIR` as `/v1/logs/chains` lists them: by name, case-insensitive. */
export function logDirChains(dir = LOG_DIR): ChainEntry[] {
  return [...CHAINS].sort((a, b) => byName(a.name, b.name)).map((c) => chainEntry(dir, c));
}

interface Answer {
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}

function answer(status: number, body: unknown): Answer {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function treeResponse(path: string, entries: TreeEntry[], isRoot = false): TreeResponse {
  return {
    path,
    parent: null,
    is_search_root: isRoot,
    entries,
    total_entries: entries.length,
    total_size: null,
    total_size_human: null,
  };
}

export interface LogDirBackendOptions {
  /** Features `/health` lists; `log_chains` by default. */
  features?: string[];
  /** The status `/v1/logs/chains` answers with in place of the listing. */
  chainsStatus?: number;
  /** Directories whose `/v1/tree` listing fails with a 500. */
  failingDirs?: string[];
}

/**
 * A backend that serves `LOG_ROOT` holding `LOG_DIR`, through a stubbed
 * `fetch`. Every other directory is empty and has no chains. Each
 * request's path and query is recorded; `hold` keeps the answers of one
 * route waiting until `release` is called, and `hide` leaves an entry of
 * `LOG_DIR` out of the listings that follow.
 */
export class LogDirBackend {
  readonly requests: string[] = [];
  private readonly options: LogDirBackendOptions;
  private held = new Set<string>();
  private waiting: (() => void)[] = [];
  private hidden = new Set<string>();

  constructor(options: LogDirBackendOptions = {}) {
    this.options = options;
  }

  /** Keep the answers of `pathname` (such as `/v1/logs/chains`) until `release`. */
  hold(pathname: string): void {
    this.held.add(pathname);
  }

  /** Leave the entry at `path` out of its directory's listings from now on. */
  hide(path: string): void {
    this.hidden.add(path);
  }

  /** Answer every held request, and hold no more. */
  release(): void {
    this.held.clear();
    for (const answerNow of this.waiting.splice(0)) answerNow();
  }

  /** The requests made to `pathname`, as `path?query`. */
  requestsTo(pathname: string): string[] {
    return this.requests.filter((r) => r.startsWith(`${pathname}?`) || r === pathname);
  }

  private answerFor(pathname: string, query: URLSearchParams): Answer {
    const path = query.get('path');
    switch (pathname) {
      case '/health':
        return answer(200, {
          contract_version: '1.7',
          features: this.options.features ?? ['log_chains'],
        });
      case '/v1/tree':
        if (path === null) {
          return answer(
            200,
            treeResponse('', [treeEntry(LOG_ROOT, 'directory', { children_count: 1 })], true),
          );
        }
        if (this.options.failingDirs?.includes(path)) {
          return answer(500, { detail: 'the directory cannot be listed' });
        }
        if (path === LOG_ROOT) {
          return answer(200, treeResponse(path, [treeEntry(LOG_DIR, 'directory')]));
        }
        return answer(
          200,
          treeResponse(
            path,
            path === LOG_DIR ? logDirEntries().filter((e) => !this.hidden.has(e.path)) : [],
          ),
        );
      case '/v1/logs/chains': {
        if (this.options.chainsStatus !== undefined) {
          return answer(this.options.chainsStatus, { detail: 'refused' });
        }
        const body: ChainsResponse = {
          path: path ?? '',
          chains: path === LOG_DIR ? logDirChains() : [],
        };
        return answer(200, body);
      }
      default:
        return answer(404, { detail: 'not found' });
    }
  }

  async fetch(url: string): Promise<Answer> {
    const parsed = new URL(url, 'http://localhost');
    this.requests.push(`${parsed.pathname}${parsed.search}`);
    if (this.held.has(parsed.pathname)) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    return this.answerFor(parsed.pathname, parsed.searchParams);
  }
}

/** Serve `backend` as the whole backend, through a stubbed `fetch`. */
export function serveLogDir(backend: LogDirBackend) {
  const spy = vi.fn((url: string) => backend.fetch(url));
  vi.stubGlobal('fetch', spy);
  return spy;
}
