<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { get } from 'svelte/store';
  import type { OpenFile, RegexFilter } from '$lib/types';
  import { detectors, files, settings, resolvedTheme } from '$lib/stores';
  import { recallPane, rememberPane, scrollOnShow } from '$lib/stores/paneMemory';
  import Spinner from '../common/Spinner.svelte';
  import MonacoEditor from './MonacoEditor.svelte';
  import RegexFilterPanel from './RegexFilterPanel.svelte';
  import EditorHeader from './EditorHeader.svelte';
  import LineRangeNav from './LineRangeNav.svelte';
  import { detectMonacoLanguage } from '$lib/utils/monacoLanguage';
  import { debounce } from '$lib/utils/urlState';
  import { anchorAfterScroll, type VisibleLines } from '$lib/utils/anchorLine';
  import { pagingDirection, watchUserInput } from '$lib/utils/paging';
  import { processContent } from '$lib/utils/processContent';
  import { paneDecorations, toMonacoLine, type PaneView } from '$lib/utils/editorDecorations';
  import { pickAnomalyTarget } from '$lib/utils/anomalyCategories';
  import { acceptsTyping } from '$lib/utils/keyTargets';
  import { isShortcut } from '$lib/utils/shortcuts';
  import { categoryStyle, installPaletteStyles } from '$lib/utils/categoryStyle';
  import './editorDecorations.css';
  import type * as Monaco from 'monaco-editor';

  export let file: OpenFile;
  export let hideHeader: boolean = false;
  export let isActive: boolean = false;

  let paneEl: HTMLDivElement;
  let monacoComponent: MonacoEditor;
  let monacoEditor: Monaco.editor.IStandaloneCodeEditor | null = null;
  let decorationsCollection: Monaco.editor.IEditorDecorationsCollection | null = null;

  // Hidden-content map for hover tooltips, keyed "lineNum:markerIndex".
  // Assigned together with `content` by processContent below.
  let hiddenContentMap: Map<string, string>;

  // The header's line readout, whose go-to box the `:` shortcut opens.
  let lineRangeNav: LineRangeNav | undefined;

  // The pane is built for one tab (MainContent keys it by path); what the
  // tab had when it was last shown comes back from paneMemory.
  const rememberedPane = recallPane(file.path);

  // Regex filter bar state
  let filterPanelVisible = rememberedPane.filterPanelVisible;
  let filterPattern = rememberedPane.filterDraft.pattern;
  let filterMode: 'hide' | 'show' | 'highlight' = rememberedPane.filterDraft.mode;

  // Whether the user moved the view since the last navigation. Only a
  // scroll the user made may move the anchor or load a page: the editor
  // moves the view itself to reveal a target, to keep the screen still
  // while lines arrive and to restore a tab, and those positions are not
  // where the user went. The rule for paging is in utils/paging.ts.
  let hasUserScrolled = false;
  let stopWatchingUserInput: (() => void) | null = null;

  function noteUserScroll() {
    hasUserScrolled = true;
  }

  $: monacoTheme = $settings.monacoTheme;

  // File matches from trace search
  $: fileMatches = $files.matches.get(file.path) || [];

  // Detect language for Monaco
  $: monacoLanguage = detectMonacoLanguage(file.name);

  // Theme - use resolved theme from settings store (reacts to dark/light mode changes)
  $: theme = $resolvedTheme;

  // The text Monaco renders, plus what the hide/show filter replaced.
  // file.lines is referenced directly so Svelte tracks it.
  $: ({ content, hiddenContent: hiddenContentMap } = processContent(
    file.lines,
    file.regexFilter,
    file.showInvisibleChars,
  ));

  // The selected category's color is its place in the detector list,
  // which can arrive after the anomalies.
  $: selectedCategoryStyle = file.selectedAnomalyCategory
    ? categoryStyle(file.selectedAnomalyCategory, $detectors.categories)
    : null;

  // Everything the decorations mark; any change to it repaints them.
  $: paneView = {
    editorWindow: { startLine: file.startLine, lineCount: file.lines.length },
    matchedFileLines: fileMatches.map((match) => match.lineNumber),
    highlightedRange: file.highlightedLines,
    anomalies: file.anomalies,
    selectedCategory:
      file.selectedAnomalyCategory && selectedCategoryStyle
        ? { name: file.selectedAnomalyCategory, style: selectedCategoryStyle }
        : null,
    filter: file.regexFilter,
    text: monacoEditor?.getModel() ?? null,
    hiddenContent: hiddenContentMap,
  } satisfies PaneView;
  $: if (monacoEditor) updateDecorations(paneView);

  function updateDecorations(view: PaneView) {
    if (!monacoEditor) return;
    decorationsCollection?.clear();
    const decorations = paneDecorations(view);
    if (decorations.length > 0) {
      decorationsCollection = monacoEditor.createDecorationsCollection(decorations);
    }
  }

  // A filter applied from outside the bar (a link, Back) opens the bar
  // showing it. Only a new filter object counts: the file changes on
  // every load, and a pattern the user is typing must survive that.
  let shownFilter: RegexFilter | null = rememberedPane.shownFilter;
  $: showAppliedFilter(file.regexFilter);

  function showAppliedFilter(filter: RegexFilter | null) {
    if (filter === shownFilter) return;
    shownFilter = filter;
    if (!filter?.enabled || !filter.pattern) return;
    filterPattern = filter.pattern;
    filterMode = filter.mode;
    filterPanelVisible = true;
  }

  function toggleFilterPanel() {
    filterPanelVisible = !filterPanelVisible;
    if (filterPanelVisible && !file.regexFilter) {
      files.toggleRegexFilter(file.path);
    }
  }

  // Step to the next or previous anomaly of a category, relative to the
  // line at the center of the view, loading the window around it when
  // the editor does not hold that line yet.
  function navigateToAnomaly(category: string, direction: 'next' | 'previous') {
    const target = pickAnomalyTarget(
      file.anomalies,
      category,
      getCurrentViewportCenterLine(),
      direction,
    );
    if (!target) return;

    const monacoLine = toMonacoLine(target.start_line, {
      startLine: file.startLine,
      lineCount: file.lines.length,
    });
    if (monacoLine !== null && monacoEditor) {
      monacoEditor.revealLineInCenter(monacoLine);
    } else {
      files.jumpToLine(file.path, target.start_line);
    }
  }

  function applyFilter(e: CustomEvent<{ pattern: string; mode: typeof filterMode }>) {
    files.updateRegexFilter(file.path, e.detail.pattern, e.detail.mode);
  }

  function clearFilter() {
    files.clearRegexFilter(file.path);
    filterPattern = '';
    filterMode = 'highlight';
    filterPanelVisible = false;
  }

  // A navigation's target is revealed once its lines are loaded. Until
  // then `scrollToLine` stays set, and no scroll pages.
  $: if (
    file.scrollToLine !== undefined &&
    monacoComponent &&
    file.lines.length > 0 &&
    !file.loading
  ) {
    revealPendingTarget(file.scrollToLine);
  }

  /**
   * Reveal the target of a navigation and mark it done. The editor gets
   * the new lines later in this same update, so the reveal waits for
   * the update to finish (`tick`), not for a time.
   */
  async function revealPendingTarget(targetLine: number) {
    hasUserScrolled = false;
    await tick();
    revealFileLine(targetLine);
    files.clearScrollPosition(file.path);
  }

  /** The file lines on screen, or null when the editor shows none. */
  function visibleFileLines(): VisibleLines | null {
    if (!monacoEditor || file.lines.length === 0) return null;

    const visibleRanges = monacoEditor.getVisibleRanges();
    if (visibleRanges.length === 0) return null;

    // Monaco counts from 1 at the first loaded line.
    return {
      first: file.startLine + visibleRanges[0].startLineNumber - 1,
      last: file.startLine + visibleRanges[visibleRanges.length - 1].endLineNumber - 1,
    };
  }

  function getCurrentViewportCenterLine(): number {
    const visible = visibleFileLines();
    return visible ? Math.floor((visible.first + visible.last) / 2) : file.startLine;
  }

  /**
   * Show a held file line in the center of the view. At once, not with a
   * smooth scroll: a page that arrives during the animation would stop
   * the view halfway, where the user did not go.
   */
  function revealFileLine(targetLine: number) {
    const isHeld = targetLine >= file.startLine && targetLine <= file.endLine;
    if (isHeld) monacoComponent?.revealLineAtOnce(targetLine);
  }

  function jumpToLineNumber(lineNum: number) {
    if (lineNum < file.startLine || lineNum > file.endLine) {
      files.jumpToLine(file.path, lineNum);
      return;
    }

    hasUserScrolled = false;
    files.setAnchorLine(file.path, lineNum);
    revealFileLine(lineNum);

    // A jump to the first or last held line loads the page beyond it;
    // the editor keeps the line in place while the page arrives.
    if (lineNum === file.startLine && !file.reachedStart) {
      files.loadMore(file.path, 'before');
    } else if (lineNum === file.endLine && !file.reachedEnd) {
      files.loadMore(file.path, 'after');
    }
  }

  // Once a scroll the user made settles, the anchor follows the rule in
  // anchorLine.ts: it stays on the line the user went to while that line
  // is on screen. A scroll the editor makes itself, to reveal a target or
  // while lines load, leaves the anchor alone.
  const updateAnchorOnScroll = debounce(() => {
    if (!isActive || !hasUserScrolled || file.scrollToLine !== undefined || file.loading) {
      return;
    }
    const visible = visibleFileLines();
    if (!visible) return;
    const anchor = anchorAfterScroll(file.anchorLine, visible);
    if (anchor !== file.anchorLine) files.setAnchorLine(file.path, anchor);
  }, 500);

  function handleMonacoScroll(
    e: CustomEvent<{ scrollTop: number; scrollHeight: number; clientHeight: number }>,
  ) {
    const { scrollTop, scrollHeight, clientHeight } = e.detail;

    updateAnchorOnScroll();

    const direction = pagingDirection({
      isNavigationPending: file.scrollToLine !== undefined,
      isLoading: file.loading,
      hasUserScrolled,
      reachedStart: file.reachedStart,
      reachedEnd: file.reachedEnd,
      scrollTop,
      distanceFromBottom: scrollHeight - scrollTop - clientHeight,
    });
    if (direction) files.loadMore(file.path, direction);
  }

  /** Put a tab shown again where it was, or on its anchor line; see scrollOnShow. */
  function restoreTabView() {
    const placement = scrollOnShow(file, rememberedPane);
    if (placement.kind === 'restore') {
      monacoComponent?.restoreScroll(placement.scrollTop, placement.scrollLeft);
    } else if (placement.kind === 'reveal') {
      monacoComponent?.revealLineAtOnce(placement.line);
    }
  }

  /** Keep this tab's bar and view for when it is shown again, unless the file was closed. */
  function rememberTab() {
    const isStillOpen = get(files).openFiles.some((f) => f.path === file.path);
    if (!isStillOpen) return;
    rememberPane(file.path, {
      filterPanelVisible,
      filterDraft: { pattern: filterPattern, mode: filterMode },
      shownFilter,
      scroll: monacoEditor
        ? {
            startLine: file.startLine,
            scrollTop: monacoEditor.getScrollTop(),
            scrollLeft: monacoEditor.getScrollLeft(),
          }
        : null,
    });
  }

  function handleMonacoReady(e: CustomEvent<{ editor: Monaco.editor.IStandaloneCodeEditor }>) {
    monacoEditor = e.detail.editor;
    restoreTabView();

    // Listen for content changes to apply decorations after content is set
    const model = monacoEditor.getModel();
    if (model) {
      model.onDidChangeContent(() => {
        // Delay slightly to ensure content is fully rendered
        setTimeout(() => {
          updateDecorations(paneView);
        }, 50);
      });
    }

    // Initial decoration update (with delay to ensure content is ready)
    setTimeout(() => {
      updateDecorations(paneView);
    }, 100);
  }

  // `:` or Cmd/Ctrl+G opens the go-to box, also while the read-only
  // editor text has focus. The pane hears keys in the capture phase and
  // stops the ones it acts on, so Monaco's own Cmd/Ctrl+G, which would
  // count the loaded lines instead of the file's, never sees them. The
  // go-to box closes itself on Escape and when it loses focus.
  function handleKeyDown(e: KeyboardEvent) {
    if (!lineRangeNav || !isShortcut('gotoLine', e) || acceptsTyping(e.target as HTMLElement)) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    lineRangeNav.openGoto();
  }

  onMount(() => {
    installPaletteStyles();
    paneEl?.addEventListener('keydown', handleKeyDown, true);
    if (paneEl) stopWatchingUserInput = watchUserInput(paneEl, noteUserScroll);
  });

  onDestroy(() => {
    // The editor is still there: a component's own onDestroy runs before
    // its children are destroyed.
    rememberTab();
    paneEl?.removeEventListener('keydown', handleKeyDown, true);
    stopWatchingUserInput?.();
    if (decorationsCollection) {
      decorationsCollection.clear();
    }
  });
