<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { OpenFile, MonacoTheme } from '$lib/types';
  import { MONACO_THEMES } from '$lib/types';
  import { files, settings, resolvedTheme, CATEGORY_ICONS } from '$lib/stores';
  import Spinner from '../common/Spinner.svelte';
  import FileBadges from '../common/FileBadges.svelte';
  import MonacoEditor from './MonacoEditor.svelte';
  import { detectMonacoLanguage } from '$lib/utils/monacoLanguage';
  import { updateUrlState, debounce } from '$lib/utils/urlState';
  import Prism from 'prismjs';
  import 'prismjs/components/prism-regex';
  import type * as Monaco from 'monaco-editor';

  export let file: OpenFile;
  export let hideHeader: boolean = false;
  export let isActive: boolean = false;

  let paneEl: HTMLDivElement;
  let monacoComponent: MonacoEditor;
  let monacoEditor: Monaco.editor.IStandaloneCodeEditor | null = null;
  let decorationsCollection: Monaco.editor.IEditorDecorationsCollection | null = null;

  // Store hidden content for hover tooltips: Map<"lineNum:markerIndex", hiddenText>
  let hiddenContentMap: Map<string, string> = new Map();

  // Marker character for hidden content (using a single space that we style)
  const HIDDEN_MARKER = '\u200A'; // Hair space (very thin)

  // Goto line state
  let dashGotoVisible = false;
  let dashGotoLineNumber = '';
  let dashGotoInputEl: HTMLInputElement;

  // Regex filter state
  let filterPanelVisible = false;
  let filterPattern = '';
  let filterMode: 'hide' | 'show' | 'highlight' = 'highlight';
  let regexInputEl: HTMLDivElement;
  let highlightTimeout: number | null = null;

  // Theme dropdown state
  let themeDropdownVisible = false;

  // Track scroll state for content loading
  let isScrollingToTarget = false;
  let lastScrollTop = 0;
  let lastContentLoadTime = 0; // Timestamp of last content load to prevent immediate loadMore

  // Settings
  $: fontSize = $settings.editorFontSize;
  $: showLineNumbers = $settings.showLineNumbers;
  $: wrapLines = $settings.wrapLines;
  $: showMinimap = $settings.showMinimap;
  $: monacoTheme = $settings.monacoTheme;

  // File matches from trace search
  $: fileMatches = $files.matches.get(file.path) || [];

  // Detect language for Monaco
  $: monacoLanguage = detectMonacoLanguage(file.name);

  // Theme - use resolved theme from settings store (reacts to dark/light mode changes)
  $: theme = $resolvedTheme;

  // Convert file lines to content string for Monaco
  // Apply regex filter pre-processing for hide/show modes
  // Note: We need to reference file.lines directly to trigger reactivity
  $: content = getProcessedContent(file.lines, file.regexFilter, file.showInvisibleChars);

  function getProcessedContent(lines: typeof file.lines, regexFilter: typeof file.regexFilter, showInvisibleChars: boolean): string {
    // Clear hidden content map when reprocessing
    hiddenContentMap = new Map();

    // Process line content - handle \r characters
    // When showing invisible chars: replace \r with visible symbol (␍ - U+240D SYMBOL FOR CARRIAGE RETURN)
    // Otherwise: strip \r completely to prevent Monaco from treating them as line breaks
    const CR_SYMBOL = '\u240D'; // ␍ - Symbol for Carriage Return
    const processedLines = showInvisibleChars
      ? lines.map(l => l.content.replace(/\r/g, CR_SYMBOL))
      : lines.map(l => l.content.replace(/\r/g, ''));

    const rawContent = processedLines.join('\n');

    // Apply regex filter for hide/show modes (not highlight - that uses decorations)
    if (regexFilter?.enabled && regexFilter?.compiledRegex) {
      const mode = regexFilter.mode;
      const pattern = regexFilter.pattern;

      // Check if regex has capturing groups
      const hasGroups = /\([^?]/.test(pattern) || /\(\?</.test(pattern);

      if (mode === 'hide') {
        // Hide matching groups (or entire match if no groups) - replace with marker
        try {
          const resultLines: string[] = [];

          processedLines.forEach((lineContent, lineIdx) => {
            const monacoLine = lineIdx + 1;
            const lineRegex = new RegExp(pattern, 'g');
            let match;

            // Collect all group matches with their positions
            const replacements: Array<{start: number, end: number, text: string}> = [];

            while ((match = lineRegex.exec(lineContent)) !== null) {
              if (hasGroups && match.length > 1) {
                // Find and replace each captured group
                let matchOffset = match.index;
                for (let i = 1; i < match.length; i++) {
                  if (match[i] !== undefined) {
                    const groupText = match[i];
                    const groupStart = lineContent.indexOf(groupText, matchOffset);
                    if (groupStart !== -1) {
                      replacements.push({
                        start: groupStart,
                        end: groupStart + groupText.length,
                        text: groupText
                      });
                      matchOffset = groupStart + groupText.length;
                    }
                  }
                }
              } else {
                // No groups - hide entire match
                replacements.push({
                  start: match.index,
                  end: match.index + match[0].length,
                  text: match[0]
                });
              }
            }

            // Sort by position and apply replacements from end to start
            replacements.sort((a, b) => b.start - a.start);

            let result = lineContent;
            // Store in reverse order but with forward marker indices
            const reversedReplacements = [...replacements];
            for (let i = reversedReplacements.length - 1; i >= 0; i--) {
              const rep = reversedReplacements[i];
              // Key is line:markerIndex (0-based index of marker on this line)
              const key = `${monacoLine}:${reversedReplacements.length - 1 - i}`;
              hiddenContentMap.set(key, rep.text);
            }

            // Apply replacements from end to start
            for (const rep of replacements) {
              result = result.substring(0, rep.start) + HIDDEN_MARKER + result.substring(rep.end);
            }

            resultLines.push(result);
          });

          return resultLines.join('\n');
        } catch (e) {
          return rawContent;
        }
      } else if (mode === 'show') {
        // Show only matching groups (or entire match if no groups) - replace non-matching parts with marker
        try {
          const resultLines: string[] = [];

          processedLines.forEach((lineContent, lineIdx) => {
            const monacoLine = lineIdx + 1;
            const lineRegex = new RegExp(pattern, 'g');
            let match;

            // Collect all "show" ranges (captured groups or entire matches)
            const showRanges: Array<{start: number, end: number, text: string}> = [];

            while ((match = lineRegex.exec(lineContent)) !== null) {
              if (hasGroups && match.length > 1) {
                // Find actual positions of each captured group within the line
                let searchStart = match.index;
                for (let i = 1; i < match.length; i++) {
                  if (match[i] !== undefined) {
                    const groupText = match[i];
                    const groupStart = lineContent.indexOf(groupText, searchStart);
                    if (groupStart !== -1) {
                      showRanges.push({
                        start: groupStart,
                        end: groupStart + groupText.length,
                        text: groupText
                      });
                      searchStart = groupStart + groupText.length;
                    }
                  }
                }
              } else {
                // No groups - show entire match
                showRanges.push({
                  start: match.index,
                  end: match.index + match[0].length,
                  text: match[0]
                });
              }
            }

            // Build segments: alternating between hidden and shown parts
            const segments: Array<{isMatch: boolean, text: string}> = [];
            let lastEnd = 0;

            // Sort showRanges by start position
            showRanges.sort((a, b) => a.start - b.start);

            for (const range of showRanges) {
              // Add hidden segment before this show range
              if (range.start > lastEnd) {
                segments.push({
                  isMatch: false,
                  text: lineContent.substring(lastEnd, range.start)
                });
              }
              // Add the shown segment
              segments.push({
                isMatch: true,
                text: range.text
              });
              lastEnd = range.end;
            }

            // Add remaining hidden segment after last show range
            if (lastEnd < lineContent.length) {
              segments.push({
                isMatch: false,
                text: lineContent.substring(lastEnd)
              });
            }

            // Build result line
            if (segments.length === 0) {
              // No matches - entire line is hidden
              if (lineContent.length > 0) {
                const key = `${monacoLine}:0`;
                hiddenContentMap.set(key, lineContent);
                resultLines.push(HIDDEN_MARKER);
              } else {
                resultLines.push('');
              }
            } else {
              let resultLine = '';
              let markerIndex = 0;

              for (const seg of segments) {
                if (seg.isMatch) {
                  resultLine += seg.text;
                } else if (seg.text.length > 0) {
                  // Hidden segment (including whitespace-only)
                  const key = `${monacoLine}:${markerIndex}`;
                  hiddenContentMap.set(key, seg.text);
                  resultLine += HIDDEN_MARKER;
                  markerIndex++;
                }
              }

              resultLines.push(resultLine || HIDDEN_MARKER);
            }
          });

          return resultLines.join('\n');
        } catch (e) {
          return rawContent;
        }
      }
    }

    return rawContent;
  }

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

    // Clear previous decorations
    if (decorationsCollection) {
      decorationsCollection.clear();
    }

    const decorations: Monaco.editor.IModelDeltaDecoration[] = [];

    // Add decorations for trace search matches
    for (const match of fileMatches) {
      // Convert file line number to Monaco line number
      const monacoLine = match.lineNumber - file.startLine + 1;
      if (monacoLine >= 1 && monacoLine <= file.lines.length) {
        decorations.push({
          range: {
            startLineNumber: monacoLine,
            startColumn: 1,
            endLineNumber: monacoLine,
            endColumn: 1,
          },
          options: {
            isWholeLine: true,
            className: 'monaco-match-line',
            glyphMarginClassName: 'monaco-match-glyph',
          },
        });
      }
    }

    // Add decorations for highlighted lines (e.g., from single anomaly click)
    if (file.highlightedLines) {
      const { start, end } = file.highlightedLines;
      for (let lineNum = start; lineNum <= end; lineNum++) {
        // Convert file line number to Monaco line number
        const monacoLine = lineNum - file.startLine + 1;
        if (monacoLine >= 1 && monacoLine <= file.lines.length) {
          decorations.push({
            range: {
              startLineNumber: monacoLine,
              startColumn: 1,
              endLineNumber: monacoLine,
              endColumn: 1,
            },
            options: {
              isWholeLine: true,
              className: 'monaco-anomaly-line',
              glyphMarginClassName: 'monaco-anomaly-glyph',
              minimap: {
                color: { id: 'minimap.findMatchHighlight' },
                position: 1, // Monaco.editor.MinimapPosition.Inline
              },
            },
          });
        }
      }
    }

    // Add decorations for selected anomaly category (highlights all lines in that category)
    if (file.selectedAnomalyCategory && file.anomalies) {
      const selectedCategory = file.selectedAnomalyCategory;
      const categoryColor = CATEGORY_ICONS[selectedCategory]?.color || '#6b7280';

      // Filter anomalies by selected category
      const categoryAnomalies = file.anomalies.filter(a => a.category === selectedCategory);

      for (const anomaly of categoryAnomalies) {
        // Build hover message with anomaly details
        const hoverMessage = {
          value: [
            `**${anomaly.category.toUpperCase()}** | Severity: ${anomaly.severity}`,
            ``,
            `**Detector:** ${anomaly.detector}`,
            ``,
            anomaly.description || '_No description_',
          ].join('\n'),
          isTrusted: true,
        };

        for (let lineNum = anomaly.start_line; lineNum <= anomaly.end_line; lineNum++) {
          // Convert file line number to Monaco line number
          const monacoLine = lineNum - file.startLine + 1;
          if (monacoLine >= 1 && monacoLine <= file.lines.length) {
            decorations.push({
              range: {
                startLineNumber: monacoLine,
                startColumn: 1,
                endLineNumber: monacoLine,
                endColumn: 1,
              },
              options: {
                isWholeLine: true,
                className: `monaco-anomaly-category-line monaco-anomaly-${selectedCategory}`,
                glyphMarginClassName: `monaco-anomaly-category-glyph monaco-anomaly-${selectedCategory}-glyph`,
                glyphMarginHoverMessage: hoverMessage,
                minimap: {
                  color: categoryColor,
                  position: 1, // Monaco.editor.MinimapPosition.Inline
                },
              },
            });
          }
        }
      }
    }

    // Add decorations for regex filter in highlight mode
    if (file.regexFilter?.enabled && file.regexFilter?.compiledRegex && file.regexFilter.mode === 'highlight') {
      const model = monacoEditor.getModel();
      if (model) {
        try {
          // Use our own regex matching for more control
          const pattern = file.regexFilter.pattern;
          const regex = new RegExp(pattern, 'g');
          const lineCount = model.getLineCount();

          // Check if regex has capturing groups
          const hasGroups = /\([^?]/.test(pattern) || /\(\?</.test(pattern);

          for (let lineNum = 1; lineNum <= lineCount; lineNum++) {
            const lineContent = model.getLineContent(lineNum);
            let match;
            regex.lastIndex = 0; // Reset regex state

            while ((match = regex.exec(lineContent)) !== null) {
              if (hasGroups && match.length > 1) {
                // Highlight only captured groups
                let searchStart = match.index;
                for (let i = 1; i < match.length; i++) {
                  if (match[i] !== undefined) {
                    const groupText = match[i];
                    const groupStart = lineContent.indexOf(groupText, searchStart);
                    if (groupStart !== -1) {
                      decorations.push({
                        range: {
                          startLineNumber: lineNum,
                          startColumn: groupStart + 1,
                          endLineNumber: lineNum,
                          endColumn: groupStart + groupText.length + 1,
                        },
                        options: {
                          inlineClassName: 'monaco-regex-highlight',
                        },
                      });
                      searchStart = groupStart + groupText.length;
                    }
                  }
                }
              } else {
                // No groups - highlight entire match
                const startCol = match.index + 1;
                const endCol = match.index + match[0].length + 1;

                decorations.push({
                  range: {
                    startLineNumber: lineNum,
                    startColumn: startCol,
                    endLineNumber: lineNum,
                    endColumn: endCol,
                  },
                  options: {
                    inlineClassName: 'monaco-regex-highlight',
                  },
                });
              }

              // Prevent infinite loop on zero-width matches
              if (match[0].length === 0) {
                regex.lastIndex++;
              }
            }
          }
        } catch (e) {
          console.warn('Regex filter error:', e);
        }
      }
    }

    // Add decorations for hidden content markers (hide/show modes)
    if (file.regexFilter?.enabled && file.regexFilter?.compiledRegex &&
        (file.regexFilter.mode === 'hide' || file.regexFilter.mode === 'show')) {
      const model = monacoEditor.getModel();
      if (model) {
        const markerClass = file.regexFilter.mode === 'hide'
          ? 'monaco-hidden-marker-red'
          : 'monaco-hidden-marker-blue';

        const lineCount = model.getLineCount();
        for (let lineNum = 1; lineNum <= lineCount; lineNum++) {
          const lineContent = model.getLineContent(lineNum);
          let col = 1;
          let markerIndex = 0;
          for (const char of lineContent) {
            if (char === HIDDEN_MARKER) {
              // Get the hidden text for this marker
              const key = `${lineNum}:${markerIndex}`;
              const hiddenText = hiddenContentMap.get(key);

              decorations.push({
                range: {
                  startLineNumber: lineNum,
                  startColumn: col,
                  endLineNumber: lineNum,
                  endColumn: col + 1,
                },
                options: {
                  inlineClassName: markerClass,
                  hoverMessage: hiddenText ? { value: hiddenText } : undefined,
                },
              });
              markerIndex++;
            }
            col++;
          }
        }
      }
    }

    // Create new decorations collection
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
      error: '\u2716',      // ✖ Heavy multiplication X
      warning: '\u26A0',    // ⚠ Warning sign
      traceback: '\u2261',  // ≡ Identical to (stack symbol)
      format: '\u00B6',     // ¶ Pilcrow sign
      security: '\u2622',   // ☢ Radioactive (or use 🔒)
      timing: '\u23F1',     // ⏱ Stopwatch
      multiline: '\u2630',  // ☰ Trigram for heaven (hamburger menu)
    };
    return symbols[category] || '\u2022'; // • Bullet as fallback
  }

  // Handle anomaly category button click with modifier key detection
  function handleCategoryClick(e: MouseEvent, category: string) {
    const isNavModifier = e.metaKey || e.altKey; // Cmd or Alt/Option
    const isReverse = e.shiftKey;

    // If category is not currently selected, or no navigation modifier pressed, just toggle
    if (file.selectedAnomalyCategory !== category || !isNavModifier) {
      files.toggleAnomalyCategory(file.path, category);
      return;
    }

    // Navigation mode: find next/previous anomaly of this category
    if (!file.anomalies) return;

    // Get anomalies of this category, sorted by start_line
    const categoryAnomalies = file.anomalies
      .filter(a => a.category === category)
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

    if (isReverse) {
      // Find previous anomaly (start_line < currentCenterLine)
      // Use currentCenterLine - 1 to ensure we move past the current anomaly if centered on it
      const previousAnomalies = categoryAnomalies.filter(a => a.start_line < currentCenterLine - 1);
      if (previousAnomalies.length > 0) {
        targetAnomaly = previousAnomalies[previousAnomalies.length - 1];
      } else {
        // Wrap around to the last anomaly
        targetAnomaly = categoryAnomalies[categoryAnomalies.length - 1];
      }
    } else {
      // Find next anomaly (start_line > currentCenterLine)
      // Use currentCenterLine + 1 to ensure we move past the current anomaly if centered on it
      const nextAnomalies = categoryAnomalies.filter(a => a.start_line > currentCenterLine + 1);
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
      const isLoaded = targetLine >= file.startLine && targetLine <= file.startLine + file.lines.length - 1;

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

  function toggleThemeDropdown() {
    themeDropdownVisible = !themeDropdownVisible;
  }

  function selectTheme(themeId: MonacoTheme) {
    settings.update(s => ({ ...s, monacoTheme: themeId }));
    themeDropdownVisible = false;
  }

  function handleClickOutsideThemeDropdown(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest('.theme-dropdown-container')) {
      themeDropdownVisible = false;
    }
  }

  function applyFilter() {
    files.updateRegexFilter(file.path, filterPattern, filterMode);
  }

  function clearFilter() {
    files.clearRegexFilter(file.path);
    filterPattern = '';
    filterMode = 'highlight';
    filterPanelVisible = false;
  }

  function handleFilterKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyFilter();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      filterPanelVisible = false;
    }
  }

  function highlightRegexPattern(pattern: string): string {
    if (!pattern) return '';
    try {
      return Prism.highlight(pattern, Prism.languages.regex, 'regex');
    } catch (e) {
      return pattern.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  }

  function getCursorPosition(element: HTMLElement): number {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return 0;
    const range = selection.getRangeAt(0);
    const preCaretRange = range.cloneRange();
    preCaretRange.selectNodeContents(element);
    preCaretRange.setEnd(range.endContainer, range.endOffset);
    return preCaretRange.toString().length;
  }

  function setCursorPosition(element: HTMLElement, position: number) {
    const selection = window.getSelection();
    if (!selection) return;
    let currentPos = 0;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const textLength = node.textContent?.length || 0;
      if (currentPos + textLength >= position) {
        const range = document.createRange();
        range.setStart(node, position - currentPos);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        return;
      }
      currentPos += textLength;
    }
    if (element.lastChild) {
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }

  function handleRegexInput(e: Event) {
    const target = e.target as HTMLDivElement;
    const text = target.textContent || '';
    if (text === 'e.g. (\\w+)@(\\w+)\\.com') return;
    filterPattern = text;
    if (highlightTimeout !== null) {
      cancelAnimationFrame(highlightTimeout);
    }
    const cursorPos = getCursorPosition(target);
    highlightTimeout = requestAnimationFrame(() => {
      if (!regexInputEl) return;
      const highlighted = highlightRegexPattern(text);
      if (highlighted) {
        regexInputEl.innerHTML = highlighted;
        requestAnimationFrame(() => {
          setCursorPosition(regexInputEl, cursorPos);
        });
      }
      highlightTimeout = null;
    });
  }

  $: if (filterPanelVisible && regexInputEl) {
    if (filterPattern) {
      regexInputEl.innerHTML = highlightRegexPattern(filterPattern);
    } else {
      regexInputEl.textContent = '';
    }
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
  $: if (file.scrollToLine !== undefined && monacoComponent && file.lines.length > 0 && !file.loading) {
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

  /**
   * Check if we need to load more content based on current scroll position
   */
  function checkAndLoadMore() {
    if (!monacoEditor || file.loading) return;

    const scrollTop = monacoEditor.getScrollTop();
    const scrollHeight = monacoEditor.getScrollHeight();
    const clientHeight = monacoEditor.getDomNode()?.clientHeight ?? 0;

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

  function handleMonacoScroll(e: CustomEvent<{ scrollTop: number; scrollHeight: number; clientHeight: number }>) {
    const { scrollTop, scrollHeight, clientHeight } = e.detail;

    updateUrlOnScroll();

    // Don't trigger loadMore during programmatic scrolling or right after content load
    if (file.scrollToLine !== undefined || isScrollingToTarget) {
      lastScrollTop = scrollTop;
      return;
    }

    // Skip loadMore for 1 second after content was loaded (prevents extra calls after jumpToLine)
    const timeSinceLoad = Date.now() - lastContentLoadTime;
    if (timeSinceLoad < 1000) {
      lastScrollTop = scrollTop;
      return;
    }

    if (file.loading) {
      lastScrollTop = scrollTop;
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

    lastScrollTop = scrollTop;
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
    const isInputFocused = target.tagName === 'INPUT' ||
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
    document.addEventListener('click', handleClickOutsideThemeDropdown);
  });

  onDestroy(() => {
    paneEl?.removeEventListener('keydown', handleKeyDown);
    document.removeEventListener('click', handleClickOutsideThemeDropdown);
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
        <span class="text-sm text-gh-fg-muted dark:text-gh-fg-dark-muted flex items-center gap-1.5">
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
            <button
              class="font-bold hover:text-gh-accent-fg dark:hover:text-gh-accent-dark-fg hover:underline"
              on:click={() => jumpToLineNumber(file.totalLines)}
              title="Jump to last line ({file.totalLines.toLocaleString()})"
            >
              {file.totalLines.toLocaleString()}
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
          {@const categoryInfo = CATEGORY_ICONS[category] || { icon: '?', color: '#6b7280', label: category }}
          <button
            class="px-1.5 py-0.5 rounded flex-shrink-0 transition-colors text-xs font-medium flex items-center gap-1"
            style="{file.selectedAnomalyCategory === category
              ? `background-color: ${categoryInfo.color}; color: white;`
              : `background-color: transparent; color: ${categoryInfo.color}; border: 1px solid ${categoryInfo.color};`}"
            title="{categoryInfo.label}: {count} anomal{count === 1 ? 'y' : 'ies'} | Cmd/Alt+Click: next | Shift+Cmd/Alt+Click: previous"
            on:click={(e) => handleCategoryClick(e, category)}
          >
            <span class="anomaly-icon" style="font-size: 10px;">{getCategorySymbol(category)}</span>
            <span>{count}</span>
          </button>
        {/each}

        <!-- Vertical divider -->
        <div class="w-px h-5 bg-gh-border-default dark:bg-gh-border-dark-default mx-1"></div>
      {/if}

      <!-- Syntax highlighting toggle -->
      <button
        class="p-1 rounded flex-shrink-0 transition-colors
               {file.syntaxHighlighting
                 ? 'bg-gh-accent-emphasis dark:bg-gh-accent-dark-emphasis text-white hover:bg-gh-accent-fg dark:hover:bg-gh-accent-dark-fg'
                 : 'bg-gh-canvas-inset dark:bg-gh-canvas-dark-inset text-gh-fg-muted dark:text-gh-fg-dark-muted hover:bg-gh-canvas-subtle dark:hover:bg-gh-canvas-dark-subtle'}"
        title="{file.syntaxHighlighting ? 'Disable' : 'Enable'} syntax highlighting"
        on:click={toggleSyntaxHighlighting}
      >
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M16 18L22 12L16 6M8 6L2 12L8 18" />
        </svg>
      </button>

      <!-- Invisible characters toggle -->
      <button
        class="p-1 rounded flex-shrink-0 transition-colors
               {file.showInvisibleChars
                 ? 'bg-gh-accent-emphasis dark:bg-gh-accent-dark-emphasis text-white hover:bg-gh-accent-fg dark:hover:bg-gh-accent-dark-fg'
                 : 'bg-gh-canvas-inset dark:bg-gh-canvas-dark-inset text-gh-fg-muted dark:text-gh-fg-dark-muted hover:bg-gh-canvas-subtle dark:hover:bg-gh-canvas-dark-subtle'}"
        title="{file.showInvisibleChars ? 'Hide' : 'Show'} invisible characters"
        on:click={toggleInvisibleChars}
      >
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M6 12h.01M12 12h.01M18 12h.01M6 18h.01M12 18h.01M18 18h.01M6 6h.01M12 6h.01M18 6h.01" stroke-linecap="round" />
        </svg>
      </button>

      <!-- Regex filter toggle -->
      <button
        class="p-1 rounded flex-shrink-0 transition-colors
               {file.regexFilter?.enabled
                 ? 'bg-gh-accent-emphasis dark:bg-gh-accent-dark-emphasis text-white hover:bg-gh-accent-fg dark:hover:bg-gh-accent-dark-fg'
                 : 'bg-gh-canvas-inset dark:bg-gh-canvas-dark-inset text-gh-fg-muted dark:text-gh-fg-dark-muted hover:bg-gh-canvas-subtle dark:hover:bg-gh-canvas-dark-subtle'}"
        title="Regex filter"
        on:click={toggleFilterPanel}
      >
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2.586a1 1 0 01-.293.707l-4.414 4.414a1 1 0 00-.293.707V17l-4 2v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
        </svg>
      </button>

      <!-- Theme selector dropdown -->
      <div class="relative theme-dropdown-container">
        <button
          class="p-1 rounded flex-shrink-0 transition-colors
                 {themeDropdownVisible
                   ? 'bg-gh-accent-emphasis dark:bg-gh-accent-dark-emphasis text-white'
                   : 'bg-gh-canvas-inset dark:bg-gh-canvas-dark-inset text-gh-fg-muted dark:text-gh-fg-dark-muted hover:bg-gh-canvas-subtle dark:hover:bg-gh-canvas-dark-subtle'}"
          title="Editor theme: {MONACO_THEMES.find(t => t.id === monacoTheme)?.name || 'Default'}"
          on:click={toggleThemeDropdown}
        >
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
          </svg>
        </button>

        {#if themeDropdownVisible}
          <div class="absolute right-0 top-full mt-1 z-50
                      bg-gh-canvas-default dark:bg-gh-canvas-dark-default
                      border border-gh-border-default dark:border-gh-border-dark-default
                      rounded-md shadow-lg py-1 min-w-[160px]">
            {#each MONACO_THEMES as themeOption}
              <button
                class="w-full px-3 py-1.5 text-left text-sm flex items-center gap-2
                       hover:bg-gh-canvas-subtle dark:hover:bg-gh-canvas-dark-subtle
                       {monacoTheme === themeOption.id ? 'text-gh-accent-fg dark:text-gh-accent-dark-fg font-medium' : 'text-gh-fg-default dark:text-gh-fg-dark-default'}"
                on:click={() => selectTheme(themeOption.id)}
              >
                <span class="w-3 h-3 rounded-full border
                             {themeOption.base === 'vs' ? 'bg-white border-gray-300' : 'bg-gray-800 border-gray-600'}"></span>
                {themeOption.name}
                {#if monacoTheme === themeOption.id}
                  <svg class="w-4 h-4 ml-auto" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M5 13l4 4L19 7" />
                  </svg>
                {/if}
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <button
        class="p-1 rounded hover:bg-gh-canvas-inset dark:hover:bg-gh-canvas-dark-inset
               text-gh-fg-muted dark:text-gh-fg-dark-muted flex-shrink-0"
        title="Close"
        on:click={handleClose}
      >
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  </div>
  {/if}

  <!-- Regex filter panel (expandable) -->
  {#if filterPanelVisible}
    <div class="px-3 py-3 bg-gh-canvas-subtle dark:bg-gh-canvas-dark-subtle border-b border-gh-border-default dark:border-gh-border-dark-default">
      <div class="flex items-center gap-3 mb-3">
        <label for="regex-filter-input" class="text-sm font-medium text-gh-fg-muted dark:text-gh-fg-dark-muted">
          Regex:
        </label>
        <div
          id="regex-filter-input"
          bind:this={regexInputEl}
          contenteditable="plaintext-only"
          on:input={handleRegexInput}
          on:keydown={handleFilterKeyDown}
          role="textbox"
          tabindex="0"
          aria-label="Regex pattern"
          data-placeholder="e.g. (\w+)@(\w+)\.com"
          class="flex-1 text-base bg-gh-canvas-default dark:bg-gh-canvas-dark-default
                 border border-gh-border-default dark:border-gh-border-dark-default
                 rounded px-3 py-2 outline-none focus:border-gh-accent-fg dark:focus:border-gh-accent-dark-fg
                 font-mono regex-input min-h-[36px]"
        ></div>
        <button
          on:click={applyFilter}
          class="px-4 py-1.5 text-sm font-medium rounded
                 bg-gh-accent-emphasis dark:bg-gh-accent-dark-emphasis text-white
                 hover:bg-gh-accent-fg dark:hover:bg-gh-accent-dark-fg"
        >
          Apply
        </button>
        <button
          on:click={clearFilter}
          class="px-4 py-1.5 text-sm font-medium rounded
                 bg-gh-canvas-inset dark:bg-gh-canvas-dark-inset
                 text-gh-fg-muted dark:text-gh-fg-dark-muted
                 hover:bg-gh-canvas-subtle dark:hover:bg-gh-canvas-dark-subtle"
        >
          Cancel
        </button>
      </div>

      <div class="flex items-center gap-4">
        <span class="text-sm font-medium text-gh-fg-muted dark:text-gh-fg-dark-muted">
          Mode:
        </span>
        <label class="flex items-center gap-1.5 text-sm cursor-pointer">
          <input
            type="radio"
            bind:group={filterMode}
            value="hide"
            on:change={applyFilter}
            class="cursor-pointer w-4 h-4"
          />
          <span>Hide groups</span>
        </label>
        <label class="flex items-center gap-1.5 text-sm cursor-pointer">
          <input
            type="radio"
            bind:group={filterMode}
            value="show"
            on:change={applyFilter}
            class="cursor-pointer w-4 h-4"
          />
          <span>Show only</span>
        </label>
        <label class="flex items-center gap-1.5 text-sm cursor-pointer">
          <input
            type="radio"
            bind:group={filterMode}
            value="highlight"
            on:change={applyFilter}
            class="cursor-pointer w-4 h-4"
          />
          <span>Highlight</span>
        </label>
      </div>

      {#if file.regexFilter?.error}
        <div class="mt-2 text-sm text-gh-danger-fg dark:text-gh-danger-dark-fg">
          {file.regexFilter.error}
        </div>
      {/if}
    </div>
  {/if}

  <!-- Content container with Monaco Editor -->
  <div class="flex-1 min-h-0 relative">
    {#if file.loading && file.lines.length === 0}
      <div class="flex items-center justify-center h-full">
        <Spinner size="lg" />
      </div>
    {:else if file.error}
      <div class="flex items-center justify-center h-full text-gh-danger-fg dark:text-gh-danger-dark-fg">
        <div class="text-center p-4">
          <p class="font-medium">Failed to load file</p>
          <p class="text-sm mt-1 opacity-75">{file.error}</p>
        </div>
      </div>
    {:else if file.lines.length === 0}
      <div class="flex items-center justify-center h-full text-gh-fg-muted dark:text-gh-fg-dark-muted">
        <p>Empty file</p>
      </div>
    {:else}
      <!-- Loading indicator overlay -->
      {#if file.loading}
        <div class="absolute top-2 left-1/2 -translate-x-1/2 z-10 bg-gh-canvas-subtle dark:bg-gh-canvas-dark-subtle rounded-full px-3 py-1 shadow-md flex items-center gap-2">
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
        wordWrap={wrapLines}
        {showMinimap}
        showInvisibleChars={file.showInvisibleChars}
        on:scroll={handleMonacoScroll}
        on:ready={handleMonacoReady}
      />
    {/if}
  </div>
</div>

<style>
  /* Regex filter input styles */
  .regex-input {
    white-space: pre;
    overflow-x: auto;
  }

  .regex-input:empty:before {
    content: attr(data-placeholder);
    color: #9ca3af;
  }

  /* Prism.js regex syntax highlighting */
  :global(.token.char-class) {
    color: #0ea5e9;
  }

  :global(.token.quantifier) {
    color: #f59e0b;
  }

  :global(.token.anchor) {
    color: #8b5cf6;
  }

  :global(.token.group) {
    color: #10b981;
    font-weight: 600;
  }

  :global(.token.alternation) {
    color: #ef4444;
  }

  :global(.token.escape) {
    color: #06b6d4;
  }

  :global(.token.char-set) {
    color: #8b5cf6;
  }

  /* Monaco decorations for trace matches */
  :global(.monaco-match-line) {
    background-color: rgba(255, 200, 100, 0.2) !important;
  }

  :global(.monaco-match-glyph) {
    background-color: #f59e0b;
    width: 4px !important;
    margin-left: 3px;
  }

  /* Monaco decorations for single anomaly highlighting (from popup click) */
  :global(.monaco-anomaly-line) {
    background-color: rgba(239, 68, 68, 0.15) !important;
  }

  :global(.monaco-anomaly-glyph) {
    background-color: #ef4444;
    width: 4px !important;
    margin-left: 3px;
  }

  /* Monaco decorations for category-based anomaly highlighting */
  :global(.monaco-anomaly-category-line) {
    background-color: rgba(107, 114, 128, 0.15) !important; /* default gray */
  }

  :global(.monaco-anomaly-category-glyph) {
    width: 4px !important;
    margin-left: 3px;
  }

  /* Error category - red */
  :global(.monaco-anomaly-error) {
    background-color: rgba(239, 68, 68, 0.15) !important;
  }
  :global(.monaco-anomaly-error-glyph) {
    background-color: #ef4444 !important;
  }

  /* Warning category - amber */
  :global(.monaco-anomaly-warning) {
    background-color: rgba(245, 158, 11, 0.15) !important;
  }
  :global(.monaco-anomaly-warning-glyph) {
    background-color: #f59e0b !important;
  }

  /* Traceback category - dark red */
  :global(.monaco-anomaly-traceback) {
    background-color: rgba(220, 38, 38, 0.15) !important;
  }
  :global(.monaco-anomaly-traceback-glyph) {
    background-color: #dc2626 !important;
  }

  /* Format category - violet */
  :global(.monaco-anomaly-format) {
    background-color: rgba(139, 92, 246, 0.15) !important;
  }
  :global(.monaco-anomaly-format-glyph) {
    background-color: #8b5cf6 !important;
  }

  /* Security category - pink */
  :global(.monaco-anomaly-security) {
    background-color: rgba(236, 72, 153, 0.15) !important;
  }
  :global(.monaco-anomaly-security-glyph) {
    background-color: #ec4899 !important;
  }

  /* Timing category - cyan */
  :global(.monaco-anomaly-timing) {
    background-color: rgba(6, 182, 212, 0.15) !important;
  }
  :global(.monaco-anomaly-timing-glyph) {
    background-color: #06b6d4 !important;
  }

  /* Multiline category - indigo */
  :global(.monaco-anomaly-multiline) {
    background-color: rgba(99, 102, 241, 0.15) !important;
  }
  :global(.monaco-anomaly-multiline-glyph) {
    background-color: #6366f1 !important;
  }

  /* Monaco decorations for regex filter highlight mode */
  :global(.monaco-regex-highlight) {
    background-color: rgba(255, 235, 59, 0.4);
    border-radius: 2px;
  }

  /* Monaco decorations for hidden content markers */
  :global(.monaco-hidden-marker-red) {
    background-color: rgb(239, 68, 68) !important;
    color: transparent !important;
    border-radius: 1px;
    cursor: help;
    display: inline-block;
    width: 4px !important;
    min-width: 4px !important;
    max-width: 4px !important;
  }

  :global(.monaco-hidden-marker-blue) {
    background-color: rgb(59, 130, 246) !important;
    color: transparent !important;
    border-radius: 1px;
    cursor: help;
    display: inline-block;
    width: 4px !important;
    min-width: 4px !important;
    max-width: 4px !important;
  }
</style>
