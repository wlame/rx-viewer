import { writable, get } from 'svelte/store';
import { api } from '../api';
import type { DetectorInfo, CategoryInfo, SeverityLevel } from '../types';

interface DetectorsState {
  detectors: DetectorInfo[];
  categories: CategoryInfo[];
  severityScale: SeverityLevel[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
}

function createDetectorsStore() {
  const { subscribe, set, update } = writable<DetectorsState>({
    detectors: [],
    categories: [],
    severityScale: [],
    loading: false,
    loaded: false,
    error: null,
  });

  /**
   * Fetch detectors metadata from the API
   */
  async function fetchDetectors() {
    const state = get({ subscribe });
    if (state.loaded || state.loading) return;

    update((s) => ({ ...s, loading: true, error: null }));

    try {
      const response = await api.getDetectors();
      set({
        detectors: response.detectors ?? [],
        categories: response.categories ?? [],
        severityScale: response.severity_scale ?? [],
        loading: false,
        loaded: true,
        error: null,
      });
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Failed to load detectors';
      update((s) => ({ ...s, loading: false, error }));
      console.error('Failed to fetch detectors:', e);
    }
  }

  return {
    subscribe,
    fetchDetectors,
  };
}

export const detectors = createDetectorsStore();
