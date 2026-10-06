import type { FileLine, SamplesResponse } from '../types';

/** The lines of a samples answer, numbered, and what they tell about the file's ends. */
export interface SampleWindow {
  /** The lines in file order, each with its 1-based line number. */
  lines: FileLine[];
  /** The window starts at line 1, so nothing comes before it. */
  reachedStart: boolean;
  /** No line follows the last line of the window: the file ends inside it or before it. */
  reachedEnd: boolean;
  /** The file's line count, when the window shows where the file ends; otherwise null. */
  lineCount: number | null;
}

/** The lines a key of the answer covers when the file is long enough to fill it. */
interface KeySpan {
  first: number;
  last: number;
}

/**
 * The span each kind of key asks for. A range `a-b` covers lines a to b
 * and takes no context. A line `N` covers its context on both sides,
 * clamped at line 1. rx-go echoes the requested context rather than the
 * part it could serve, so the first line comes from the key and the
 * context, never from the number of lines that came back.
 */
const KEY_SPANS: {
  pattern: RegExp;
  span: (match: RegExpExecArray, before: number, after: number) => KeySpan;
}[] = [
  {
    pattern: /^(\d+)-(\d+)$/,
    span: (m) => ({ first: Number(m[1]), last: Number(m[2]) }),
  },
  {
    pattern: /^(\d+)$/,
    span: (m, before, after) => ({
      first: Math.max(1, Number(m[1]) - before),
      last: Number(m[1]) + after,
    }),
  },
];

function spanOf(key: string, before: number, after: number): KeySpan {
  for (const { pattern, span } of KEY_SPANS) {
    const match = pattern.exec(key);
    if (match) return span(match, before, after);
  }
  throw new Error(`Unexpected samples key "${key}": expected a line or a range`);
}

/**
 * The parts of a `/v1/samples` answer a window is read from. An answer
 * without `line_timestamps` gives lines without a timestamp.
 */
export type WindowAnswer = Pick<SamplesResponse, 'samples' | 'before_context' | 'after_context'> &
  Partial<Pick<SamplesResponse, 'line_timestamps'>>;

/**
 * Read the window one key of a `/v1/samples` answer holds.
 *
 * A null value is a window that holds no line of the file: it starts
 * past the end, or the file is empty. Fewer lines than the span asks for
 * also means the file ended inside the window.
 */
function readKey(
  key: string,
  content: string[] | null,
  before: number,
  after: number,
  timestamps: readonly (number | null)[] | null | undefined,
): SampleWindow {
  const { first, last } = spanOf(key, before, after);
  const served = content ?? [];
  const lines: FileLine[] = served.map((text, i) =>
    timestamps
      ? { lineNumber: first + i, content: text, timestampMs: timestamps[i] ?? null }
      : { lineNumber: first + i, content: text },
  );
  const reachedEnd = served.length < last - first + 1;

  let lineCount: number | null = null;
  if (reachedEnd && lines.length > 0) lineCount = lines[lines.length - 1].lineNumber;
  else if (reachedEnd && first === 1) lineCount = 0;

  return { lines, reachedStart: first === 1, reachedEnd, lineCount };
}

/**
 * Turn a `/v1/samples` answer into one window of numbered lines.
 *
 * Every file loader asks for one key; an answer with several is merged,
 * deduplicated by line number and sorted. The window reaches an end when
 * any of its keys does.
 */
export function readSamplesAnswer(answer: WindowAnswer): SampleWindow {
  const byNumber = new Map<number, FileLine>();
  let reachedStart = false;
  let reachedEnd = false;
  let lineCount: number | null = null;

  for (const [key, content] of Object.entries(answer.samples)) {
    const window = readKey(
      key,
      content,
      answer.before_context,
      answer.after_context,
      answer.line_timestamps?.[key],
    );
    for (const line of window.lines) byNumber.set(line.lineNumber, line);
    reachedStart ||= window.reachedStart;
    reachedEnd ||= window.reachedEnd;
    lineCount ??= window.lineCount;
  }

  const lines = Array.from(byNumber.values()).sort((a, b) => a.lineNumber - b.lineNumber);
  return { lines, reachedStart, reachedEnd, lineCount };
}

/** What a time query found: its line and the window around it, or no line. */
export type TimeAnswer = { found: true; line: number; window: SampleWindow } | { found: false };

/** A time range (`T1..T2`, `..T2`, `T1..`) as `--timestamps` reads one. */
const isTimeRange = (value: string) => value.includes('..');

/**
 * Read the answer to one time query, `timestamps=<value>`.
 *
 * The backend files the window under the query as it was sent and names
 * the line it found in `timestamps`: the first line at or after the time,
 * served with the request's context like a line number, or the first
 * line of a range, served without context. The window is read as that
 * line's (or range's) own key would be. The backend's -1, with a null
 * sample, is no line at or after the time.
 */
export function readTimeAnswer(
  answer: WindowAnswer & Pick<SamplesResponse, 'timestamps'>,
  value: string,
): TimeAnswer {
  const line = answer.timestamps[value];
  if (line === undefined) {
    throw new Error(`The samples answer does not list the time "${value}"`);
  }
  if (line === -1) return { found: false };

  const content = answer.samples[value] ?? null;
  const key = isTimeRange(value)
    ? `${line}-${line + Math.max(content?.length ?? 0, 1) - 1}`
    : String(line);
  const window = readSamplesAnswer({
    samples: { [key]: content },
    before_context: answer.before_context,
    after_context: answer.after_context,
    line_timestamps: { [key]: answer.line_timestamps?.[value] ?? null },
  });
  return { found: true, line, window };
}
