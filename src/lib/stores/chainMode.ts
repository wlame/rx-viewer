import { derived, writable } from 'svelte/store';
import { backendHas, health, type HealthState } from './health';

/**
 * Whether the viewer groups rotated logs into log chains: the URL's
 * `chains=1`, off by default. Back and Forward restore it with the rest
 * of the view, and a link that does not name it opens in the mode the
 * view was last in (`settings.chainMode`, kept by `startViewSync`).
 *
 * The choice alone turns nothing on: a chain feature acts only while the
 * backend also serves log chains (`chainModeOn`).
 */
export const chainMode = writable(false);

/**
 * Whether the files panel lists each chain's parts under its row: the
 * URL's `chain_parts=1`, a flag for checking the chain rows against the
 * files they stand for.
 */
export const chainPartsShown = writable(false);

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
