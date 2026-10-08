import { derived, writable } from 'svelte/store';
import { backendHas, health, type HealthState } from './health';
import { settings } from './settings';

/**
 * Whether the viewer groups rotated logs into log chains: the URL's
 * `chains=1`, off by default. Back and Forward restore it with the rest
 * of the view.
 *
 * The choice alone turns nothing on: a chain feature acts only while the
 * backend also serves log chains (`chainModeOn`).
 */
export const chainMode = writable(false);

/**
 * Turn chain mode on or off as the files panel's switch does: the URL
 * follows the mode, and the choice is remembered (`settings.chainMode`)
 * for a link that does not name the mode. A link or Back that changes
 * the mode sets `chainMode` alone and is not remembered.
 */
export function chooseChainMode(on: boolean): void {
  chainMode.set(on);
  settings.update((current) => ({ ...current, chainMode: on }));
}

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
