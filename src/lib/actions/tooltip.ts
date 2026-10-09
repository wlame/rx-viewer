/**
 * `use:tooltip={{ label, shortcut, detail }}`: a styled tooltip that
 * names a control and the keys of its shortcut, as this platform prints
 * them.
 *
 * Every trigger shares one element, `#rx-tooltip` in `document.body`,
 * shown for one trigger at a time. It appears after a hover of
 * `TOOLTIP_DELAY_MS`, and at once when the keyboard focuses the trigger
 * (`:focus-visible`). It hides when the pointer leaves, the trigger
 * loses focus, Escape is pressed on it, anything scrolls (after the frame
 * it was shown in), a pointer is pressed, or the trigger stops being
 * drawn or is destroyed. While it is shown, the trigger's
 * `aria-describedby` names it.
 *
 * The text is set with `textContent` only: a label may hold a file name.
 */
import {
  detectPlatform,
  matchesChord,
  shortcutKeys,
  type KeyChord,
  type Platform,
  type ShortcutId,
} from '$lib/utils/shortcuts';

export interface TooltipParams {
  label: string;
  /** The shortcut row whose first chord the tooltip shows as keys. */
  shortcut?: ShortcutId;
  /** A second line under the label. */
  detail?: string;
}

export const TOOLTIP_ID = 'rx-tooltip';
export const TOOLTIP_DELAY_MS = 500;
/** The space between a trigger and its tooltip, in CSS pixels. */
export const TOOLTIP_GAP_PX = 6;
/** The least space between a tooltip and an edge of the window, in CSS pixels. */
export const TOOLTIP_EDGE_PX = 8;

/**
 * The key that hides a tooltip, pressed on its trigger. It is not a row
 * of the shortcut table, whose help lists what a key does in the viewer;
 * the key is not cancelled, so a dialog around the trigger still closes.
 */
const HIDE_KEY: KeyChord = { key: 'Escape' };

/** What stands between two keys of a chord: ⌥G on a Mac, Alt+G elsewhere. */
const KEY_SEPARATOR: Readonly<Record<Platform, string>> = { mac: '', other: '+' };

const TOOLTIP_CLASS =
  'pointer-events-none fixed z-50 max-w-xs rounded-md border px-2 py-1 text-xs shadow-md ' +
  'border-gh-border-default bg-gh-canvas-subtle text-gh-fg-default ' +
  'dark:border-gh-border-dark-default dark:bg-gh-canvas-dark-subtle dark:text-gh-fg-dark-default';
const LABEL_LINE_CLASS = 'flex items-center gap-2';
const KEYS_CLASS = 'flex items-center gap-0.5 text-gh-fg-muted dark:text-gh-fg-dark-muted';
const KBD_CLASS =
  'rounded border px-1 leading-4 whitespace-nowrap ' +
  'border-gh-border-default bg-gh-canvas-default ' +
  'dark:border-gh-border-dark-default dark:bg-gh-canvas-dark-default';
const DETAIL_CLASS = 'mt-0.5 text-gh-fg-muted dark:text-gh-fg-dark-muted';

/** The trigger whose tooltip is shown, or null when none is. */
let owner: HTMLElement | null = null;
/** Watches the owner while its tooltip is shown, to hide it when it is no longer drawn. */
let drawnWatch: IntersectionObserver | null = null;
/** The frame until which a scroll does not hide the tooltip, or null when every scroll does. */
let scrollGraceFrame: number | null = null;

