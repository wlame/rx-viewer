import { writable } from 'svelte/store';
import { api } from '../api';
import type { HealthResponse } from '../types';
import { checkContractVersion, type ContractCompatibility } from '../utils/contractVersion';
import { getFullClientId } from '../utils/clientId';

interface HealthState {
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
}

function createHealthStore() {
  const { subscribe, set, update } = writable<HealthState>({
    connected: false,
    loading: true,
    error: null,
    data: null,
    contract: { kind: 'unknown' },
  });

  let checkInterval: ReturnType<typeof setInterval> | null = null;
  let pollingIntervalMs: number = 300000;
  let isPollingActive: boolean = false;

  // Get client ID once (stable across checks)
  const clientId = typeof window !== 'undefined' ? getFullClientId() : undefined;

  async function check() {
    // Don't check if tab is not visible
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      return;
    }

    update((s) => ({ ...s, loading: true }));
    try {
      const data = await api.getHealth(clientId);
      set({
        connected: true,
        loading: false,
        error: null,
        data,
        contract: checkContractVersion(data.contract_version),
      });
    } catch (e) {
      set({
        connected: false,
        loading: false,
        error: e instanceof Error ? e.message : 'Connection failed',
        data: null,
        // Nothing was read, so nothing is known about the contract.
        contract: { kind: 'unknown' },
      });
    }
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
    checkInterval = setInterval(check, pollingIntervalMs);
  }

  function startPolling(intervalMs: number = 300000) {
    stopPolling();
    pollingIntervalMs = intervalMs;
    isPollingActive = true;

    // Add visibility change listener
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    // Only start if tab is visible
    if (typeof document === 'undefined' || document.visibilityState === 'visible') {
      check();
      checkInterval = setInterval(check, intervalMs);
    }
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
