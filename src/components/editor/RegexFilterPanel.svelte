<script lang="ts">
  /**
   * The editor's regex filter bar: a syntax-highlighted pattern box, the
   * three filter modes, Apply and Cancel, and the last pattern's error.
   *
   * The pattern and mode are bound by the parent, so they survive the bar
   * closing. Every event carries the values it applies, so a handler
   * never reads a binding that has not reached the parent yet.
   *
   * The pattern box is a plain text input whose own text is transparent,
   * laid over a copy of the pattern that Prism colours. The input keeps
   * the value, caret, selection, undo and input-method composition; the
   * copy behind it only paints, built from text nodes, and follows the
   * input's horizontal scroll.
   */
  import { createEventDispatcher } from 'svelte';
  import { firstLine, regexHighlightPieces } from '$lib/utils/patternBox';
  import { isShortcut } from '$lib/utils/shortcuts';

  type FilterMode = 'hide' | 'show' | 'highlight';

  export let pattern = '';
  export let mode: FilterMode = 'highlight';
  /** The error the applied pattern produced, shown under the bar. */
  export let error: string | null = null;

  const dispatch = createEventDispatcher<{
    apply: { pattern: string; mode: FilterMode };
    cancel: void;
    close: void;
  }>();

  const PLACEHOLDER = 'e.g. (\\w+)@(\\w+)\\.com';

  /** How far the input has scrolled its text to the left, in pixels. */
  let scrollLeft = 0;

  $: pieces = regexHighlightPieces(pattern);

  function apply() {
    dispatch('apply', { pattern, mode });
  }

  // While an input method composes, Enter and Escape end or cancel the
  // composition; the shortcut table gives them to the filter only once
  // it is over.
  function handleKeyDown(e: KeyboardEvent) {
    if (isShortcut('applyFilter', e)) {
      e.preventDefault();
      apply();
    } else if (isShortcut('closeFilter', e)) {
      e.preventDefault();
      dispatch('close');
    }
  }

  // A pattern is one line. A text input would join a pasted text's lines
  // into one; the box keeps the first line instead and leaves a one-line
  // paste to the browser.
  function handlePaste(e: ClipboardEvent & { currentTarget: HTMLInputElement }) {
    const text = e.clipboardData?.getData('text/plain') ?? '';
    const line = firstLine(text);
    if (line === text) return;
    e.preventDefault();
    insertAtCaret(e.currentTarget, line);
  }

  /**
   * Replace the input's selection with `text`. The browser's insertText
   * command puts the change on the input's undo stack and reports it as
   * typing; where it is missing, setRangeText makes the same change
   * without an undo step.
   */
  function insertAtCaret(input: HTMLInputElement, text: string) {
    if (
      typeof document.execCommand === 'function' &&
      document.execCommand('insertText', false, text)
    ) {
      return;
    }
    const end = input.value.length;
    input.setRangeText(text, input.selectionStart ?? end, input.selectionEnd ?? end, 'end');
    pattern = input.value;
  }

  function followScroll(e: Event & { currentTarget: HTMLInputElement }) {
    scrollLeft = e.currentTarget.scrollLeft;
  }
</script>

<div
  class="px-3 py-3 bg-gh-canvas-subtle dark:bg-gh-canvas-dark-subtle border-b border-gh-border-default dark:border-gh-border-dark-default"
