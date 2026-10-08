/**
 * What the editor pane and the tab row show of a log chain's tab: the
 * gutter labels, the line readout, and the caption with the part of the
 * top line. Pure, so it is tested without an editor.
 */
import type { ChainNumbering, ChainPart, ChainTab, FileLine } from '../types';
import { chainCaption } from './chainParts';

/** The part of the line at the top of the view: its place in the chain's order (from 1) and its line. */
export interface ChainTopLine {
  partNumber: number;
  part: string;
  localLine: number;
}

/**
 * The gutter label of each held line of a pending chain: its line in its
 * part. Null for a ready chain, whose gutter shows the global numbers the
 * lines are numbered by.
 */
export function chainLineLabels(
  lines: readonly FileLine[],
  numbering: ChainNumbering,
): string[] | null {
  if (numbering === 'global') return null;
  return lines.map((line) => String(line.localLine ?? ''));
}

/** A line as `part:line`, the form the chain's line box reads. */
function partLine(line: FileLine | undefined): string {
  return line?.part === undefined ? '' : `${line.part}:${line.localLine}`;
}

/**
 * The line readout of a pending chain: its first, middle and last held
 * lines as `part:line`. Null for a ready chain, whose readout shows global
 * numbers.
 */
export function chainRangeLabels(
  lines: readonly FileLine[],
  numbering: ChainNumbering,
): { start: string; middle: string; end: string } | null {
  if (numbering === 'global' || lines.length === 0) return null;
  return {
    start: partLine(lines[0]),
    middle: partLine(lines[Math.floor((lines.length - 1) / 2)]),
    end: partLine(lines[lines.length - 1]),
  };
}

/** The part of the held line on editor line `editorLine` (from 1), or null. */
export function topLineOf(
  lines: readonly FileLine[],
  editorLine: number,
  parts: readonly ChainPart[],
): ChainTopLine | null {
  const line = lines[editorLine - 1];
  if (line?.part === undefined || line.localLine === undefined) return null;
  const index = parts.findIndex((part) => part.name === line.part);
  if (index < 0) return null;
  return { partNumber: index + 1, part: line.part, localLine: line.localLine };
}

/**
 * The caption of a chain's tab, `syslog [3/12]`, with `syslog.3.gz : 500`
 * as its tooltip: the part of the line at the top of the view, or of the
 * anchor line until the editor reports one. The chain's name and handle
 * while neither is known.
 */
export function chainTabCaption(
  name: string,
  chain: Pick<ChainTab, 'handle' | 'description' | 'anchor'>,
  top: ChainTopLine | null,
): { caption: string; title: string } {
  const parts = chain.description?.parts ?? [];
  const anchorIndex = parts.findIndex((part) => part.name === chain.anchor?.part);
  const shown =
    top ??
    (chain.anchor !== null && anchorIndex >= 0
      ? { partNumber: anchorIndex + 1, part: chain.anchor.part, localLine: chain.anchor.line }
      : null);
  if (shown === null) return { caption: name, title: chain.handle };
  return {
    caption: chainCaption(name, shown.partNumber, parts.length),
    title: `${shown.part} : ${shown.localLine}`,
  };
}
