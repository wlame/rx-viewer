<script lang="ts">
  /**
   * The editor pane's header: the file's name and badges, the line
   * readout with its go-to box, the anomaly chips and the toolbar; for a
   * log chain, the chain's summary and its parts, and a go-to box that
   * takes a global line or `part:line`.
   *
   * What changes only the file's state in the store happens here. What
   * moves the pane's view, or the filter bar the pane owns, is reported
   * to the pane: a jump to a line the pane holds, a step to an anomaly,
   * and the filter toggle.
   */
  import { createEventDispatcher } from 'svelte';
  import type { MonacoTheme, OpenFile } from '$lib/types';
  import { files } from '$lib/stores';
  import FileBadges from '../common/FileBadges.svelte';
  import { parseChainLineTarget } from '$lib/utils/chainParts';
  import { chainRangeLabels } from '$lib/utils/chainPane';
  import ChainSummary from './ChainSummary.svelte';
  import AnomalyCategoryNav from './AnomalyCategoryNav.svelte';
  import EditorToolbar from './EditorToolbar.svelte';
  import LineRangeNav from './LineRangeNav.svelte';

  export let file: OpenFile;
  export let monacoTheme: MonacoTheme;
  /** The line readout, for the pane's go-to shortcut; unset while the file shows no lines. */
  export let lineRangeNav: LineRangeNav | undefined = undefined;

  $: chainDescription = file.chain?.description ?? null;
  $: readChainTarget = chainDescription
    ? (text: string) => parseChainLineTarget(text, chainDescription)
    : null;
  $: rangeLabels = file.chain ? chainRangeLabels(file.lines, file.chain.numbering) : null;

  const dispatch = createEventDispatcher<{
    jump: { line: number };
    navigateAnomaly: { category: string; direction: 'next' | 'previous' };
    toggleFilter: void;
  }>();
</script>

<div
  class="bg-gh-canvas-subtle dark:bg-gh-canvas-dark-subtle
         border-b border-gh-border-default dark:border-gh-border-dark-default"
>
  <div class="flex items-center justify-between px-3 py-2 gap-3">
    <div class="flex items-center gap-3 min-w-0">
      <span
        class="text-base font-medium truncate shrink-0 max-w-[16rem]"
        title={file.chain?.handle ?? file.path}
      >
        {file.name}
      </span>
      <FileBadges
        isCompressed={file.isCompressed}
        compressionFormat={file.compressionFormat}
        isIndexed={file.isIndexed}
      />
      {#if file.lines.length > 0}
        <LineRangeNav
          bind:this={lineRangeNav}
          startLine={file.startLine}
          endLine={file.endLine}
          totalLines={file.totalLines}
          labels={rangeLabels}
          {readChainTarget}
          on:jump={(e) => dispatch('jump', { line: e.detail.line })}
          on:goto={(e) => files.jumpToLine(file.path, e.detail.line)}
          on:gotoChain={(e) => files.goToChainLine(file.path, e.detail)}
          on:jumpToEnd={() => files.jumpToEnd(file.path)}
        />
      {/if}
    </div>

    <div class="flex items-center gap-2">
      <AnomalyCategoryNav
        summary={file.anomalySummary}
        selectedCategory={file.selectedAnomalyCategory}
        on:toggle={(e) => files.toggleAnomalyCategory(file.path, e.detail.category)}
        on:navigate={(e) => dispatch('navigateAnomaly', e.detail)}
      />

      <EditorToolbar
        syntaxHighlighting={file.syntaxHighlighting}
        wordWrap={file.wordWrap}
        showInvisibleChars={file.showInvisibleChars}
        filterEnabled={Boolean(file.regexFilter?.enabled)}
        {monacoTheme}
        on:toggleSyntax={() => files.toggleSyntaxHighlighting(file.path)}
        on:toggleWordWrap={() => files.toggleWordWrap(file.path)}
        on:toggleInvisible={() => files.toggleInvisibleChars(file.path)}
        on:toggleFilter={() => dispatch('toggleFilter')}
        on:close={() => files.closeFile(file.path)}
      />
    </div>
  </div>
  {#if file.chain}
    <!-- A chain's own row: its state, lines, times, index task and parts. -->
    <div class="px-3 pb-1.5 -mt-1">
      <ChainSummary chain={file.chain} on:goto={(e) => files.goToChainLine(file.path, e.detail)} />
    </div>
  {/if}
</div>
