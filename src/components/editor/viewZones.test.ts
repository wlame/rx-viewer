// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { replaceViewZones, type ZoneAccessor } from './viewZones';

/** An editor that keeps the zones added and removed, as Monaco would. */
function fakeEditor() {
  const zones = new Map<string, { afterLineNumber: number; domNode: HTMLElement }>();
  let next = 0;
  const accessor: ZoneAccessor = {
    addZone: (zone) => {
      const id = `z${++next}`;
      zones.set(id, zone);
      return id;
    },
    removeZone: (id) => void zones.delete(id),
  };
  return { zones, changeViewZones: (change: (a: ZoneAccessor) => void) => change(accessor) };
}

describe('replaceViewZones', () => {
  it('adds one zone per spec after its line, each a node with its kind and text', () => {
    const editor = fakeEditor();

    replaceViewZones(
      editor,
      [],
      [
        { afterLineNumber: 0, kind: 'part', text: 'app.log.1 · 20 lines' },
        { afterLineNumber: 20, kind: 'gap', text: 'no lines from a to b' },
      ],
    );

    const nodes = [...editor.zones.values()];
    expect(
      nodes.map((z) => [z.afterLineNumber, z.domNode.className, z.domNode.textContent]),
    ).toEqual([
      [0, 'chain-zone chain-zone-part', 'app.log.1 · 20 lines'],
      [20, 'chain-zone chain-zone-gap', 'no lines from a to b'],
    ]);
  });

  it('removes the zones it added before', () => {
    const editor = fakeEditor();
    const ids = replaceViewZones(editor, [], [{ afterLineNumber: 0, kind: 'part', text: 'a' }]);

    replaceViewZones(editor, ids, [{ afterLineNumber: 5, kind: 'part', text: 'b' }]);

    expect([...editor.zones.values()].map((z) => z.domNode.textContent)).toEqual(['b']);
  });

  // A part's name comes from a file name on the server.
  it('writes a part name as text, never as markup', () => {
    const editor = fakeEditor();

    replaceViewZones(
      editor,
      [],
      [{ afterLineNumber: 0, kind: 'part', text: '<img src=x onerror=1>.log' }],
    );

    const node = [...editor.zones.values()][0].domNode;
    expect(node.textContent).toBe('<img src=x onerror=1>.log');
    expect(node.children).toHaveLength(0);
  });
});
