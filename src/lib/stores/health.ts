import { derived, get, writable } from 'svelte/store';
import { api } from '../api';
import { contractGate } from '../contractGate';
import type { HealthResponse } from '../types';
import { checkContractVersion, type ContractCompatibility } from '../utils/contractVersion';

/**
 * How often `/health` is asked while the backend's contract is refused.
 * The viewer is blocked until it changes, so the normal interval would
 * leave the message up for minutes after the backend is replaced.
 */
export const BLOCKED_RECHECK_MS = 10_000;

export interface HealthState {
  connected: boolean;
  loading: boolean;
  error: string | null;
  data: HealthResponse | null;
  /**
   * Whether this viewer can read what the backend sends. A backend on a
   * different contract major would be misread, so the UI says so instead
   * of showing wrong data.
   */
  contract: ContractCompatibility;
  /**
   * The features the backend listed on `/health`; empty before the first
   * answer, after a failed one and for a backend that lists none.
   */
  features: readonly string[];
}

/**
 * The names of the features the viewer asks a backend about. The backend
 * lists every feature its build serves on `/health`; a name it does not
 * list is a feature it lacks.
 */
export type BackendFeature =
  | 'trace_matching_flags'
  | 'trace_context_and_switches'
  | 'samples_index_build'
  | 'samples_timestamps'
  | 'line_timestamps'
  | 'time_range';

/** The feature list of a `/health` answer; anything but a list of names is none. */
function featuresOf(data: HealthResponse): readonly string[] {
  const listed: unknown = data.features;
  if (!Array.isArray(listed)) return [];
  return listed.filter((name): name is string => typeof name === 'string');
}

function createHealthStore() {
  const { subscribe, set, update } = writable<HealthState>({
    connected: false,
    loading: true,
    error: null,
    data: null,
    contract: { kind: 'unknown' },
    features: [],
  });

  let checkInterval: ReturnType<typeof setInterval> | null = null;
  let pollingIntervalMs: number = 300000;
  let isPollingActive: boolean = false;
  // The interval the running timer was started with.
  let activeIntervalMs: number = pollingIntervalMs;
  let lastContract: ContractCompatibility = { kind: 'unknown' };

  /** A refused backend is asked again soon; any other on the normal interval. */
  function intervalFor(contract: ContractCompatibility): number {
    return contract.kind === 'incompatible' ? BLOCKED_RECHECK_MS : pollingIntervalMs;
  }

  /** Whether the page is in a hidden tab, where polling pauses. */
  function isTabHidden(): boolean {
    return typeof document !== 'undefined' && document.visibilityState === 'hidden';
  }

  /** Ask `/health` now, unless the tab is hidden. */
  async function check() {
    if (isTabHidden()) return;
    await askHealth();
  }

  /** Ask `/health` and record what it says about the backend. */
  async function askHealth() {
    update((s) => ({ ...s, loading: true }));
    let contract: ContractCompatibility;
    try {
      const data = await api.getHealth();
      contract = checkContractVersion(data.contract_version);
      set({
        connected: true,
        loading: false,
        error: null,
        data,
        contract,
        features: featuresOf(data),
      });
    } catch (e) {
      // Nothing was read, so nothing is known about the contract.
      contract = { kind: 'unknown' };
      set({
        connected: false,
        loading: false,
        error: e instanceof Error ? e.message : 'Connection failed',
        data: null,
        contract,
        features: [],
      });
    }
    lastContract = contract;
    contractGate.decide(contract);
    if (checkInterval && activeIntervalMs !== intervalFor(contract)) restartInterval();
  }

  function handleVisibilityChange() {
    if (document.visibilityState === 'visible') {
      // Tab became visible - do an immediate check and restart polling
      if (isPollingActive) {
        check();
        restartInterval();
      }
    } else {
      // Tab became hidden - stop the interval (but keep isPollingActive true)
      if (checkInterval) {
        clearInterval(checkInterval);
        checkInterval = null;
      }
    }
  }

  function restartInterval() {
    if (checkInterval) {
      clearInterval(checkInterval);
    }
    activeIntervalMs = intervalFor(lastContract);
    checkInterval = setInterval(check, activeIntervalMs);
  }

  function startPolling(intervalMs: number = 300000) {
    stopPolling();
    pollingIntervalMs = intervalMs;
    isPollingActive = true;
    // The app's first /v1 requests wait for the first answer.
    contractGate.hold();

    // Add visibility change listener
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    // The first answer is asked even in a hidden tab: the requests the
    // app starts with wait for it. Only the periodic checks pause.
    if (!isTabHidden()) restartInterval();
    askHealth();
  }

  function stopPolling() {
    isPollingActive = false;
    if (checkInterval) {
      clearInterval(checkInterval);
      checkInterval = null;
    }
    // Remove visibility change listener
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    }
  }

  return {
    subscribe,
    check,
    startPolling,
    stopPolling,
  };
}

export const health = createHealthStore();

/**
 * Whether the backend serves `name`: whether its last `/health` answer
 * listed it. Before an answer, after a failed one and for a backend that
 * lists no features, every feature reads as absent. A component passes
 * `$health` so that it reacts when the answer arrives.
 */
export function backendHas(
  name: BackendFeature,
  state: Pick<HealthState, 'features'> = get(health),
): boolean {
  return state.features.includes(name);
}

/**
 * True while the backend speaks a contract major this viewer cannot read.
 * A cover then blocks the app, and no window-wide shortcut acts under it.
 */
export const contractRefused = derived(
  health,
  ($health) => $health.contract.kind === 'incompatible',
);
