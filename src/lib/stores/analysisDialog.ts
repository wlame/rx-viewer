import { writable, type Readable } from 'svelte/store';

/** The file an analysis dialog analyses. */
export interface AnalysisTarget {
  /** The file's path. */
  path: string;
  /** Its name, for the dialog's title. */
  name: string;
}

const target = writable<AnalysisTarget | null>(null);

/**
 * The file of the open analysis dialog, or null while none is open. The
 * app draws the dialog over every panel (`AnalyzeDialogHost.svelte`), so
 * no panel switch, Back or Forward hides a dialog that counts as open.
 */
export const analysisTarget: Readable<AnalysisTarget | null> = { subscribe: target.subscribe };

/** Open the analysis dialog on `file`; a dialog open on another request gives way to it. */
export function openAnalysis(file: AnalysisTarget): void {
  target.set({ path: file.path, name: file.name });
}

/** Close the analysis dialog. */
export function closeAnalysis(): void {
  target.set(null);
}
