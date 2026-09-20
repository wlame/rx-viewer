/**
 * Whether a key press belongs to the element it landed on, to an input
 * method that is composing text, or to the viewer's shortcuts.
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

/** The parts of a KeyboardEvent that tell whether an input method has it. */
export interface CompositionState {
  isComposing?: boolean;
  keyCode?: number;
}

/**
 * The key code browsers report for a key press an input method took.
 * Safari sends the Enter that confirms a composition with this code and
 * `isComposing` already false.
 */
const INPUT_METHOD_KEY_CODE = 229;

/**
 * Reports whether an input method (IME) is composing text with this key
 * press, in which case the key belongs to the composition: Enter
 * confirms it and Escape cancels it. No shortcut acts on such a key.
 */
export function belongsToInputMethod(event: CompositionState): boolean {
  return Boolean(event.isComposing) || event.keyCode === INPUT_METHOD_KEY_CODE;
}
