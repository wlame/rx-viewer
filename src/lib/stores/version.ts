import { writable } from 'svelte/store';

interface VersionInfo {
  version: string;
  buildDate: string;
  commit: string;
}

interface VersionState {
  loading: boolean;
  data: VersionInfo | null;
  error: string | null;
}

function createVersionStore() {
  const { subscribe, set } = writable<VersionState>({
    loading: true,
    data: null,
    error: null,
  });

  async function fetch() {
    try {
      const response = await globalThis.fetch('/version.json');
      if (!response.ok) {
        // version.json doesn't exist in dev mode
        set({ loading: false, data: null, error: null });
        return;
      }
      const data: VersionInfo = await response.json();
      set({ loading: false, data, error: null });
    } catch {
      // Silently fail - version.json is only present in production builds
      set({ loading: false, data: null, error: null });
    }
  }

  // Auto-fetch on creation
  fetch();

  return {
    subscribe,
    fetch,
  };
}

export const version = createVersionStore();
