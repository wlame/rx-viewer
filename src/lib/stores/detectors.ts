import { writable, derived, get } from 'svelte/store';
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

// Category icons/symbols - unique visual identifiers for each category
export const CATEGORY_ICONS: Record<string, { icon: string; color: string; label: string }> = {
  error: { icon: '!', color: '#ef4444', label: 'Errors' },           // red-500
  warning: { icon: '!', color: '#f59e0b', label: 'Warnings' },      // amber-500
  traceback: { icon: '!', color: '#dc2626', label: 'Tracebacks' }, // red-600
  format: { icon: '!', color: '#8b5cf6', label: 'Format' },         // violet-500
  security: { icon: '!', color: '#ec4899', label: 'Security' },     // pink-500
  timing: { icon: '!', color: '#06b6d4', label: 'Timing' },         // cyan-500
  multiline: { icon: '!', color: '#6366f1', label: 'Multiline' },   // indigo-500
};

// Default fallback for unknown categories
const DEFAULT_CATEGORY_ICON = { icon: '?', color: '#6b7280', label: 'Other' }; // gray-500

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
    return CATEGORY_ICONS[categoryName] || { ...DEFAULT_CATEGORY_ICON, label: categoryName };
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
  $detectors.categories.map((c) => c.name)
);
