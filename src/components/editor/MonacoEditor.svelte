<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import * as monaco from 'monaco-editor';
  import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
  import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
  import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
  import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
  import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
  import type { MonacoTheme } from '$lib/types';
  import {
    registerLogLanguage,
    getLogLanguageThemeRules,
    getLogLanguageThemeRulesDark,
  } from '$lib/utils/monacoLogLanguage';
  import { editorLineAfterMove } from '$lib/utils/slidingWindow';

  // Props
  export let content: string = '';
  export let language: string = 'plaintext';
  export let readonly: boolean = true;
  export let theme: 'light' | 'dark' = 'light';
  export let monacoTheme: MonacoTheme = 'vs';
  export let lineNumbersStart: number = 1;
  export let wordWrap: boolean = false;
  export let showInvisibleChars: boolean = false;

  const dispatch = createEventDispatcher<{
    scroll: { scrollTop: number; scrollHeight: number; clientHeight: number };
    ready: { editor: monaco.editor.IStandaloneCodeEditor };
  }>();

  let containerEl: HTMLDivElement;
  let editor: monaco.editor.IStandaloneCodeEditor | null = null;
  let model: monaco.editor.ITextModel | null = null;

  // Initialize Monaco workers
  self.MonacoEnvironment = {
    getWorker(_: unknown, label: string) {
      if (label === 'json') {
        return new jsonWorker();
      }
      if (label === 'css' || label === 'scss' || label === 'less') {
        return new cssWorker();
      }
      if (label === 'html' || label === 'handlebars' || label === 'razor') {
        return new htmlWorker();
      }
      if (label === 'typescript' || label === 'javascript') {
        return new tsWorker();
      }
      return new editorWorker();
    },
  };

  // Register custom themes
  let themesRegistered = false;
  function registerCustomThemes() {
    if (themesRegistered) return;
    themesRegistered = true;

    // Register the custom log language first
    registerLogLanguage();

    // Get log language theme rules
    const logRulesLight = getLogLanguageThemeRules();
    const logRulesDark = getLogLanguageThemeRulesDark();

    // GitHub Light theme
    monaco.editor.defineTheme('github-light', {
      base: 'vs',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '6a737d', fontStyle: 'italic' },
        { token: 'keyword', foreground: 'd73a49' },
        { token: 'string', foreground: '032f62' },
        { token: 'number', foreground: '005cc5' },
        { token: 'type', foreground: '6f42c1' },
        { token: 'class', foreground: '6f42c1' },
        { token: 'function', foreground: '6f42c1' },
        { token: 'variable', foreground: 'e36209' },
        { token: 'constant', foreground: '005cc5' },
        { token: 'parameter', foreground: '24292e' },
        { token: 'builtin', foreground: '005cc5' },
        { token: 'operator', foreground: 'd73a49' },
        ...logRulesLight,
      ],
      colors: {
        'editor.background': '#ffffff',
        'editor.foreground': '#24292e',
        'editor.lineHighlightBackground': '#f6f8fa',
        'editorLineNumber.foreground': '#1b1f234d',
        'editorLineNumber.activeForeground': '#24292e',
        'editor.selectionBackground': '#0366d625',
        'editor.inactiveSelectionBackground': '#0366d611',
      },
    });

    // GitHub Dark theme
    monaco.editor.defineTheme('github-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '8b949e', fontStyle: 'italic' },
        { token: 'keyword', foreground: 'ff7b72' },
        { token: 'string', foreground: 'a5d6ff' },
        { token: 'number', foreground: '79c0ff' },
        { token: 'type', foreground: 'd2a8ff' },
        { token: 'class', foreground: 'd2a8ff' },
        { token: 'function', foreground: 'd2a8ff' },
        { token: 'variable', foreground: 'ffa657' },
        { token: 'constant', foreground: '79c0ff' },
        { token: 'parameter', foreground: 'c9d1d9' },
        { token: 'builtin', foreground: '79c0ff' },
        { token: 'operator', foreground: 'ff7b72' },
        ...logRulesDark,
      ],
      colors: {
        'editor.background': '#0d1117',
        'editor.foreground': '#c9d1d9',
        'editor.lineHighlightBackground': '#161b22',
        'editorLineNumber.foreground': '#8b949e',
        'editorLineNumber.activeForeground': '#c9d1d9',
        'editor.selectionBackground': '#388bfd66',
        'editor.inactiveSelectionBackground': '#388bfd33',
      },
    });

    // Monokai theme
    monaco.editor.defineTheme('monokai', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '75715e', fontStyle: 'italic' },
        { token: 'keyword', foreground: 'f92672' },
        { token: 'string', foreground: 'e6db74' },
        { token: 'number', foreground: 'ae81ff' },
        { token: 'type', foreground: '66d9ef', fontStyle: 'italic' },
        { token: 'class', foreground: 'a6e22e' },
        { token: 'function', foreground: 'a6e22e' },
        { token: 'variable', foreground: 'f8f8f2' },
        { token: 'constant', foreground: 'ae81ff' },
        { token: 'parameter', foreground: 'fd971f', fontStyle: 'italic' },
        { token: 'builtin', foreground: '66d9ef' },
        { token: 'operator', foreground: 'f92672' },
        ...logRulesDark,
      ],
      colors: {
        'editor.background': '#272822',
        'editor.foreground': '#f8f8f2',
        'editor.lineHighlightBackground': '#3e3d32',
        'editorLineNumber.foreground': '#75715e',
        'editorLineNumber.activeForeground': '#f8f8f2',
        'editor.selectionBackground': '#49483e',
        'editor.inactiveSelectionBackground': '#49483e99',
      },
    });

    // Solarized Light theme
    monaco.editor.defineTheme('solarized-light', {
      base: 'vs',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '93a1a1', fontStyle: 'italic' },
        { token: 'keyword', foreground: '859900' },
        { token: 'string', foreground: '2aa198' },
        { token: 'number', foreground: 'd33682' },
        { token: 'type', foreground: 'b58900' },
        { token: 'class', foreground: 'b58900' },
        { token: 'function', foreground: '268bd2' },
        { token: 'variable', foreground: '268bd2' },
        { token: 'constant', foreground: 'cb4b16' },
        { token: 'parameter', foreground: '657b83' },
        { token: 'builtin', foreground: '6c71c4' },
        { token: 'operator', foreground: '859900' },
        ...logRulesLight,
      ],
      colors: {
        'editor.background': '#fdf6e3',
        'editor.foreground': '#657b83',
        'editor.lineHighlightBackground': '#eee8d5',
        'editorLineNumber.foreground': '#93a1a1',
        'editorLineNumber.activeForeground': '#586e75',
        'editor.selectionBackground': '#eee8d5',
        'editor.inactiveSelectionBackground': '#eee8d599',
      },
    });

    // Solarized Dark theme
    monaco.editor.defineTheme('solarized-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '586e75', fontStyle: 'italic' },
        { token: 'keyword', foreground: '859900' },
        { token: 'string', foreground: '2aa198' },
        { token: 'number', foreground: 'd33682' },
        { token: 'type', foreground: 'b58900' },
        { token: 'class', foreground: 'b58900' },
        { token: 'function', foreground: '268bd2' },
        { token: 'variable', foreground: '268bd2' },
        { token: 'constant', foreground: 'cb4b16' },
        { token: 'parameter', foreground: '839496' },
        { token: 'builtin', foreground: '6c71c4' },
        { token: 'operator', foreground: '859900' },
        ...logRulesDark,
      ],
      colors: {
        'editor.background': '#002b36',
        'editor.foreground': '#839496',
        'editor.lineHighlightBackground': '#073642',
        'editorLineNumber.foreground': '#586e75',
        'editorLineNumber.activeForeground': '#93a1a1',
        'editor.selectionBackground': '#073642',
        'editor.inactiveSelectionBackground': '#07364299',
      },
    });
  }

  // Compute effective theme based on monacoTheme prop and system theme
  // If monacoTheme is 'vs' or 'vs-dark', follow the system/resolved theme
  // Otherwise use the selected custom theme
  $: effectiveTheme = (() => {
    if (monacoTheme === 'vs' || monacoTheme === 'vs-dark') {
      return theme === 'dark' ? 'vs-dark' : 'vs';
    }
    return monacoTheme;
  })();

  // Custom line numbers function - maps Monaco line 1 to lineNumbersStart
  function getLineNumber(lineNumber: number): string {
    return (lineNumber + lineNumbersStart - 1).toString();
  }

  onMount(() => {
    // Register custom themes before creating editor
    registerCustomThemes();

    // Create the editor
    editor = monaco.editor.create(containerEl, {
      value: content,
      language,
      theme: effectiveTheme,
      readOnly: readonly,
      fontSize: 13,
      // Reads lineNumbersStart when Monaco draws, so a new window renumbers itself.
      lineNumbers: getLineNumber,
      minimap: { enabled: true },
      wordWrap: wordWrap ? 'on' : 'off',
      scrollBeyondLastLine: false,
      automaticLayout: true,
      renderWhitespace: showInvisibleChars ? 'all' : 'none',
      renderControlCharacters: showInvisibleChars,
      // Disable features we don't need for a viewer
      folding: true,
      glyphMargin: true,
      lineDecorationsWidth: 5,
      lineNumbersMinChars: 10,
      // Smooth scrolling
      smoothScrolling: true,
      // Cursor settings for readonly
      cursorStyle: 'line',
      cursorBlinking: 'solid',
      // Enable bracket colorization only when syntax highlighting is on.
      // Monaco's typings take this nested; the flat
      // 'bracketPairColorization.enabled' key is silently ignored.
      bracketPairColorization: { enabled: language !== 'plaintext' },
      // Match brackets only when syntax highlighting is on
      matchBrackets: language !== 'plaintext' ? 'always' : 'never',
      // Disable unicode highlighting (prevents orange border on our marker characters)
      unicodeHighlight: {
        ambiguousCharacters: false,
        invisibleCharacters: false,
        nonBasicASCII: false,
      },
    });

    model = editor.getModel();

    // Listen for scroll events
    editor.onDidScrollChange((e) => {
      if (e.scrollTopChanged || e.scrollHeightChanged) {
        dispatch('scroll', {
          scrollTop: e.scrollTop,
          scrollHeight: e.scrollHeight,
          clientHeight: containerEl.clientHeight,
        });
      }
    });

    // Ready once the content is in, so a view the listener sets up (a
    // restored scroll) is not reset by setting the content afterwards.
    dispatch('ready', { editor });
  });

  onDestroy(() => {
    if (editor) {
      editor.dispose();
      editor = null;
    }
    if (model) {
      model.dispose();
      model = null;
    }
  });

  // The file line the editor's line 1 showed before the last content change.
  let previousLineNumbersStart = lineNumbersStart;

  /**
   * Set new content without moving what is on screen.
   *
   * A page added at the start of the window, or lines dropped there,
   * renumbers every editor line. The file line at the top of the view
   * stays at the same height, measured with Monaco's own line positions
   * so wrapped lines count right. When the new window does not hold that
   * line (a jump elsewhere in the file), the scroll offset is kept and
   * the jump reveals its target.
   */
  function updateEditorContent(newContent: string) {
    if (!editor) return;

    const currentValue = editor.getValue();
    if (currentValue === newContent) return;

    const scrollTop = editor.getScrollTop();
    const scrollLeft = editor.getScrollLeft();
    const topLine = editor.getVisibleRanges()[0]?.startLineNumber ?? null;
    const offsetInTopLine = topLine === null ? 0 : scrollTop - editor.getTopForLineNumber(topLine);

    editor.setValue(newContent);

    const lineCount = editor.getModel()?.getLineCount() ?? 0;
    const keptLine =
      topLine === null
        ? null
        : editorLineAfterMove(topLine, previousLineNumbersStart, {
            startLine: lineNumbersStart,
            lineCount,
          });
    editor.setScrollTop(
      keptLine === null ? scrollTop : editor.getTopForLineNumber(keptLine) + offsetInTopLine,
    );
    editor.setScrollLeft(scrollLeft);

    previousLineNumbersStart = lineNumbersStart;
  }

  // Reactive statement that triggers on content changes
  $: updateEditorContent(content);

  // Update theme when it changes
  $: if (editor) {
    monaco.editor.setTheme(effectiveTheme);
  }

  // Update word wrap when it changes
  $: if (editor) {
    editor.updateOptions({ wordWrap: wordWrap ? 'on' : 'off' });
  }

  // Update invisible characters when it changes
  $: if (editor) {
    editor.updateOptions({
      renderWhitespace: showInvisibleChars ? 'all' : 'none',
      renderControlCharacters: showInvisibleChars,
    });
  }

  // Update language when it changes
  $: if (editor && model) {
    monaco.editor.setModelLanguage(model, language);
    // Update bracket colorization and matching based on language
    editor.updateOptions({
      bracketPairColorization: { enabled: language !== 'plaintext' },
      matchBrackets: language !== 'plaintext' ? 'always' : 'never',
    });
  }

  /** Show a file line in the center of the view at once, without the smooth scroll. */
  export function revealLineAtOnce(lineNumber: number) {
    // Monaco counts from 1 at the first loaded line.
    const monacoLine = lineNumber - lineNumbersStart + 1;
    editor?.revealLineInCenter(monacoLine, monaco.editor.ScrollType.Immediate);
  }

  /** Put the view back where it was: both scroll offsets, at once. */
  export function restoreScroll(scrollTop: number, scrollLeft: number) {
    editor?.setScrollPosition({ scrollTop, scrollLeft }, monaco.editor.ScrollType.Immediate);
  }
</script>

<div bind:this={containerEl} class="monaco-container"></div>

<style>
  .monaco-container {
    width: 100%;
    height: 100%;
  }
</style>
