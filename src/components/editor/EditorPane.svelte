<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { OpenFile } from '$lib/types';
  import { files, settings, resolvedTheme, CATEGORY_ICONS } from '$lib/stores';
  import Spinner from '../common/Spinner.svelte';
  import FileBadges from '../common/FileBadges.svelte';
  import MonacoEditor from './MonacoEditor.svelte';
  import RegexFilterPanel from './RegexFilterPanel.svelte';
  import EditorToolbar from './EditorToolbar.svelte';
  import { detectMonacoLanguage } from '$lib/utils/monacoLanguage';
  import { updateUrlState, debounce } from '$lib/utils/urlState';
  import { processContent } from '$lib/utils/processContent';
  import {
    anomalyCategoryDecorations,
    hiddenMarkerDecorations,
    highlightedRangeDecorations,
    matchLineDecorations,
    regexHighlightDecorations,
  } from '$lib/utils/editorDecorations';
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

  // Goto line state
  let dashGotoVisible = false;
  let dashGotoLineNumber = '';
  let dashGotoInputEl: HTMLInputElement;

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

  // Get unique symbol for each anomaly category
  function getCategorySymbol(category: string): string {
    const symbols: Record<string, string> = {
      error: '\u2716', // ✖ Heavy multiplication X
      warning: '\u26A0', // ⚠ Warning sign
      traceback: '\u2261', // ≡ Identical to (stack symbol)
      format: '\u00B6', // ¶ Pilcrow sign
      security: '\u2622', // ☢ Radioactive (or use 🔒)
      timing: '\u23F1', // ⏱ Stopwatch
      multiline: '\u2630', // ☰ Trigram for heaven (hamburger menu)
    };
    return symbols[category] || '\u2022'; // • Bullet as fallback
  }

  // Handle anomaly category button click with modifier key detection
  function navigateToAnomaly(category: string, direction: 'next' | 'previous') {
    if (!file.anomalies) return;

    // Get anomalies of this category, sorted by start_line
    const categoryAnomalies = file.anomalies
      .filter((a) => a.category === category)
      .sort((a, b) => a.start_line - b.start_line);

    if (categoryAnomalies.length === 0) return;

    // Get current center line of the viewport
    let currentCenterLine: number;
    if (monacoEditor) {
      const visibleRanges = monacoEditor.getVisibleRanges();
      if (visibleRanges.length > 0) {
        const firstRange = visibleRanges[0];
        const lastRange = visibleRanges[visibleRanges.length - 1];
        const monacoCenter = Math.floor((firstRange.startLineNumber + lastRange.endLineNumber) / 2);
        // Convert Monaco line to file line
        currentCenterLine = monacoCenter + file.startLine - 1;
      } else {
        currentCenterLine = file.startLine;
      }
    } else {
      currentCenterLine = file.startLine;
    }

    let targetAnomaly;

    if (direction === 'previous') {
      // Find previous anomaly (start_line < currentCenterLine)
      // Use currentCenterLine - 1 to ensure we move past the current anomaly if centered on it
      const previousAnomalies = categoryAnomalies.filter(
        (a) => a.start_line < currentCenterLine - 1,
      );
      if (previousAnomalies.length > 0) {
        targetAnomaly = previousAnomalies[previousAnomalies.length - 1];
      } else {
        // Wrap around to the last anomaly
        targetAnomaly = categoryAnomalies[categoryAnomalies.length - 1];
      }
    } else {
      // Find next anomaly (start_line > currentCenterLine)
      // Use currentCenterLine + 1 to ensure we move past the current anomaly if centered on it
      const nextAnomalies = categoryAnomalies.filter((a) => a.start_line > currentCenterLine + 1);
      if (nextAnomalies.length > 0) {
        targetAnomaly = nextAnomalies[0];
      } else {
        // Wrap around to the first anomaly
        targetAnomaly = categoryAnomalies[0];
      }
    }

    if (targetAnomaly) {
      const targetLine = targetAnomaly.start_line;

      // Check if target line is already loaded
      const isLoaded =
        targetLine >= file.startLine && targetLine <= file.startLine + file.lines.length - 1;

      if (isLoaded && monacoEditor) {
        // Scroll to the line within the editor
        const monacoLine = targetLine - file.startLine + 1;
        monacoEditor.revealLineInCenter(monacoLine);
      } else {
        // Jump to the line (will trigger loading)
        files.jumpToLine(file.path, targetLine);
      }
    }
  }

  function handleCategoryClick(e: MouseEvent, category: string) {
    const isNavModifier = e.metaKey || e.altKey; // Cmd or Alt/Option
    const isReverse = e.shiftKey;

    // If category is not currently selected, or no navigation modifier pressed, just toggle
    if (file.selectedAnomalyCategory !== category || !isNavModifier) {
      files.toggleAnomalyCategory(file.path, category);
      return;
    }

    // Navigation mode: find next/previous anomaly of this category
    navigateToAnomaly(category, isReverse ? 'previous' : 'next');
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

  function openDashGoto() {
    const centerLine = Math.round((file.startLine + file.endLine) / 2);
    dashGotoLineNumber = centerLine.toString();
    dashGotoVisible = true;
    setTimeout(() => {
      dashGotoInputEl?.focus();
      dashGotoInputEl?.select();
    }, 0);
  }

  function closeDashGoto() {
    dashGotoVisible = false;
    dashGotoLineNumber = '';
  }

  function handleDashGotoKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const lineNum = parseInt(dashGotoLineNumber, 10);
      if (!isNaN(lineNum) && lineNum > 0) {
        files.jumpToLine(file.path, lineNum);
        closeDashGoto();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeDashGoto();
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

    // : - open goto line (vim style)
    if (e.key === ':' && !dashGotoVisible && !isInputFocused) {
      e.preventDefault();
      openDashGoto();
      return;
    }

    if (e.key === 'Escape') {
      if (dashGotoVisible) {
        closeDashGoto();
      }
      return;
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
          <span
            class="text-sm text-gh-fg-muted dark:text-gh-fg-dark-muted flex items-center gap-1.5"
          >
            <span>lines</span>
            <button
              class="font-bold hover:text-gh-accent-fg dark:hover:text-gh-accent-dark-fg hover:underline"
              on:click={() => jumpToLineNumber(file.startLine)}
              title="Jump to line {file.startLine}"
            >
              {file.startLine.toLocaleString()}
            </button>
            {#if dashGotoVisible}
              <input
                bind:this={dashGotoInputEl}
                bind:value={dashGotoLineNumber}
                on:keydown={handleDashGotoKeyDown}
                on:blur={closeDashGoto}
                type="number"
                class="text-sm bg-gh-canvas-default dark:bg-gh-canvas-dark-default border border-gh-border-default dark:border-gh-border-dark-default rounded px-2 py-0.5 outline-none w-32 text-center font-bold"
              />
            {:else}
              <button
                class="font-bold hover:text-gh-accent-fg dark:hover:text-gh-accent-dark-fg hover:underline px-1"
                on:click={openDashGoto}
                title="Jump to line..."
              >
                —
              </button>
            {/if}
            <button
              class="font-bold hover:text-gh-accent-fg dark:hover:text-gh-accent-dark-fg hover:underline"
              on:click={() => jumpToLineNumber(file.endLine)}
              title="Jump to line {file.endLine}"
            >
              {file.endLine.toLocaleString()}
            </button>
            <span class="text-gh-fg-subtle dark:text-gh-fg-dark-subtle">/</span>
            {#if file.totalLines !== null}
              {@const lastLine = file.totalLines}
              <button
                class="font-bold hover:text-gh-accent-fg dark:hover:text-gh-accent-dark-fg hover:underline"
                on:click={() => jumpToLineNumber(lastLine)}
                title="Jump to last line ({lastLine.toLocaleString()})"
              >
                {lastLine.toLocaleString()}
              </button>
            {:else}
              <button
                class="font-bold hover:text-gh-accent-fg dark:hover:text-gh-accent-dark-fg hover:underline"
                on:click={() => files.jumpToEnd(file.path)}
                title="Jump to end of file"
              >
                ⋯
              </button>
            {/if}
          </span>
        {/if}
      </div>

      <div class="flex items-center gap-2">
        <!-- Anomaly category toggles (only shown if file has anomalies) -->
        {#if file.anomalySummary && Object.keys(file.anomalySummary).length > 0}
          {#each Object.entries(file.anomalySummary) as [category, count]}
            {@const categoryInfo = CATEGORY_ICONS[category] || {
              icon: '?',
              color: '#6b7280',
              label: category,
            }}
            {@const isActive = file.selectedAnomalyCategory === category}
            <button
              class="px-1.5 py-0.5 rounded flex-shrink-0 transition-colors text-xs font-medium flex items-center gap-1"
              style={isActive
                ? `background-color: ${categoryInfo.color}; color: white;`
                : `background-color: transparent; color: ${categoryInfo.color}; border: 1px solid ${categoryInfo.color};`}
              title="{categoryInfo.label}: {count} anomal{count === 1 ? 'y' : 'ies'}"
              on:click={(e) => handleCategoryClick(e, category)}
            >
              <span class="anomaly-icon" style="font-size: 10px;"
                >{getCategorySymbol(category)}</span
              >
              <span>{count}</span>
            </button>
            {#if isActive}
              <div class="flex flex-col gap-0 flex-shrink-0">
                <button
                  class="px-0.5 rounded-t flex-shrink-0 transition-colors hover:opacity-80"
                  style="background-color: {categoryInfo.color}; color: white; line-height: 0;"
                  title="Previous {categoryInfo.label.toLowerCase()}"
                  on:click={() => navigateToAnomaly(category, 'previous')}
                >
                  <svg class="w-2.5 h-2" viewBox="0 0 10 8" fill="currentColor">
                    <path d="M5 1L1 7h8L5 1z" />
                  </svg>
                </button>
                <button
                  class="px-0.5 rounded-b flex-shrink-0 transition-colors hover:opacity-80"
                  style="background-color: {categoryInfo.color}; color: white; line-height: 0;"
                  title="Next {categoryInfo.label.toLowerCase()}"
                  on:click={() => navigateToAnomaly(category, 'next')}
                >
                  <svg class="w-2.5 h-2" viewBox="0 0 10 8" fill="currentColor">
                    <path d="M5 7L1 1h8L5 7z" />
                  </svg>
                </button>
              </div>
            {/if}
          {/each}

          <!-- Vertical divider -->
          <div class="w-px h-5 bg-gh-border-default dark:bg-gh-border-dark-default mx-1"></div>
        {/if}

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
