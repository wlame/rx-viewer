<script lang="ts">
  /**
   * `MonacoEditor` for component tests: the same props, a fake editor
   * (`fakeMonacoEditor.ts`) handed over on `ready` once the parent
   * listens, and each gutter label list the parent passes recorded on it.
   */
  import { createEventDispatcher, tick } from 'svelte';
  import type * as Monaco from 'monaco-editor';
  import type { MonacoTheme } from '$lib/types';
  import type { EditorViewZone } from '$lib/utils/chainZones';
  import { createFakeMonacoEditor, fakeMonacoEditors } from './fakeMonacoEditor';

  export let content: string = '';
  export let language: string = 'plaintext';
  export let readonly: boolean = true;
  export let theme: 'light' | 'dark' = 'light';
  export let monacoTheme: MonacoTheme = 'vs';
  export let lineNumbersStart: number = 1;
  export let wordWrap: boolean = false;
  export let showInvisibleChars: boolean = false;
  export let lineLabels: readonly string[] | null = null;
  export let viewZones: readonly EditorViewZone[] = [];

  const dispatch = createEventDispatcher<{
    ready: { editor: Monaco.editor.IStandaloneCodeEditor };
  }>();
  const fake = createFakeMonacoEditor(content.split('\n'));
  fakeMonacoEditors.push(fake);

  $: fake.passedLabels.push(lineLabels);
  // The parent listens once it has mounted this component.
  void tick().then(() => dispatch('ready', { editor: fake.editor }));

  export function revealLineAtOnce(_lineNumber: number) {}

  export function restoreScroll(_scrollTop: number, _scrollLeft: number) {}
</script>

<!-- The props MonacoEditor takes, readable in the test's document. -->
<div
  data-monaco-stub
  data-language={language}
  data-readonly={readonly}
  data-theme={theme}
  data-monaco-theme={monacoTheme}
  data-line-numbers-start={lineNumbersStart}
  data-word-wrap={wordWrap}
  data-invisible-chars={showInvisibleChars}
  data-view-zones={viewZones.length}
>
  {content}
</div>