interface Size {
  width: number;
  height: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

/**
 * Where a tooltip of `size` goes for a trigger at `anchor`, in window
 * coordinates: below the trigger and centred on it; above it when below
 * would leave the window; never nearer than `TOOLTIP_EDGE_PX` to an edge.
 */
export function tooltipPosition(
  anchor: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  size: Size,
  viewport: Size,
): { left: number; top: number } {
  const below = anchor.top + anchor.height + TOOLTIP_GAP_PX;
  const above = anchor.top - TOOLTIP_GAP_PX - size.height;
  const fitsBelow = below + size.height <= viewport.height - TOOLTIP_EDGE_PX;
  const centred = anchor.left + anchor.width / 2 - size.width / 2;
  return {
    left: clamp(centred, TOOLTIP_EDGE_PX, viewport.width - TOOLTIP_EDGE_PX - size.width),
    top: clamp(
      fitsBelow ? below : above,
      TOOLTIP_EDGE_PX,
      viewport.height - TOOLTIP_EDGE_PX - size.height,
    ),
  };
}

/** The shared tooltip element, made and added to the page on first use. */
function tooltipElement(): HTMLElement {
  const existing = document.getElementById(TOOLTIP_ID);
  if (existing) return existing;
  const element = document.createElement('div');
  element.id = TOOLTIP_ID;
  element.setAttribute('role', 'tooltip');
  element.className = TOOLTIP_CLASS;
  element.hidden = true;
  document.body.appendChild(element);
  return element;
}

function textElement(tag: string, className: string, text: string): HTMLElement {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

/** One `<kbd>` per key, with the platform's separator between them. */
function keysElement(keys: readonly string[], platform: Platform): HTMLElement {
  const group = textElement('span', KEYS_CLASS, '');
  keys.forEach((key, index) => {
    if (index > 0 && KEY_SEPARATOR[platform]) {
      group.appendChild(document.createTextNode(KEY_SEPARATOR[platform]));
    }
    group.appendChild(textElement('kbd', KBD_CLASS, key));
  });
  return group;
}

/** The lines of a tooltip: the label and the keys, then the detail when there is one. */
function tooltipLines(params: TooltipParams, platform: Platform): HTMLElement[] {
  const labelLine = textElement('div', LABEL_LINE_CLASS, '');
  labelLine.appendChild(textElement('span', '', params.label));
  const keys = params.shortcut ? shortcutKeys(params.shortcut, platform)[0] : undefined;
  if (keys) labelLine.appendChild(keysElement(keys, platform));
  const lines = [labelLine];
  if (params.detail) lines.push(textElement('div', DETAIL_CLASS, params.detail));
  return lines;
}

/** The ids in `node`'s `aria-describedby`, without the tooltip's. */
function otherDescriptions(node: HTMLElement): string[] {
  const ids = (node.getAttribute('aria-describedby') ?? '').split(/\s+/);
  return ids.filter((id) => id !== '' && id !== TOOLTIP_ID);
}

function describeByTooltip(node: HTMLElement): void {
  node.setAttribute('aria-describedby', [...otherDescriptions(node), TOOLTIP_ID].join(' '));
}

function stopDescribingByTooltip(node: HTMLElement): void {
  const others = otherDescriptions(node);
  if (others.length > 0) node.setAttribute('aria-describedby', others.join(' '));
  else node.removeAttribute('aria-describedby');
}

/**
 * Hide the tooltip when its trigger is no longer drawn: a panel hidden
 * around it (`display: none`, `hidden`) moves no pointer and may move no
 * focus, so neither `mouseleave` nor `blur` would come.
 */
function watchWhileShown(node: HTMLElement): void {
  if (typeof IntersectionObserver === 'undefined') return;
  drawnWatch = new IntersectionObserver((entries) => {
    const latest = entries[entries.length - 1];
    if (owner === node && latest && !latest.isIntersecting) hideTooltip();
  });
  drawnWatch.observe(node);
}

/**
 * Let no scroll hide the tooltip until the next frame. A keyboard focus
 * that scrolls its trigger into view sends `scroll` after `focus`, in the
 * next frame and before that frame's animation callbacks; that scroll is
 * not the user's, and the tooltip it would hide at once stays.
 */
function ignoreScrollUntilNextFrame(): void {
  if (typeof requestAnimationFrame === 'undefined') return;
  scrollGraceFrame = requestAnimationFrame(() => {
    scrollGraceFrame = null;
  });
}

function hideOnScroll(): void {
  if (scrollGraceFrame === null) hideTooltip();
}

function hideTooltip(): void {
  if (!owner) return;
  stopDescribingByTooltip(owner);
  owner = null;
  const element = document.getElementById(TOOLTIP_ID);
  if (element) element.hidden = true;
  window.removeEventListener('scroll', hideOnScroll, true);
  window.removeEventListener('pointerdown', hideTooltip, true);
  drawnWatch?.disconnect();
  drawnWatch = null;
  if (scrollGraceFrame !== null) cancelAnimationFrame(scrollGraceFrame);
  scrollGraceFrame = null;
}

function showTooltip(node: HTMLElement, params: TooltipParams): void {
  if (owner !== node) {
    hideTooltip();
    owner = node;
    describeByTooltip(node);
    window.addEventListener('scroll', hideOnScroll, true);
    window.addEventListener('pointerdown', hideTooltip, true);
    watchWhileShown(node);
    ignoreScrollUntilNextFrame();
  }
  const element = tooltipElement();
  element.replaceChildren(...tooltipLines(params, detectPlatform()));
  element.hidden = false;
  // A fixed box with `left` set is at most as wide as the room right of
  // it; measured where the last tooltip stood, near the right edge, a
  // longer one would wrap and keep that narrow size.
  element.style.left = '0px';
  element.style.top = '0px';
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const size = { width: element.offsetWidth, height: element.offsetHeight };
  const { left, top } = tooltipPosition(node.getBoundingClientRect(), size, viewport);
  element.style.left = `${left}px`;
  element.style.top = `${top}px`;
}

/** Svelte action: give `node` the shared tooltip. */
export function tooltip(
  node: HTMLElement,
  params: TooltipParams,
): { update(params: TooltipParams): void; destroy(): void } {
  let current = params;
  let pendingShow: ReturnType<typeof setTimeout> | undefined;

  function cancelPendingShow(): void {
    clearTimeout(pendingShow);
    pendingShow = undefined;
  }

  function showNow(): void {
    cancelPendingShow();
    showTooltip(node, current);
  }

  function hideOwn(): void {
    cancelPendingShow();
    if (owner === node) hideTooltip();
  }

  const listeners: readonly [string, (event: Event) => void][] = [
    [
      'mouseenter',
      () => {
        if (owner !== node && pendingShow === undefined) {
          pendingShow = setTimeout(showNow, TOOLTIP_DELAY_MS);
        }
      },
    ],
    ['mouseleave', hideOwn],
    [
      'focus',
      () => {
        if (node.matches(':focus-visible')) showNow();
      },
    ],
    ['blur', hideOwn],
    [
      'keydown',
      (event) => {
        if (matchesChord(HIDE_KEY, event as KeyboardEvent)) hideOwn();
      },
    ],
    ['pointerdown', cancelPendingShow],
  ];
  for (const [type, listener] of listeners) node.addEventListener(type, listener);

  return {
    update(next) {
      current = next;
      if (owner === node) showTooltip(node, current);
    },
    destroy() {
      hideOwn();
      for (const [type, listener] of listeners) node.removeEventListener(type, listener);
    },
  };
}
