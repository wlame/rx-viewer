/**
 * The view zones of a log chain's tab, handed to Monaco: a line of text
 * between two editor lines that is not a line itself, so it changes no
 * line number, no search mark and no jump target. What the zones say is
 * worked out in `$lib/utils/chainZones.ts`.
 */
import type { EditorViewZone } from '$lib/utils/chainZones';

/** What Monaco's `changeViewZones` hands its callback, the parts used here. */
export interface ZoneAccessor {
  addZone(zone: { afterLineNumber: number; heightInLines: number; domNode: HTMLElement }): string;
  removeZone(id: string): void;
}

/** The part of a Monaco editor that changes view zones; a test fakes it. */
export interface ZoneEditor {
  changeViewZones(change: (accessor: ZoneAccessor) => void): void;
}

/**
 * The node of one zone. Its text goes in as text: a part's name is a
 * file name from the server, never markup.
 */
function zoneNode(zone: EditorViewZone): HTMLElement {
  const node = document.createElement('div');
  node.className = `chain-zone chain-zone-${zone.kind}`;
  node.textContent = zone.text;
  return node;
}

/**
 * Replace the zones `ids` of `editor` with `zones`, each one editor line
 * high, and return the ids of the zones added.
 */
export function replaceViewZones(
  editor: ZoneEditor,
  ids: readonly string[],
  zones: readonly EditorViewZone[],
): string[] {
  let added: string[] = [];
  editor.changeViewZones((accessor) => {
    for (const id of ids) accessor.removeZone(id);
    added = zones.map((zone) =>
      accessor.addZone({
        afterLineNumber: zone.afterLineNumber,
        heightInLines: 1,
        domNode: zoneNode(zone),
      }),
    );
  });
  return added;
}
