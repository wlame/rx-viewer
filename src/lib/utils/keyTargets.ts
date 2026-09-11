/**
 * Whether a key press belongs to the element it landed on or to the
 * pane's shortcuts.
 */

/** The parts of a DOM element this module reads. */
export interface KeyTarget {
  tagName: string;
  isContentEditable: boolean;
  classList: { contains(name: string): boolean };
  closest(selector: string): unknown;
}

/** Monaco's own text area, the one that holds the editor's focus. */
const MONACO_TEXT_AREA_CLASS = 'inputarea';
/** Monaco's find widget, whose box takes typing even in a read-only editor. */
const MONACO_FIND_WIDGET = '.find-widget';

/**
 * Reports whether the element takes typed text, in which case a key
 * press is text and not a shortcut.
 *
 * The file editor is read-only, so its own text area takes no typing:
 * a shortcut pressed while it has focus — most of the time, since a
 * click in the text puts it there — belongs to the pane. The find
 * widget's box sits inside the same editor and does take typing.
 */
export function acceptsTyping(target: KeyTarget): boolean {
  const isTextField =
    target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
  if (!isTextField) return false;
  const isReadOnlyEditorText =
    target.classList.contains(MONACO_TEXT_AREA_CLASS) && !target.closest(MONACO_FIND_WIDGET);
  return !isReadOnlyEditorText;
}
