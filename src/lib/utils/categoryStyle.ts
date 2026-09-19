/**
 * How an anomaly category looks: the color of its chip in the editor's
 * header and in the minimap, and the class of its line highlights.
 *
 * Category names come from the backend's live /v1/detectors, and the two
 * backends name theirs differently, so no name is written here. Every
 * category gets a color from a fixed palette chosen by hashing its name:
 * the same category has the same color in every view and every session.
 */

export interface CategoryStyle {
  /** Chip and minimap color. */
  color: string;
  /**
   * Suffix of the editor's decoration classes:
   * `monaco-anomaly-<suffix>` for the line, `…-glyph` for the gutter.
   */
  decorationClass: string;
}

/**
 * The category colors. Thirteen: the smallest count from ten up at which
 * the hash puts rx-go's five category names on five different colors.
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
  '#6366f1', // indigo
  '#ec4899', // pink
  '#06b6d4', // cyan
];

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
  const index = hashName(category) % CATEGORY_PALETTE.length;
  return { color: CATEGORY_PALETTE[index], decorationClass: `palette-${index}` };
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
