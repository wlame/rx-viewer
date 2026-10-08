/**
 * A log chain served the way rx-go serves one at `/v1/logs/*`, for tests.
 *
 * Every line reads `<time> LINE <global n> part=<name> local=<l>`, so a
 * wrong number shows without a second tool, and global line n has the
 * timestamp `T0_MS + n` seconds, plus the `shiftSeconds` of its part and
 * every part before it (a time gap). A part given its own `text` and
 * `startSecond` keeps its lines' text and times through a rotation that
 * renames it (`rotateTo`): its lines read `<time> <text> local=<l>`. The
 * chain is pending (no global numbers; a request by global line or time
 * answers 202 with the chain's index task) until the test ends the task
 * with `finishTask`, or ready from the start. A search of the chain
 * (`/v1/logs/trace`) finds its lines by a JavaScript pattern. Each part
 * also reads as a file of its own (`/v1/samples`), with the same lines,
 * and its directory lists it (`/v1/tree`) and the chain
 * (`/v1/logs/chains`). Requests are recorded for assertions.
 */
import { vi } from 'vitest';
import type {
  ChainMatch,
  ChainPart,
  ChainPiece,
  ChainReason,
  ChainResponse,
  ChainTraceResponse,
  TaskStatus,
} from '../types';

/** The timestamp of global line 0; line n is n seconds later. */
export const T0_MS = Date.UTC(2026, 9, 1, 0, 0, 0);

export interface FakePart {
  name: string;
  /** Its lines; 0 for an empty part. */
  lines: number;
  compression?: string | null;
  isActive?: boolean;
  /** Whether a pending chain's description finds an index of it. */
  isIndexed?: boolean;
  /** Its number, the description's key; by default its place counted from the newest part. */
  key?: string;
  /** Seconds added to the times of this part and every later one: a time gap before it. */
  shiftSeconds?: number;
  /** Its modification time as the listing gives it; by default one minute apart per place. */
  modifiedAt?: string;
  /** Its size in bytes; by default 60 bytes a line. */
  size?: number;
  /**
   * The words its lines read in place of `LINE <n> part=<name>`, which a
   * rename changes: the same file keeps its text under any name.
   */
  text?: string;
  /** The second after `T0_MS` of its first line, in place of its global number's. */
  startSecond?: number;
}

export interface FakeChainOptions {
  dir?: string;
  name: string;
  /** The parts in the chain's order, oldest first. */
  parts: FakePart[];
  state?: 'pending' | 'ready' | 'invalid';
  reasons?: ChainReason[];
  missing?: string[];
  gaps?: ChainResponse['gaps'];
  /** How the index task ends for a status request after `finishTask`. */
  taskEnd?: 'completed' | 'gone';
  /** Features `/health` lists; `log_chains` and `samples_index_build` by default. */
  features?: string[];
}

interface Answer {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Headers;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}

