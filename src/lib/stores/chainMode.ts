import { derived, writable } from 'svelte/store';
import { backendHas, health, type HealthState } from './health';

/**
 * Whether the viewer groups rotated logs into log chains: the URL's
 * `chains=1`, off by default. Back and Forward restore it with the rest
 * of the view.
 *
 * The choice alone turns nothing on: a chain feature acts only while the
 * backend also serves log chains (`chainModeOn`).
 */
export const chainMode = writable(false);

/** Whether chain mode is chosen and the backend lists `log_chains`. */
export function isChainModeOn(mode: boolean, state: Pick<HealthState, 'features'>): boolean {
  return mode && backendHas('log_chains', state);
}

/**
 * Whether chain features act: chain mode is chosen and the backend
 * serves log chains. False before the first `/health` answer.
 */
export const chainModeOn = derived([chainMode, health], ([$mode, $health]) =>
  isChainModeOn($mode, $health),
);
