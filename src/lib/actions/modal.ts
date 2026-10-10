/**
 * `use:modal` on a modal dialog's element: while the element is in the
 * page, `modalOpen` holds, so the window-wide keys that would show a
 * panel behind the dialog, move the focus out of it or hide it leave the
 * keyboard to the dialog. Every `aria-modal="true"` element carries it.
 */
import { registerModal } from '$lib/stores/layout';

/** Svelte action: count the dialog as open until it leaves the page. */
export function modal(_dialog: HTMLElement): { destroy(): void } {
  return { destroy: registerModal() };
}
