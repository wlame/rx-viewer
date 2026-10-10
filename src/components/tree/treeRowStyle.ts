/**
 * The keyboard focus ring of a file tree row, shared by the folder, file
 * and chain rows: a ring inside the row, so the tree's scroll box does
 * not clip it, drawn only for a focus the keyboard moved.
 */
export const TREE_ROW_FOCUS_CLASS =
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset ' +
  'focus-visible:ring-gh-accent-emphasis dark:focus-visible:ring-gh-accent-dark-emphasis';
