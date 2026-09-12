/**
 * How an anomaly category looks: its color, label and symbol on the
 * editor's chips, and the class of its line highlights.
 *
 * A handful of categories have a hand-picked style. Every other one —
 * all of rx-go's, whose names come from its live /v1/detectors — gets a
 * color from a fixed palette chosen by hashing the name, so the same
 * category has the same color in every view and every session, and no
 * category name has to be written into the viewer.
 */

export interface CategoryStyle {
  /** Chip and minimap color. */
  color: string;
  /** Name shown in the chip's title. */
  label: string;
  /** A symbol, so chips differ by more than color. */
  symbol: string;
  /**
   * Suffix of the editor's decoration classes:
   * `monaco-anomaly-<suffix>` for the line, `…-glyph` for the gutter.
   */
  decorationClass: string;
}

/** Categories with a hand-picked style; their classes live in editorDecorations.css. */
const KNOWN_CATEGORIES: Record<string, Omit<CategoryStyle, 'decorationClass'>> = {
  error: { color: '#ef4444', label: 'Errors', symbol: '✖' }, // ✖
  warning: { color: '#f59e0b', label: 'Warnings', symbol: '⚠' }, // ⚠
  traceback: { color: '#dc2626', label: 'Tracebacks', symbol: '≡' }, // ≡
  format: { color: '#8b5cf6', label: 'Format', symbol: '¶' }, // ¶
  security: { color: '#ec4899', label: 'Security', symbol: '☢' }, // ☢
  timing: { color: '#06b6d4', label: 'Timing', symbol: '⏱' }, // ⏱
  multiline: { color: '#6366f1', label: 'Multiline', symbol: '☰' }, // ☰
};

/**
 * Colors for every other category. Ten, because with fewer two of
 * rx-go's five category names land on one color.
 */
export const CATEGORY_PALETTE = [
  '#0ea5e9', // sky
  '#22c55e', // green
  '#f97316', // orange
  '#a855f7', // purple
  '#14b8a6', // teal
  '#e11d48', // rose
  '#84cc16', // lime
  '#eab308', // yellow
  '#3b82f6', // blue
  '#d946ef', // fuchsia
];

/** Symbol for a category without a hand-picked one. */
const DEFAULT_SYMBOL = '•'; // •

/** FNV-1a over the name's UTF-16 code units: stable, and spreads short names well. */
function hashName(name: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** The style of one category. */
export function categoryStyle(category: string): CategoryStyle {
  const known = KNOWN_CATEGORIES[category];
  if (known) return { ...known, decorationClass: category };
  const index = hashName(category) % CATEGORY_PALETTE.length;
  return {
    color: CATEGORY_PALETTE[index],
    label: category,
    symbol: DEFAULT_SYMBOL,
    decorationClass: `palette-${index}`,
  };
}

/** `#rrggbb` as `rgba(r, g, b, alpha)`. */
function withAlpha(hex: string, alpha: number): string {
  const value = parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

/**
 * The decoration classes for the palette colors, as a stylesheet. Built
 * from CATEGORY_PALETTE so the classes and the chips cannot disagree.
 */
export function paletteStyleSheet(): string {
  return CATEGORY_PALETTE.map(
    (color, i) =>
      `.monaco-anomaly-palette-${i} { background-color: ${withAlpha(color, 0.15)} !important; }\n` +
      `.monaco-anomaly-palette-${i}-glyph { background-color: ${color} !important; }`,
  ).join('\n');
}

const PALETTE_STYLE_ID = 'rx-anomaly-palette';

/** Adds the palette stylesheet to the document once. */
export function installPaletteStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(PALETTE_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = PALETTE_STYLE_ID;
  style.textContent = paletteStyleSheet();
  document.head.appendChild(style);
}
