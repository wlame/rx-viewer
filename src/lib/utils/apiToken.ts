/**
 * The opt-in API token, for a backend started with RX_API_TOKEN.
 *
 * It arrives in the link the viewer is opened with, as `#token=…`. A URL
 * fragment never leaves the browser — it is not sent to the server, nor
 * in a Referer header, nor written to a proxy log — and on load it is
 * moved into storage and removed from the address bar, so it is not left
 * in the history or in a link someone copies. Every API request then
 * carries it as `Authorization: Bearer …`.
 *
 * It is kept in sessionStorage rather than only in memory. A script
 * running in this page could read either one — at worst by wrapping
 * `fetch` and reading the header — so memory alone protects nothing that
 * sessionStorage exposes, while it would lose the token on every reload.
 * sessionStorage belongs to one tab and is gone when the tab closes;
 * localStorage would outlive the session and reach every tab, so it is
 * not used. When storage is refused (a private window, blocked site
 * data) the token lives in memory for the page instead.
 */
import { writable } from 'svelte/store';

const STORAGE_KEY = 'rx.apiToken';
const HASH_KEY = 'token';

/** True once the backend has refused a request for want of a token. */
export const tokenRequired = writable(false);

/** The part of the Web Storage API this module uses. */
export interface TokenStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The token held for this page when storage refuses it. */
let memoryToken: string | null = null;

function sessionStorageOrNull(): TokenStorage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** The token this tab holds, or null. */
export function getApiToken(storage: TokenStorage | null = sessionStorageOrNull()): string | null {
  try {
    const stored = storage?.getItem(STORAGE_KEY) ?? null;
    if (stored) return stored;
  } catch {
    // Storage refused: fall through to the in-memory copy.
  }
  return memoryToken;
}

/** Keeps the token for this tab. */
export function setApiToken(
  token: string,
  storage: TokenStorage | null = sessionStorageOrNull(),
): void {
  memoryToken = token;
  try {
    storage?.setItem(STORAGE_KEY, token);
  } catch {
    // Storage refused: the in-memory copy serves this page.
  }
}

/** Forgets the token. */
export function clearApiToken(storage: TokenStorage | null = sessionStorageOrNull()): void {
  memoryToken = null;
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing stored to remove.
  }
}

/**
 * A token value from the link, percent-decoded. A value that is not
 * validly escaped (a bare `%` pasted into the link) is taken as written:
 * its `%` cannot be an escape, so it is part of the token.
 */
function decodeTokenValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Splits a `token=` entry out of a URL fragment such as `#token=abc&x=1`.
 *
 * The value is percent-decoded but a `+` stays a `+`: a token is not a
 * form field, and a base64 token may contain one. The other entries are
 * kept as they were written.
 */
export function takeTokenFromHash(hash: string): { token: string | null; hash: string } {
  const entries = (hash.startsWith('#') ? hash.slice(1) : hash).split('&').filter(Boolean);
  let token: string | null = null;
  const rest: string[] = [];
  for (const entry of entries) {
    if (entry.startsWith(`${HASH_KEY}=`)) {
      token = decodeTokenValue(entry.slice(HASH_KEY.length + 1)) || null;
    } else {
      rest.push(entry);
    }
  }
  return { token, hash: rest.length > 0 ? `#${rest.join('&')}` : '' };
}

/**
 * Moves a token from the address bar into storage. Called once, before
 * the app makes its first request.
 */
export function adoptTokenFromLocation(): void {
  const { token, hash } = takeTokenFromHash(window.location.hash);
  if (!token) return;
  setApiToken(token);
  const { pathname, search } = window.location;
  window.history.replaceState(window.history.state, '', `${pathname}${search}${hash}`);
}
