import { writable, derived, get } from 'svelte/store';
import { api } from '../api';
import type { DetectorInfo, CategoryInfo, SeverityLevel } from '../types';
import { categoryStyle } from '../utils/categoryStyle';

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
        detectors: response.detectors,
        categories: response.categories,
        severityScale: response.severity_scale,
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

  /**
   * Get category info by name
   */
  function getCategoryInfo(categoryName: string): CategoryInfo | undefined {
    const state = get({ subscribe });
    return state.categories.find((c) => c.name === categoryName);
  }

  /**
   * Get detector info by name
   */
  function getDetectorInfo(detectorName: string): DetectorInfo | undefined {
    const state = get({ subscribe });
    return state.detectors.find((d) => d.name === detectorName);
  }

  /**
   * Get icon/color/label for a category
   */
  function getCategoryIcon(categoryName: string): { icon: string; color: string; label: string } {
    const style = categoryStyle(categoryName);
    return { icon: style.symbol, color: style.color, label: style.label };
  }

  return {
    subscribe,
    fetchDetectors,
    getCategoryInfo,
    getDetectorInfo,
    getCategoryIcon,
  };
}

export const detectors = createDetectorsStore();

// Derived store for category names
export const categoryNames = derived(detectors, ($detectors) =>
  $detectors.categories.map((c) => c.name),
);
