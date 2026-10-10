/**
 * `use:takeFocus` on the control a dialog opens on: the control takes
 * the keyboard focus when it enters the page, so the keys reach the
 * dialog and a tooltip shown at the control focused before hides. It
 * takes it without scrolling, so a dialog whose control stands under a
 * long list still opens at its top. When it leaves the page, the
 * element that had the focus before gets it back, unless the focus has
 * gone on to another control meanwhile.
 */

/** Whether the focus is on no control: on the page, or on an element no longer in it. */
function isFocusLost(): boolean {
  const active = document.activeElement;
  return active === null || active === document.body || !active.isConnected;
}

/** Svelte action: focus `node` while it is in the page, then give the focus back. */
export function takeFocus(node: HTMLElement): { destroy(): void } {
  const previous = document.activeElement;
  node.focus({ preventScroll: true });
  return {
    destroy() {
      if (!isFocusLost()) return;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    },
  };
}
