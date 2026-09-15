<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import type { OpenFile, RegexFilter } from '$lib/types';
  import { files, settings, resolvedTheme } from '$lib/stores';
  import { recallPane, rememberPane, scrollOnShow } from '$lib/stores/paneMemory';
  import Spinner from '../common/Spinner.svelte';
  import FileBadges from '../common/FileBadges.svelte';
  import MonacoEditor from './MonacoEditor.svelte';
  import RegexFilterPanel from './RegexFilterPanel.svelte';
  import EditorToolbar from './EditorToolbar.svelte';
  import AnomalyCategoryNav from './AnomalyCategoryNav.svelte';
  import LineRangeNav from './LineRangeNav.svelte';
  import { detectMonacoLanguage } from '$lib/utils/monacoLanguage';
  import { debounce } from '$lib/utils/urlState';
  import { anchorAfterScroll, type VisibleLines } from '$lib/utils/anchorLine';
  import { processContent } from '$lib/utils/processContent';
  import {
    anomalyCategoryDecorations,
    hiddenMarkerDecorations,
    highlightedRangeDecorations,
    matchLineDecorations,
    regexHighlightDecorations,
    toMonacoLine,
  } from '$lib/utils/editorDecorations';
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
  let hiddenContentMap: Map<string, string> = new Map();

  // The header's line readout, whose go-to box the `:` shortcut opens.
  let lineRangeNav: LineRangeNav | undefined;

  // The pane is built for one tab (MainContent keys it by path); what the
  // tab had when it was last shown comes back from paneMemory.
  const rememberedPane = recallPane(file.path);

  // Regex filter bar state
  let filterPanelVisible = rememberedPane.filterPanelVisible;
  let filterPattern = rememberedPane.filterDraft.pattern;
  let filterMode: 'hide' | 'show' | 'highlight' = rememberedPane.filterDraft.mode;

  // Track scroll state for content loading
  let isScrollingToTarget = false;

  // Whether the user moved the view since the last navigation. Only a
  // scroll the user made may move the anchor: the editor's own scroll to
  // a target can take longer than any timer (a throttled background tab
  // runs few animation frames), and its halfway positions are not where
  // the user went.
  let hasUserScrolled = false;
  const USER_SCROLL_EVENTS = ['wheel', 'touchmove', 'mousedown', 'keydown'] as const;

  function noteUserScroll() {
    hasUserScrolled = true;
  }
  let lastContentLoadTime = 0; // Timestamp of last content load to prevent immediate loadMore

  // Settings
  $: fontSize = $settings.editorFontSize;
  $: showLineNumbers = $settings.showLineNumbers;
  $: showMinimap = $settings.showMinimap;
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

  // Apply decorations when matches change or content changes
  $: if (monacoEditor && file.lines.length > 0) {
    updateDecorations();
  }

  // Also update decorations when regex filter changes
  $: if (monacoEditor && file.regexFilter) {
    updateDecorations();
  }

  // Update decorations when highlighted lines change
  $: if (monacoEditor && file.highlightedLines !== undefined) {
    updateDecorations();
  }

  // Update decorations when selected anomaly category changes
  $: if (monacoEditor && file.selectedAnomalyCategory !== undefined) {
    updateDecorations();
  }

  // Update decorations when anomalies data is loaded
  $: if (monacoEditor && file.anomalies) {
    updateDecorations();
  }

  function updateDecorations() {
    if (!monacoEditor) return;
    decorationsCollection?.clear();

    const editorWindow = { startLine: file.startLine, lineCount: file.lines.length };
    const model = monacoEditor.getModel();
    const filter = file.regexFilter;
    const filterActive = Boolean(filter?.enabled && filter.compiledRegex);
    const category = file.selectedAnomalyCategory;

    const decorations = [
      ...matchLineDecorations(
        fileMatches.map((match) => match.lineNumber),
        editorWindow,
      ),
      ...highlightedRangeDecorations(file.highlightedLines, editorWindow),
      ...(category && file.anomalies
        ? anomalyCategoryDecorations(
            file.anomalies,
            category,
            categoryStyle(category),
            editorWindow,
          )
        : []),
      ...(model && filter && filterActive && filter.mode === 'highlight'
        ? regexHighlightDecorations(filter.pattern, model)
        : []),
      ...(model && filter && filterActive && filter.mode !== 'highlight'
        ? hiddenMarkerDecorations(filter.mode, model, hiddenContentMap)
        : []),
    ];
    if (decorations.length > 0) {
      decorationsCollection = monacoEditor.createDecorationsCollection(decorations);
    }
  }

  function toggleSyntaxHighlighting() {
    files.toggleSyntaxHighlighting(file.path);
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

  function toggleInvisibleChars() {
    files.toggleInvisibleChars(file.path);
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

  // Track when content is loaded to prevent immediate loadMore calls
  $: if (file.lines.length > 0 && !file.loading) {
    lastContentLoadTime = Date.now();
  }

  // Scroll to target line when requested
  // Use a longer delay to ensure Monaco has fully rendered the content
  $: if (
    file.scrollToLine !== undefined &&
    monacoComponent &&
    file.lines.length > 0 &&
    !file.loading
  ) {
    isScrollingToTarget = true;
    hasUserScrolled = false;
    // Delay scroll to ensure content is rendered in Monaco
    setTimeout(() => {
      scrollToLine(file.scrollToLine!);
    }, 100);
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

  function scrollToLine(targetLine: number) {
    if (!monacoComponent) return;

    // Convert file line number to Monaco line number
    const monacoLine = targetLine - file.startLine + 1;

    if (monacoLine >= 1 && monacoLine <= file.lines.length) {
      monacoComponent.revealLine(targetLine);
      // Keep isScrollingToTarget true for longer to prevent scroll handlers from triggering loadMore
      setTimeout(() => {
        files.clearScrollPosition(file.path);
        // Delay clearing isScrollingToTarget to prevent immediate loadMore calls
        setTimeout(() => {
          isScrollingToTarget = false;
        }, 200);
      }, 300);
    } else {
      isScrollingToTarget = false;
    }
  }

  function jumpToLineNumber(lineNum: number) {
    if (lineNum >= file.startLine && lineNum <= file.endLine) {
      isScrollingToTarget = true;
      hasUserScrolled = false;
      files.setAnchorLine(file.path, lineNum);
      scrollToLine(lineNum);

      // If jumping to boundary lines, trigger loading more content after scroll completes
      if (lineNum === file.startLine && file.startLine > 1 && !file.reachedStart) {
        setTimeout(() => {
          files.loadMore(file.path, 'before');
        }, 400);
      } else if (lineNum === file.endLine && !file.reachedEnd) {
        setTimeout(() => {
          files.loadMore(file.path, 'after');
        }, 400);
      }
    } else {
      files.jumpToLine(file.path, lineNum);
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

    // Don't trigger loadMore during programmatic scrolling or right after content load
    if (file.scrollToLine !== undefined || isScrollingToTarget) {
      return;
    }

    // Skip loadMore for 1 second after content was loaded (prevents extra calls after jumpToLine)
    const timeSinceLoad = Date.now() - lastContentLoadTime;
    if (timeSinceLoad < 1000) {
      return;
    }

    if (file.loading) {
      return;
    }

    // Load more when near top
    if (scrollTop < 200 && file.startLine > 1 && !file.reachedStart) {
      files.loadMore(file.path, 'before');
    }

    // Load more when near bottom
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    if (distanceFromBottom < 200 && !file.reachedEnd) {
      files.loadMore(file.path, 'after');
    }
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
          updateDecorations();
        }, 50);
      });
    }

    // Initial decoration update (with delay to ensure content is ready)
    setTimeout(() => {
      updateDecorations();
    }, 100);
  }

  function handleClose() {
    files.closeFile(file.path);
  }

  function handleKeyDown(e: KeyboardEvent) {
    // : - open goto line (vim style), also while the read-only editor
    // text has focus. The go-to box closes itself on Escape and when it
    // loses focus.
    if (isShortcut('gotoLine', e) && !acceptsTyping(e.target as HTMLElement)) {
      e.preventDefault();
      lineRangeNav?.openGoto();
    }
  }

  onMount(() => {
    installPaletteStyles();
    paneEl?.addEventListener('keydown', handleKeyDown);
    for (const type of USER_SCROLL_EVENTS) {
      paneEl?.addEventListener(type, noteUserScroll, { passive: true });
    }
  });

  onDestroy(() => {
    // The editor is still there: a component's own onDestroy runs before
    // its children are destroyed.
    rememberTab();
    paneEl?.removeEventListener('keydown', handleKeyDown);
    for (const type of USER_SCROLL_EVENTS) paneEl?.removeEventListener(type, noteUserScroll);
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
  <!-- File header -->
  {#if !hideHeader}
    <div
      class="flex items-center justify-between px-3 py-2 gap-3
           bg-gh-canvas-subtle dark:bg-gh-canvas-dark-subtle
           border-b border-gh-border-default dark:border-gh-border-dark-default"
    >
      <div class="flex items-center gap-3 min-w-0">
        <span class="text-base font-medium truncate" title={file.path}>
          {file.name}
        </span>
        <FileBadges
          isCompressed={file.isCompressed}
          compressionFormat={file.compressionFormat}
          isIndexed={null}
        />
        {#if file.lines.length > 0}
          <LineRangeNav
            bind:this={lineRangeNav}
            startLine={file.startLine}
            endLine={file.endLine}
            totalLines={file.totalLines}
            on:jump={(e) => jumpToLineNumber(e.detail.line)}
            on:goto={(e) => files.jumpToLine(file.path, e.detail.line)}
            on:jumpToEnd={() => files.jumpToEnd(file.path)}
          />
        {/if}
      </div>

      <div class="flex items-center gap-2">
        <AnomalyCategoryNav
          summary={file.anomalySummary}
          selectedCategory={file.selectedAnomalyCategory}
          on:toggle={(e) => files.toggleAnomalyCategory(file.path, e.detail.category)}
          on:navigate={(e) => navigateToAnomaly(e.detail.category, e.detail.direction)}
        />

        <EditorToolbar
          syntaxHighlighting={file.syntaxHighlighting}
          wordWrap={file.wordWrap}
          showInvisibleChars={file.showInvisibleChars}
          filterEnabled={Boolean(file.regexFilter?.enabled)}
          {monacoTheme}
          on:toggleSyntax={toggleSyntaxHighlighting}
          on:toggleWordWrap={() => files.toggleWordWrap(file.path)}
          on:toggleInvisible={toggleInvisibleChars}
          on:toggleFilter={toggleFilterPanel}
          on:close={handleClose}
        />
      </div>
    </div>
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
        {fontSize}
        lineNumbersStart={file.startLine}
        {showLineNumbers}
        wordWrap={file.wordWrap}
        {showMinimap}
        showInvisibleChars={file.showInvisibleChars}
        on:scroll={handleMonacoScroll}
        on:ready={handleMonacoReady}
      />
    {/if}
  </div>
</div>