</script>

<div
  bind:this={paneEl}
  tabindex="-1"
  class="h-full w-full flex flex-col outline-none
         border-r border-gh-border-default dark:border-gh-border-dark-default
         last:border-r-0"
>
  {#if !hideHeader}
    <EditorHeader
      {file}
      {monacoTheme}
      bind:lineRangeNav
      on:jump={(e) => jumpToLineNumber(e.detail.line)}
      on:navigateAnomaly={(e) => navigateToAnomaly(e.detail.category, e.detail.direction)}
      on:toggleFilter={toggleFilterPanel}
    />
  {/if}

  <!-- Regex filter panel (expandable) -->
  {#if filterPanelVisible}
    <RegexFilterPanel
      bind:pattern={filterPattern}
      bind:mode={filterMode}
      error={file.regexFilter?.error ?? null}
      on:apply={applyFilter}
      on:cancel={clearFilter}
      on:close={() => (filterPanelVisible = false)}
    />
  {/if}

  <!-- Content container with Monaco Editor -->
  <div class="flex-1 min-h-0 relative">
    {#if file.loading && file.lines.length === 0}
      <div class="flex items-center justify-center h-full">
        <Spinner size="lg" />
      </div>
    {:else if file.error}
      <div
        class="flex items-center justify-center h-full text-gh-danger-fg dark:text-gh-danger-dark-fg"
      >
        <div class="text-center p-4">
          <p class="font-medium">Failed to load file</p>
          <p class="text-sm mt-1 opacity-75">{file.error}</p>
        </div>
      </div>
    {:else if file.lines.length === 0}
      <div
        class="flex items-center justify-center h-full text-gh-fg-muted dark:text-gh-fg-dark-muted"
      >
        <p>Empty file</p>
      </div>
    {:else}
      <!-- Loading indicator overlay -->
      {#if file.loading}
        <div
          class="absolute top-2 left-1/2 -translate-x-1/2 z-10 bg-gh-canvas-subtle dark:bg-gh-canvas-dark-subtle rounded-full px-3 py-1 shadow-md flex items-center gap-2"
        >
          <Spinner size="sm" />
          <span class="text-xs text-gh-fg-muted dark:text-gh-fg-dark-muted">Loading...</span>
        </div>
      {/if}

      <MonacoEditor
        bind:this={monacoComponent}
        {content}
        language={file.syntaxHighlighting ? monacoLanguage : 'plaintext'}
        readonly={true}
        {theme}
        {monacoTheme}
        lineNumbersStart={file.startLine}
        wordWrap={file.wordWrap}
        showInvisibleChars={file.showInvisibleChars}
        on:scroll={handleMonacoScroll}
        on:ready={handleMonacoReady}
      />
    {/if}
  </div>
</div>
