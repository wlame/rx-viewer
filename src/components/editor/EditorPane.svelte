<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { OpenFile } from '$lib/types';
  import { files, settings, resolvedTheme, CATEGORY_ICONS } from '$lib/stores';
  import Spinner from '../common/Spinner.svelte';
  import FileBadges from '../common/FileBadges.svelte';
  import MonacoEditor from './MonacoEditor.svelte';
  import RegexFilterPanel from './RegexFilterPanel.svelte';
  import EditorToolbar from './EditorToolbar.svelte';
  import AnomalyCategoryNav from './AnomalyCategoryNav.svelte';
  import LineRangeNav from './LineRangeNav.svelte';
  import { detectMonacoLanguage } from '$lib/utils/monacoLanguage';
  import { updateUrlState, debounce } from '$lib/utils/urlState';
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

  // Regex filter state
  let filterPanelVisible = false;
  let filterPattern = '';
  let filterMode: 'hide' | 'show' | 'highlight' = 'highlight';

  // Track scroll state for content loading
  let isScrollingToTarget = false;
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
            CATEGORY_ICONS[category]?.color || '#6b7280',
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
    if (isActive) {
      const centerLine = getCurrentViewportCenterLine();
      updateUrlState({
        path: file.path,
        line: centerLine,
        syntaxHighlighting: !file.syntaxHighlighting,
      });
    }
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

  // Update URL when this file becomes active
  $: if (isActive && file.lines.length > 0) {
    const centerLine = getCurrentViewportCenterLine();
    updateUrlState({
      path: file.path,
      line: centerLine,
      syntaxHighlighting: file.syntaxHighlighting,
    });
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
    // Delay scroll to ensure content is rendered in Monaco
    setTimeout(() => {
      scrollToLine(file.scrollToLine!);
    }, 100);
  }

  function getCurrentViewportCenterLine(): number {
    if (!monacoEditor || file.lines.length === 0) return file.startLine;

    const visibleRanges = monacoEditor.getVisibleRanges();
    if (visibleRanges.length === 0) return file.startLine;

    const firstVisible = visibleRanges[0].startLineNumber;
    const lastVisible = visibleRanges[visibleRanges.length - 1].endLineNumber;
    const centerMonacoLine = Math.floor((firstVisible + lastVisible) / 2);

    // Convert Monaco line to file line number
    return file.startLine + centerMonacoLine - 1;
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

  // Debounced URL update on scroll
  const updateUrlOnScroll = debounce(() => {
    if (isActive && file.lines.length > 0) {
      const centerLine = getCurrentViewportCenterLine();
      updateUrlState({
        path: file.path,
        line: centerLine,
        syntaxHighlighting: file.syntaxHighlighting,
      });
    }
  }, 500);

  function handleMonacoScroll(
    e: CustomEvent<{ scrollTop: number; scrollHeight: number; clientHeight: number }>,
  ) {
    const { scrollTop, scrollHeight, clientHeight } = e.detail;

    updateUrlOnScroll();

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

  function handleMonacoReady(e: CustomEvent<{ editor: Monaco.editor.IStandaloneCodeEditor }>) {
    monacoEditor = e.detail.editor;

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
    const target = e.target as HTMLElement;
    const isInputFocused =
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.contentEditable === 'true' ||
      target.contentEditable === 'plaintext-only';

    // : - open goto line (vim style). The go-to box closes itself on
    // Escape and when it loses focus.
    if (e.key === ':' && !isInputFocused) {
      e.preventDefault();
      lineRangeNav?.openGoto();
    }
  }

  onMount(() => {
    paneEl?.addEventListener('keydown', handleKeyDown);
  });

  onDestroy(() => {
    paneEl?.removeEventListener('keydown', handleKeyDown);
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