>
  <div class="flex items-center gap-3 mb-3">
    <label
      for="regex-filter-input"
      class="text-sm font-medium text-gh-fg-muted dark:text-gh-fg-dark-muted"
    >
      Regex:
    </label>
    <div
      class="relative flex-1 min-w-0 text-base font-mono
             bg-gh-canvas-default dark:bg-gh-canvas-dark-default
             border border-gh-border-default dark:border-gh-border-dark-default rounded
             focus-within:border-gh-accent-fg dark:focus-within:border-gh-accent-dark-fg"
    >
      <pre aria-hidden="true" class="pattern-overlay"><span class="pattern-overlay-clip"
          ><span
            data-overlay-text
            class="pattern-overlay-text"
            style:transform="translateX(-{scrollLeft}px)"
            >{#each pieces as piece, i (i)}<span class={piece.className}>{piece.text}</span
              >{/each}</span
          ></span
        ></pre>
      <input
        id="regex-filter-input"
        type="text"
        bind:value={pattern}
        on:keydown={handleKeyDown}
        on:paste={handlePaste}
        on:scroll={followScroll}
        on:input={followScroll}
        on:keyup={followScroll}
        on:select={followScroll}
        aria-label="Regex pattern"
        placeholder={PLACEHOLDER}
        spellcheck="false"
        autocomplete="off"
        autocapitalize="off"
        class="pattern-input caret-gh-fg-default dark:caret-gh-fg-dark-default"
      />
    </div>
    <button
      on:click={apply}
      class="px-4 py-1.5 text-sm font-medium rounded
             bg-gh-accent-emphasis dark:bg-gh-accent-dark-emphasis text-white
             hover:bg-gh-accent-fg dark:hover:bg-gh-accent-dark-fg"
    >
      Apply
    </button>
    <button
      on:click={() => dispatch('cancel')}
      class="px-4 py-1.5 text-sm font-medium rounded
             bg-gh-canvas-inset dark:bg-gh-canvas-dark-inset
             text-gh-fg-muted dark:text-gh-fg-dark-muted
             hover:bg-gh-canvas-subtle dark:hover:bg-gh-canvas-dark-subtle"
    >
      Cancel
    </button>
  </div>

  <div class="flex items-center gap-4">
    <span class="text-sm font-medium text-gh-fg-muted dark:text-gh-fg-dark-muted"> Mode: </span>
    <label class="flex items-center gap-1.5 text-sm cursor-pointer">
      <input
        type="radio"
        bind:group={mode}
        value="hide"
        on:change={apply}
        class="cursor-pointer w-4 h-4"
      />
      <span>Hide groups</span>
    </label>
    <label class="flex items-center gap-1.5 text-sm cursor-pointer">
      <input
        type="radio"
        bind:group={mode}
        value="show"
        on:change={apply}
        class="cursor-pointer w-4 h-4"
      />
      <span>Show only</span>
    </label>
    <label class="flex items-center gap-1.5 text-sm cursor-pointer">
      <input
        type="radio"
        bind:group={mode}
        value="highlight"
        on:change={apply}
        class="cursor-pointer w-4 h-4"
      />
      <span>Highlight</span>
    </label>
  </div>

  {#if error}
    <div class="mt-2 text-sm text-gh-danger-fg dark:text-gh-danger-dark-fg">
      {error}
    </div>
  {/if}
</div>

<style>
  /* The input and the coloured copy behind it share font, padding and
     line height, so each character of the copy sits under the same
     character of the input. */
  .pattern-input,
  .pattern-overlay {
    box-sizing: border-box;
    margin: 0;
    padding: 0.5rem 0.75rem;
    font: inherit;
    letter-spacing: inherit;
    line-height: 1.5rem;
    white-space: pre;
  }

  .pattern-input {
    position: relative;
    display: block;
    width: 100%;
    border: 0;
    outline: none;
    background: transparent;
    color: transparent;
  }

  .pattern-input::placeholder {
    color: #9ca3af;
    opacity: 1;
  }

  /* A see-through selection, so the coloured copy shows under it. */
  .pattern-input::selection {
    background-color: rgba(84, 174, 255, 0.35);
  }

  .pattern-overlay {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }

  /* Clips the copy at the padding, as the input clips its own text. */
  .pattern-overlay-clip {
    display: block;
    overflow: hidden;
  }

  .pattern-overlay-text {
    display: inline-block;
  }

  /* Prism's regex tokens. A token inside a character class carries the
     class's classes before its own, so the inner types (escape, char-set)
     are listed after the outer one and win. No rule changes a glyph's
     width, which would move the copy away from the caret. */
  .pattern-overlay :global(.token.char-class) {
    color: #0ea5e9;
  }

  .pattern-overlay :global(.token.quantifier) {
    color: #f59e0b;
  }

  .pattern-overlay :global(.token.anchor) {
    color: #8b5cf6;
  }

  .pattern-overlay :global(.token.group) {
    color: #10b981;
  }

  .pattern-overlay :global(.token.alternation) {
    color: #ef4444;
  }

  .pattern-overlay :global(.token.escape) {
    color: #06b6d4;
  }

  .pattern-overlay :global(.token.char-set) {
    color: #8b5cf6;
  }
</style>
