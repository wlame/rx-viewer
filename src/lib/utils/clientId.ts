/**
 * Client identifier utilities for tracking unique browser sessions.
 * Generates a short, stable identifier that includes browser/client info.
 */

const CLIENT_ID_KEY = 'rx-viewer-client-id';

/**
 * Generate a short random string
 */
function randomId(length: number = 6): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Get browser name from user agent
 */
function getBrowserName(): string {
  const ua = navigator.userAgent;
  if (ua.includes('Firefox')) return 'ff';
  if (ua.includes('Edg')) return 'edge';
  if (ua.includes('Chrome')) return 'chrome';
  if (ua.includes('Safari')) return 'safari';
  if (ua.includes('Opera') || ua.includes('OPR')) return 'opera';
  return 'other';
}

/**
 * Get OS name from user agent
 */
function getOSName(): string {
  const ua = navigator.userAgent;
  if (ua.includes('Win')) return 'win';
  if (ua.includes('Mac')) return 'mac';
  if (ua.includes('Linux')) return 'linux';
  if (ua.includes('Android')) return 'android';
  if (ua.includes('iOS') || ua.includes('iPhone') || ua.includes('iPad')) return 'ios';
  return 'other';
}

/**
 * Get or create a persistent client identifier.
 * Format: {browser}-{os}-{random6}
 * Example: chrome-mac-a1b2c3
 *
 * The ID is stored in localStorage to persist across sessions.
 */
export function getClientId(): string {
  if (typeof localStorage === 'undefined') {
    // Fallback for SSR
    return `ssr-${randomId(8)}`;
  }

  let clientId = localStorage.getItem(CLIENT_ID_KEY);

  if (!clientId) {
    const browser = getBrowserName();
    const os = getOSName();
    const random = randomId(6);
    clientId = `${browser}-${os}-${random}`;
    localStorage.setItem(CLIENT_ID_KEY, clientId);
  }

  return clientId;
}

/**
 * Get current tab/window session ID (unique per tab, not persisted)
 */
let tabSessionId: string | null = null;
export function getTabSessionId(): string {
  if (!tabSessionId) {
    tabSessionId = randomId(4);
  }
  return tabSessionId;
}

/**
 * Get full client identifier including tab session.
 * Format: {browser}-{os}-{random6}-{tabSession4}
 * Example: chrome-mac-a1b2c3-x9y8
 */
export function getFullClientId(): string {
  return `${getClientId()}-${getTabSessionId()}`;
}
