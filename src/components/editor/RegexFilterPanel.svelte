<script lang="ts">
  /**
   * The editor's regex filter bar: a syntax-highlighted pattern box, the
   * three filter modes, Apply and Cancel, and the last pattern's error.
   *
   * The pattern and mode are bound by the parent, so they survive the bar
   * closing. Every event carries the values it applies, so a handler
   * never reads a binding that has not reached the parent yet.
   */
  import { createEventDispatcher } from 'svelte';
  import Prism from 'prismjs';
  import 'prismjs/components/prism-regex';

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

  let regexInputEl: HTMLDivElement;

  function apply() {
    dispatch('apply', { pattern, mode });
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      apply();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      dispatch('close');
    }
  }

  function highlightRegexPattern(text: string): string {
    if (!text) return '';
    try {
      return Prism.highlight(text, Prism.languages.regex, 'regex');
    } catch {
      return text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

  function handleInput(e: Event) {
    const target = e.target as HTMLDivElement;
    const text = target.textContent || '';
    if (text === PLACEHOLDER) return;
    pattern = text;

    // Read the caret, rewrite the markup and put the caret back in one
    // synchronous step. Deferring any part of this to an animation frame
    // leaves the caret collapsed at the start of the element until the
    // frame runs, and a keystroke arriving in that window is inserted at
    // the front — which reverses the pattern as it is typed. Highlighting
    // a pattern this short costs far less than a frame, so there is
    // nothing to gain by spreading it over two.
    const cursorPos = getCursorPosition(target);
    const highlighted = highlightRegexPattern(text);
    if (highlighted) {
      target.innerHTML = highlighted;
      setCursorPosition(target, cursorPos);
    }
  }

  // The highlighted box has two writers: handleInput while the user
  // types, which restores the caret after rewriting the markup, and this
  // block when the pattern changes from anywhere else — the bar opening
  // with a stored filter, a selection sent to the filter, or a clear.
  //
  // Assigning innerHTML collapses the selection to the start of the
  // element. Doing that while the box has focus drops the caret in front
  // of the text, so the next character typed lands at the front and the
  // pattern comes out reversed. Sync only when the box is not focused and
  // let the input handler own it while it is.
  $: if (regexInputEl && document.activeElement !== regexInputEl) {
    if (pattern) {
      regexInputEl.innerHTML = highlightRegexPattern(pattern);
    } else {
      regexInputEl.textContent = '';
    }
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
      id="regex-filter-input"
      bind:this={regexInputEl}
      contenteditable="plaintext-only"
      on:input={handleInput}
      on:keydown={handleKeyDown}
      role="textbox"
      tabindex="0"
      aria-label="Regex pattern"
      data-placeholder={PLACEHOLDER}
      class="flex-1 text-base bg-gh-canvas-default dark:bg-gh-canvas-dark-default
             border border-gh-border-default dark:border-gh-border-dark-default
             rounded px-3 py-2 outline-none focus:border-gh-accent-fg dark:focus:border-gh-accent-dark-fg
             font-mono regex-input min-h-[36px]"
    ></div>
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
  .regex-input {
    white-space: pre;
    overflow-x: auto;
  }

  .regex-input:empty:before {
    content: attr(data-placeholder);
    color: #9ca3af;
  }

  /* Prism.js regex syntax highlighting, inside the pattern box. */
  .regex-input :global(.token.char-class) {
    color: #0ea5e9;
  }

  .regex-input :global(.token.quantifier) {
    color: #f59e0b;
  }

  .regex-input :global(.token.anchor) {
    color: #8b5cf6;
  }

  .regex-input :global(.token.group) {
    color: #10b981;
    font-weight: 600;
  }

  .regex-input :global(.token.alternation) {
    color: #ef4444;
  }

  .regex-input :global(.token.escape) {
    color: #06b6d4;
  }

  .regex-input :global(.token.char-set) {
    color: #8b5cf6;
  }
</style>
