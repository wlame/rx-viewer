/**
 * Gives jsdom the `window.matchMedia` it lacks. The settings store asks
 * it for the system theme when it is imported, so a component test that
 * reaches `$lib/stores` imports this module first. Every query reports
 * no match: the light theme.
 */
window.matchMedia = (query: string) =>
  ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }) as unknown as MediaQueryList;