function answer(status: number, body: unknown, headers: Record<string, string> = {}): Answer {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    headers: new Headers(headers),
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

/** The modification time of the part at `place` when the test gives none: a minute apart each. */
function defaultModifiedAt(place: number): string {
  return new Date(T0_MS + place * 60_000).toISOString().replace('Z', '000Z');
}

/** The id of the chain's index task. */
export const CHAIN_TASK_ID = 'ct1';

const DAY_MS = 86_400_000;

/** A date and time as the fake reads one, in UTC: `2026-10-01T00:30`, seconds and `Z` optional. */
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z?$/;

/** A time of day without a date: `00:30` or `00:30:15`. */
const TIME_OF_DAY = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;

export class FakeChain {
  readonly dir: string;
  readonly name: string;
  /** The parts in the chain's order, oldest first; `rotateTo` replaces them. */
  parts: FakePart[];
  state: 'pending' | 'ready' | 'invalid';
  fingerprint = '00000000000000a1';
  /** Whether the handle names no chain any more: every chain route answers 404. */
  isGone = false;
  /**
   * Requests by global line or time on a pending chain that answer 503,
   * with `Retry-After: retryAfter` (left out when null), before they
   * answer as before.
   */
  busyAnswers = 0;
  retryAfter: string | null = '5';
  /**
   * Why a pending chain has no index task: while set, its description and
   * the answers about one part name no task and give this reason.
   */
  refusedBuild: string | null = null;
  /** Zones a description refuses with 400, as a backend without them in its zone database does. */
  readonly refusedZones = new Set<string>();
  /** While set, samples requests wait for it (or for their signal to abort) before they answer. */
  private held: Promise<void> | null = null;
  private release: () => void = () => {};
  private rotations = 0;
  /** Whether the files change before every samples request, as a flapping writer would. */
  keepsChanging = false;
  /**
   * The progress the index task reports while it runs: one value per
   * status request, in order, before the task waits for `finishTask`.
   */
  progress: number[] = [];
  /** A change to every piece the chain answers with, as a faulty backend would make. */
  rewritePiece: ((piece: ChainPiece) => ChainPiece) | null = null;
  private changes = 0;
  /** The query of every `/v1/logs/samples` request, in order. */
  readonly samplesRequests: URLSearchParams[] = [];
  /** Every request's path and query, in order. */
  readonly requests: string[] = [];
  /** The `Prefer` header of every samples request. */
  readonly prefers: (string | null)[] = [];
  private readonly options: FakeChainOptions;
  private finish: () => void = () => {};
  private readonly finished: Promise<void>;
  private isFinished = false;

  constructor(options: FakeChainOptions) {
    this.options = options;
    this.dir = options.dir ?? '/l';
    this.name = options.name;
    this.parts = options.parts;
    this.state = options.state ?? 'ready';
    this.finished = new Promise((resolve) => (this.finish = resolve));
  }

  get handle(): string {
    return `${this.dir}/${this.name}`;
  }

  /** The global number of the first line of each part, in order. */
  private starts(): number[] {
    let next = 1;
    return this.parts.map((part) => {
      const start = next;
      next += part.lines;
      return start;
    });
  }

  get totalLines(): number {
    return this.parts.reduce((sum, part) => sum + part.lines, 0);
  }

  /** The seconds added to the times of part `i`: the shifts of it and of every part before it. */
  private shiftOf(i: number): number {
    return this.parts.slice(0, i + 1).reduce((sum, part) => sum + (part.shiftSeconds ?? 0), 0);
  }

  /** The timestamp of global line `n`, a line of part `i`. */
  timeOf(n: number, i: number): number {
    const start = this.parts[i].startSecond;
    if (start !== undefined) return T0_MS + (start + n - this.starts()[i]) * 1000;
    return T0_MS + (n + this.shiftOf(i)) * 1000;
  }

  /** The text of global line `n`, of part `i` and its local line `local`. */
  lineText(n: number, i: number, local: number): string {
    const time = new Date(this.timeOf(n, i)).toISOString();
    const text = this.parts[i].text;
    if (text !== undefined) return `${time} ${text} local=${local}`;
    return `${time} LINE ${n} part=${this.parts[i].name} local=${local}`;
  }

  /** The text of line `local` of the part `name`, as the chain and the part as a file read it. */
  partLineText(name: string, local: number): string {
    const i = this.parts.findIndex((p) => p.name === name);
    if (i < 0) throw new Error(`${name} is not a part`);
    return this.lineText(this.starts()[i] + local - 1, i, local);
  }

  /**
   * End the index task: the task's status says how it ended, and the
   * chain is ready unless `isReady` is false, or invalid with `isValid`
   * false.
   */
  finishTask({ isReady = true, isValid = true } = {}): void {
    if (isReady) this.state = isValid ? 'ready' : 'invalid';
    this.isFinished = true;
    this.finish();
  }

  /** A rotation: the files changed, so an old fingerprint answers 409. */
  rotate(): void {
    this.fingerprint = '00000000000000b2';
  }

  /**
   * A rotation that leaves `parts` on disk: renamed, compressed, new and
   * removed files, each keeping its `text` and `startSecond`. The chain
   * is `state` after it (a numbered rotation leaves it pending until its
   * renamed parts are indexed again).
   */
  rotateTo(parts: FakePart[], state: 'pending' | 'ready' | 'invalid' = this.state): void {
    this.rotations += 1;
    this.parts = parts;
    this.state = state;
    this.fingerprint = (0xb00 + this.rotations).toString(16).padStart(16, '0');
  }

  private isReady(): boolean {
    return this.state === 'ready';
  }

  private indexTask() {
    return {
      task_id: CHAIN_TASK_ID,
      status: 'running',
      message: `Indexing the log chain ${this.handle}`,
      path: this.handle,
      started_at: null,
    };
  }

  /**
   * The chain as rx-go describes it. Under a zone (`file_tz`) every part
   * says it is read in that zone, as rx-go's `assumed_zone` does; the
   * times stay as they are.
   */
  description(fileTz: string | null = null): ChainResponse {
    const starts = this.starts();
    const ready = this.isReady();
    const parts: ChainPart[] = this.parts.map((part, i) => {
      const isIndexed = ready || (part.isIndexed ?? false);
      const known = isIndexed && !part.isActive;
      const first = starts[i];
      return {
        name: part.name,
        path: `${this.dir}/${part.name}`,
        is_active: part.isActive ?? false,
        key: part.isActive ? null : (part.key ?? String(this.parts.length - 1 - i)),
        compression_format: part.compression ?? null,
        size: part.size ?? part.lines * 60,
        modified_at: part.modifiedAt ?? defaultModifiedAt(i),
        is_indexed: isIndexed && part.lines > 0,
        line_count: known || (ready && part.isActive) ? part.lines : null,
        first_ms: part.lines > 0 && (known || ready) ? this.timeOf(first, i) : null,
        last_ms: part.lines > 0 && (known || ready) ? this.timeOf(first + part.lines - 1, i) : null,
        max_ms: part.lines > 0 && known ? this.timeOf(first + part.lines - 1, i) : null,
        max_is_bound: false,
        global_start: ready ? first : null,
        time_format: { format: 'iso', has_zone: true, assumed_zone: fileTz ?? 'UTC' },
        day_first: null,
        example: null,
        duplicates: [],
      };
    });
    const frozen = this.parts.filter((p) => !p.isActive).reduce((sum, p) => sum + p.lines, 0);
    const timed = parts.filter((part) => part.first_ms !== null);
    return {
      path: this.handle,
      name: this.name,
      state: this.state,
      reasons: this.state === 'invalid' ? (this.options.reasons ?? []) : [],
      fingerprint: this.fingerprint,
      parts,
      missing: this.options.missing ?? [],
      missing_count: (this.options.missing ?? []).length,
      gaps: ready ? (this.options.gaps ?? []) : [],
      first_ms: ready ? (timed[0]?.first_ms ?? null) : null,
      last_ms: ready ? (timed.at(-1)?.last_ms ?? null) : null,
      frozen_line_count: ready ? frozen : null,
      line_count: ready ? this.totalLines : null,
      index_build: this.state === 'pending' && this.refusedBuild === null ? this.indexTask() : null,
      index_build_refused: this.state === 'pending' ? this.refusedBuild : null,
      cli_command: `rx logs show ${this.handle}`,
    };
  }

  /** The pieces of global lines `first` to `last`, split at part edges. */
  private globalPieces(first: number, last: number): ChainPiece[] {
    const starts = this.starts();
    const pieces: ChainPiece[] = [];
    this.parts.forEach((part, i) => {
      const from = Math.max(first, starts[i]);
      const to = Math.min(last, starts[i] + part.lines - 1);
      if (from > to) return;
      pieces.push(this.piece(i, from - starts[i] + 1, to - starts[i] + 1, true));
    });
    return pieces;
  }

  /** The piece of local lines `from` to `to` of part `i`. */
  private piece(i: number, from: number, to: number, withGlobal: boolean): ChainPiece {
    const part = this.parts[i];
    const start = this.starts()[i];
    const lines: string[] = [];
    const times: number[] = [];
    for (let local = from; local <= to; local++) {
      const n = start + local - 1;
      lines.push(this.lineText(n, i, local));
      times.push(this.timeOf(n, i));
    }
    const piece: ChainPiece = {
      part: part.name,
      first_local_line: from,
      first_global_line: withGlobal ? start + from - 1 : -1,
      lines,
      line_timestamps: times,
      part_start: from === 1,
      part_end: to === part.lines,
      cli_command: `rx samples ${this.dir}/${part.name} --lines=${from}-${to}`,
    };
    return this.rewritePiece ? this.rewritePiece(piece) : piece;
  }

  private samplesBody(
    query: URLSearchParams,
    samples: Record<string, ChainPiece[] | null>,
    lines: Record<string, number>,
    timestamps: Record<string, number>,
    state: 'pending' | 'ready',
  ) {
    const context = Number(query.get('context') ?? 3);
    const flags = [...query.entries()]
      .filter(([name]) => name !== 'path' && name !== 'fingerprint')
      .map(([name, value]) => `--${name.replace('_', '-')}=${value}`)
      .join(' ');
    return {
      path: this.handle,
      name: this.name,
      state,
      fingerprint: this.fingerprint,
      parts: this.description(query.get('file_tz')).parts,
      before_context: Number(query.get('before_context') ?? context),
      after_context: Number(query.get('after_context') ?? context),
      lines,
      timestamps,
      samples,
      index_build: state === 'pending' && this.refusedBuild === null ? this.indexTask() : null,
      index_build_refused: state === 'pending' ? this.refusedBuild : null,
      cli_command: `rx logs samples ${this.handle} ${flags}`,
    };
  }

  /** Answer one `/v1/logs/samples` request. */
  private samples(query: URLSearchParams, prefer: string | null): Answer {
    this.samplesRequests.push(query);
    this.prefers.push(prefer);
    if (this.isGone) return answer(404, { detail: 'not a log chain' });
    if (this.keepsChanging) {
      this.changes += 1;
      this.fingerprint = this.changes.toString(16).padStart(16, 'c');
    }
    const fingerprint = query.get('fingerprint');
    if (fingerprint !== null && fingerprint !== this.fingerprint) {
      return answer(409, this.description());
    }
    if (this.state === 'invalid') {
      const reasons = (this.options.reasons ?? []).map((r) => `${r.code}: ${r.message}`);
      return answer(422, { detail: `the chain is invalid: ${reasons.join('; ')}` });
    }
    const context = Number(query.get('context') ?? 3);
    const before = Number(query.get('before_context') ?? context);
    const after = Number(query.get('after_context') ?? context);
    const partName = query.get('part');
    const spec = query.get('lines');
    const times = query.getAll('timestamps');

    if (partName !== null && spec !== null)
      return this.partSamples(query, partName, spec, before, after);
    if (!this.isReady()) {
      if (this.busyAnswers > 0) {
        this.busyAnswers -= 1;
        const headers: Record<string, string> =
          this.retryAfter === null ? {} : { 'Retry-After': this.retryAfter };
        return answer(503, { detail: 'no place for the chain index task' }, headers);
      }
      if (prefer === 'respond-async') return answer(202, this.indexTask());
      return answer(500, { detail: 'the fake waits for no task' });
    }
    if (times.length > 0) return this.timeSamples(query, times[0], before, after);
    return this.globalSamples(query, spec ?? '1', before, after);
  }

  private globalSamples(query: URLSearchParams, spec: string, before: number, after: number) {
    const total = this.totalLines;
    const range = /^(\d+)-(\d+)$/.exec(spec);
    let key = spec;
    let first: number;
    let last: number;
    if (range) {
      first = Number(range[1]);
      last = Math.min(Number(range[2]), total);
    } else {
      const line = spec === '-1' ? total : Number(spec);
      key = String(line);
      first = Math.max(1, line - before);
      last = Math.min(total, line + after);
    }
    const pieces = first <= last ? this.globalPieces(first, last) : null;
    const target = range ? Number(range[1]) : Number(key);
    const lines = { [key]: target <= total ? target : -1 };
    return answer(200, this.samplesBody(query, { [key]: pieces }, lines, {}, 'ready'));
  }

  /**
   * The instant a time query names, read as rx-go reads one: a date and
   * time in UTC, or a time of day on the chain's one day; a refusal for a
   * time of day on a chain of several days and for any other text.
   */
  private readTime(value: string): number | { refused: string } {
    if (DATE_TIME.test(value)) return Date.parse(value.endsWith('Z') ? value : `${value}Z`);
    const timeOfDay = TIME_OF_DAY.exec(value);
    if (!timeOfDay) return { refused: `cannot read the time "${value}"` };
    const { first_ms: first, last_ms: last } = this.description();
    const dayOf = (ms: number) => Math.floor(ms / DAY_MS) * DAY_MS;
    if (first === null || last === null || dayOf(first) !== dayOf(last)) {
      return {
        refused: `a time of day without a date needs the chain's first and last timestamps on one day: "${value}"`,
      };
    }
    const [, hours, minutes, seconds] = timeOfDay.map(Number);
    return dayOf(first) + ((hours * 60 + minutes) * 60 + (seconds || 0)) * 1000;
  }

  /** The first line, in the chain's order, whose time is at or after `ms`; -1 when none is. */
  private lineAtTime(ms: number): number {
    const starts = this.starts();
    for (let i = 0; i < this.parts.length; i++) {
      const count = this.parts[i].lines;
      if (count === 0 || ms > this.timeOf(starts[i] + count - 1, i)) continue;
      return starts[i] + Math.max(0, Math.ceil((ms - this.timeOf(starts[i], i)) / 1000));
    }
    return -1;
  }

  /**
   * Answer `/v1/samples` for a part read as the file it is, as rx-go
   * answers one file: its own line numbers, the same lines and times the
   * chain gives them, a line with its context or a range, `-1` keyed by
   * the last line, null for a window past the end.
   */
  private fileSamples(query: URLSearchParams): Answer {
    const path = query.get('path') ?? '';
    const i = this.parts.findIndex((p) => `${this.dir}/${p.name}` === path);
    if (i < 0) return answer(404, { detail: `${path} not found` });
    const part = this.parts[i];
    const count = part.lines;
    const start = this.starts()[i];
    const spec = query.get('lines') ?? '1';
    const context = Number(query.get('context') ?? 3);
    const range = /^(\d+)-(\d+)$/.exec(spec);
    let key = spec;
    let first: number;
    let last: number;
    if (range) {
      first = Number(range[1]);
      last = Math.min(Number(range[2]), count);
    } else {
      const line = spec === '-1' ? count : Number(spec);
      key = String(line);
      first = Math.max(1, line - context);
      last = Math.min(count, line + context);
    }
    const lines: string[] = [];
    const times: number[] = [];
    for (let local = first; local <= last; local++) {
      lines.push(this.lineText(start + local - 1, i, local));
      times.push(this.timeOf(start + local - 1, i));
    }
    return answer(200, {
      path,
      samples: { [key]: lines.length > 0 ? lines : null },
      line_timestamps: { [key]: lines.length > 0 ? times : null },
      before_context: context,
      after_context: context,
      lines: {},
      offsets: {},
      is_compressed: part.compression != null,
      compression_format: part.compression ?? null,
      cli_command: `rx samples ${path} --lines=${spec}`,
    });
  }

  /** The chain's directory as `/v1/tree` lists it: its parts as files. */
  private treeListing(query: URLSearchParams): Answer {
    const path = query.get('path');
    if (path !== null && path !== this.dir) return answer(404, { detail: 'not found' });
    const entries = this.parts.map((part, i) => ({
      name: part.name,
      path: `${this.dir}/${part.name}`,
      type: 'file',
      size: part.size ?? part.lines * 60,
      size_human: null,
      modified_at: part.modifiedAt ?? defaultModifiedAt(i),
      is_text: true,
      is_compressed: part.compression != null,
      compression_format: part.compression ?? null,
      is_indexed: false,
      line_count: null,
      children_count: null,
    }));
    return answer(200, {
      path: path ?? this.dir,
      parent: null,
      is_search_root: path === null || path === this.dir,
      entries,
      total_entries: entries.length,
      total_size: null,
      total_size_human: null,
    });
  }

  /** The chain as `/v1/logs/chains` lists it in its directory. */
  private chainListing(query: URLSearchParams): Answer {
    if (query.get('path') !== this.dir) return answer(200, { path: query.get('path'), chains: [] });
    const chains = this.isGone
      ? []
      : [
          {
            path: this.handle,
            name: this.name,
            parts: this.parts.map((part) => part.name),
            has_active: this.parts.some((part) => part.isActive),
            missing: this.options.missing ?? [],
            missing_count: (this.options.missing ?? []).length,
            size: this.parts.reduce((sum, part) => sum + (part.size ?? part.lines * 60), 0),
            compression_formats: [],
            is_indexed: this.isReady(),
            unreadable: [],
            too_many_parts: false,
          },
        ];
    return answer(200, { path: this.dir, chains });
  }

  private timeSamples(query: URLSearchParams, value: string, before: number, after: number) {
    const ms = this.readTime(value);
    if (typeof ms !== 'number') return answer(400, { detail: ms.refused });
    const line = this.lineAtTime(ms);
    if (line === -1) {
      return answer(200, this.samplesBody(query, { [value]: null }, {}, { [value]: -1 }, 'ready'));
    }
    const pieces = this.globalPieces(
      Math.max(1, line - before),
      Math.min(this.totalLines, line + after),
    );
    return answer(
      200,
      this.samplesBody(query, { [value]: pieces }, {}, { [value]: line }, 'ready'),
    );
  }

  private partSamples(
    query: URLSearchParams,
    partName: string,
    spec: string,
    before: number,
    after: number,
  ) {
    const i = this.parts.findIndex((p) => p.name === partName);
    if (i < 0) return answer(400, { detail: `${partName} is not a part of the chain` });
    const count = this.parts[i].lines;
    const start = this.starts()[i];
    const ready = this.isReady();
    const range = /^(\d+)-(\d+)$/.exec(spec);
    let key = spec;
    let samples: ChainPiece[] | null;
    let target: number;
    if (range) {
      const from = Number(range[1]);
      const to = Math.min(Number(range[2]), count);
      samples = from <= to ? [this.piece(i, from, to, ready)] : null;
      target = ready && from <= count ? start + from - 1 : -1;
    } else {
      const local = spec === '-1' ? count : Number(spec);
      key = String(local);
      target = ready && local <= count ? start + local - 1 : -1;
      if (ready && local <= count) {
        const g = start + local - 1;
        samples = this.globalPieces(Math.max(1, g - before), Math.min(this.totalLines, g + after));
      } else {
        const from = Math.max(1, Math.min(local, count) - before);
        const to = Math.min(count, local + after);
        samples = from <= to ? [this.piece(i, from, to, ready)] : null;
      }
    }
    const state = ready ? 'ready' : 'pending';
    return answer(200, this.samplesBody(query, { [key]: samples }, { [key]: target }, {}, state));
  }

  /** Answer one task status request: running until `finishTask`, then as `taskEnd` says. */
  private async taskStatus(): Promise<Answer> {
    const progress = this.progress.shift();
    if (progress !== undefined) return answer(200, this.taskState('running', progress));
    await this.finished;
    if (this.options.taskEnd === 'gone') return answer(404, { detail: 'Task not found' });
    return answer(200, this.taskState('completed', 1));
  }

  /** The index task's status: a completed task holds its result. */
  private taskState(status: 'running' | 'completed', progress: number): TaskStatus {
    return {
      task_id: CHAIN_TASK_ID,
      status,
      path: this.handle,
      operation: 'chain_index',
      started_at: null,
      completed_at: null,
      error: null,
      progress,
      result:
        status === 'completed'
          ? { path: this.handle, built: [], cli_command: `rx logs index ${this.handle}` }
          : null,
    };
  }

  /**
   * A search of the chain, by its handle or its directory, as rx-go
   * answers `/v1/logs/trace`: its parts are the files `f1`, `f2`, … in the
   * chain's order, and each line that `regexp` (read as a JavaScript
   * pattern) finds is a match with its part's own line, byte offset and,
   * once the chain is ready, its global line.
   */
  private trace(query: URLSearchParams): Answer {
    const paths = query.getAll('path');
    if (!paths.every((path) => path === this.handle || path === this.dir)) {
      return answer(404, { detail: 'not found' });
    }
    const pattern = new RegExp(query.get('regexp') ?? '');
    const ready = this.isReady();
    const starts = this.starts();
    const files: Record<string, string> = {};
    const matches: ChainMatch[] = [];
    this.parts.forEach((part, i) => {
      const file = `f${i + 1}`;
      files[file] = `${this.dir}/${part.name}`;
      let offset = 0;
      for (let local = 1; local <= part.lines; local++) {
        const global = starts[i] + local - 1;
        const text = this.lineText(global, i, local);
        if (pattern.test(text)) {
          matches.push({
            pattern: 'p1',
            file,
            offset,
            relative_line_number: local,
            absolute_line_number: local,
            line_text: text,
            submatches: [],
            line_text_truncated: false,
            submatches_truncated: false,
            chain: 'c1',
            chain_line: ready ? global : -1,
          });
        }
        offset += text.length + 1;
      }
    });
    const body: ChainTraceResponse = {
      request_id: 'fake',
      path: paths,
      patterns: { p1: query.get('regexp') ?? '' },
      files,
      matches,
      chains: {
        c1: {
          path: this.handle,
          name: this.name,
          parts: Object.keys(files),
          fingerprint: this.fingerprint,
          state: this.state,
          reasons: this.state === 'invalid' ? (this.options.reasons ?? []) : [],
        },
      },
      scanned_files: [],
      skipped_files: [],
      skip_reasons: [],
      max_results: null,
      file_chunks: Object.fromEntries(Object.keys(files).map((file) => [file, 1])),
      context_lines: {},
      before_context: null,
      after_context: null,
      time: 0.01,
      cli_command: `rx logs trace ${paths.join(' ')} --regexp=${query.get('regexp')}`,
    };
    return answer(200, body);
  }

  /** Hold every samples request until `releaseSamples`, as a slow backend would. */
  holdSamples(): void {
    this.held = new Promise((resolve) => (this.release = resolve));
  }

  /** Answer the samples requests held since `holdSamples`, and hold no more. */
  releaseSamples(): void {
    this.held = null;
    this.release();
  }

  /** Wait while samples requests are held; an aborted signal rejects as `fetch` does. */
  private async waitWhileHeld(signal: AbortSignal | null | undefined): Promise<void> {
    const held = this.held;
    if (held === null) return;
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        const error = new Error('The request was aborted');
        error.name = 'AbortError';
        reject(error);
      };
      if (signal?.aborted) abort();
      signal?.addEventListener('abort', abort, { once: true });
      void held.then(resolve);
    });
  }

  /** Whether `finishTask` was called. */
  get hasFinished(): boolean {
    return this.isFinished;
  }

  /** Answer a request the way rx-go would. */
  async fetch(url: string, init?: RequestInit): Promise<Answer> {
    const parsed = new URL(url, 'http://localhost');
    const query = parsed.searchParams;
    this.requests.push(`${parsed.pathname}${parsed.search}`);
    const prefer = new Headers(init?.headers).get('Prefer');
    switch (parsed.pathname) {
      case '/health':
        return answer(200, {
          contract_version: '1.7',
          features: this.options.features ?? ['log_chains', 'samples_index_build'],
        });
      case '/v1/logs/chain': {
        if (query.get('path') !== this.handle || this.isGone) {
          return answer(404, { detail: 'not a log chain' });
        }
        const zone = query.get('file_tz');
        if (zone !== null && this.refusedZones.has(zone)) {
          return answer(400, { detail: `unknown time zone "${zone}"` });
        }
        const fingerprint = query.get('fingerprint');
        if (fingerprint !== null && fingerprint !== this.fingerprint) {
          return answer(409, this.description(query.get('file_tz')));
        }
        return answer(200, this.description(query.get('file_tz')));
      }
      case '/v1/logs/samples':
        await this.waitWhileHeld(init?.signal);
        return this.samples(query, prefer);
      case '/v1/logs/trace':
        return this.trace(query);
      case '/v1/logs/chains':
        return this.chainListing(query);
      case '/v1/samples':
        return this.fileSamples(query);
      case '/v1/tree':
        return this.treeListing(query);
      case `/v1/tasks/${CHAIN_TASK_ID}`:
        return this.taskStatus();
      default:
        return answer(404, { detail: 'not found' });
    }
  }
}

/** Serve `chain` as the whole backend, through a stubbed `fetch`. */
export function serveChain(chain: FakeChain) {
  const spy = vi.fn((url: string, init?: RequestInit) => chain.fetch(url, init));
  vi.stubGlobal('fetch', spy);
  return spy;
}
