<script lang="ts">
  /**
   * The editor pane's toolbar: syntax highlighting, word wrap, invisible
   * characters and the regex filter as toggles, the Monaco theme picker,
   * and close. The toggles report clicks and the pane decides what they
   * do; the theme picker writes the setting itself, since that setting
   * belongs to no single file.
   */
  import { createEventDispatcher, onDestroy, onMount } from 'svelte';
  import type { MonacoTheme } from '$lib/types';
  import { MONACO_THEMES } from '$lib/types';
  import { settings } from '$lib/stores';

  export let syntaxHighlighting: boolean;
  export let wordWrap: boolean;
  export let showInvisibleChars: boolean;
  export let filterEnabled: boolean;
  export let monacoTheme: MonacoTheme;

  const dispatch = createEventDispatcher<{
    toggleSyntax: void;
    toggleWordWrap: void;
    toggleInvisible: void;
    toggleFilter: void;
    close: void;
  }>();

  let themeDropdownVisible = false;

  function toggleThemeDropdown() {
    themeDropdownVisible = !themeDropdownVisible;
  }

  function selectTheme(themeId: MonacoTheme) {
    settings.update((s) => ({ ...s, monacoTheme: themeId }));
    themeDropdownVisible = false;
  }

  function handleClickOutsideThemeDropdown(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest('.theme-dropdown-container')) {
      themeDropdownVisible = false;
    }
  }

  onMount(() => {
    document.addEventListener('click', handleClickOutsideThemeDropdown);
  });

  onDestroy(() => {
    document.removeEventListener('click', handleClickOutsideThemeDropdown);
  });
</script>

<div class="flex items-center gap-2">
  <!-- Syntax highlighting toggle -->
  <button
    class="p-1 rounded flex-shrink-0 transition-colors
         {syntaxHighlighting
      ? 'bg-gh-accent-emphasis dark:bg-gh-accent-dark-emphasis text-white hover:bg-gh-accent-fg dark:hover:bg-gh-accent-dark-fg'
      : 'bg-gh-canvas-inset dark:bg-gh-canvas-dark-inset text-gh-fg-muted dark:text-gh-fg-dark-muted hover:bg-gh-canvas-subtle dark:hover:bg-gh-canvas-dark-subtle'}"
    title="{syntaxHighlighting ? 'Disable' : 'Enable'} syntax highlighting"
    on:click={() => dispatch('toggleSyntax')}
  >
    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M16 18L22 12L16 6M8 6L2 12L8 18" />
    </svg>
  </button>

  <!-- Word wrap toggle -->
  <button
    class="p-1 rounded flex-shrink-0 transition-colors
         {wordWrap
      ? 'bg-gh-accent-emphasis dark:bg-gh-accent-dark-emphasis text-white hover:bg-gh-accent-fg dark:hover:bg-gh-accent-dark-fg'
      : 'bg-gh-canvas-inset dark:bg-gh-canvas-dark-inset text-gh-fg-muted dark:text-gh-fg-dark-muted hover:bg-gh-canvas-subtle dark:hover:bg-gh-canvas-dark-subtle'}"
    title="{wordWrap ? 'Disable' : 'Enable'} word wrap"
    on:click={() => dispatch('toggleWordWrap')}
  >
    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path
        d="M3 6h18M3 12h15a3 3 0 110 6h-4m0 0l2-2m-2 2l2 2M3 18h7"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  </button>

  <!-- Invisible characters toggle -->
  <button
    class="p-1 rounded flex-shrink-0 transition-colors
         {showInvisibleChars
      ? 'bg-gh-accent-emphasis dark:bg-gh-accent-dark-emphasis text-white hover:bg-gh-accent-fg dark:hover:bg-gh-accent-dark-fg'
      : 'bg-gh-canvas-inset dark:bg-gh-canvas-dark-inset text-gh-fg-muted dark:text-gh-fg-dark-muted hover:bg-gh-canvas-subtle dark:hover:bg-gh-canvas-dark-subtle'}"
    title="{showInvisibleChars ? 'Hide' : 'Show'} invisible characters"
    on:click={() => dispatch('toggleInvisible')}
  >
    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path
        d="M6 12h.01M12 12h.01M18 12h.01M6 18h.01M12 18h.01M18 18h.01M6 6h.01M12 6h.01M18 6h.01"
        stroke-linecap="round"
      />
    </svg>
  </button>

  <!-- Regex filter toggle -->
  <button
    class="p-1 rounded flex-shrink-0 transition-colors
         {filterEnabled
      ? 'bg-gh-accent-emphasis dark:bg-gh-accent-dark-emphasis text-white hover:bg-gh-accent-fg dark:hover:bg-gh-accent-dark-fg'
      : 'bg-gh-canvas-inset dark:bg-gh-canvas-dark-inset text-gh-fg-muted dark:text-gh-fg-dark-muted hover:bg-gh-canvas-subtle dark:hover:bg-gh-canvas-dark-subtle'}"
    title="Regex filter"
    on:click={() => dispatch('toggleFilter')}
  >
    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path
        d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2.586a1 1 0 01-.293.707l-4.414 4.414a1 1 0 00-.293.707V17l-4 2v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
      />
    </svg>
  </button>

  <!-- Theme selector dropdown -->
  <div class="relative theme-dropdown-container">
    <button
      class="p-1 rounded flex-shrink-0 transition-colors
           {themeDropdownVisible
        ? 'bg-gh-accent-emphasis dark:bg-gh-accent-dark-emphasis text-white'
        : 'bg-gh-canvas-inset dark:bg-gh-canvas-dark-inset text-gh-fg-muted dark:text-gh-fg-dark-muted hover:bg-gh-canvas-subtle dark:hover:bg-gh-canvas-dark-subtle'}"
      title="Editor theme: {MONACO_THEMES.find((t) => t.id === monacoTheme)?.name || 'Default'}"
      on:click={toggleThemeDropdown}
    >
      <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="3" />
        <path
          d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
        />
      </svg>
    </button>

    {#if themeDropdownVisible}
      <div
        class="absolute right-0 top-full mt-1 z-50
                bg-gh-canvas-default dark:bg-gh-canvas-dark-default
                border border-gh-border-default dark:border-gh-border-dark-default
                rounded-md shadow-lg py-1 min-w-[160px]"
      >
        {#each MONACO_THEMES as themeOption}
          <button
            class="w-full px-3 py-1.5 text-left text-sm flex items-center gap-2
                 hover:bg-gh-canvas-subtle dark:hover:bg-gh-canvas-dark-subtle
                 {monacoTheme === themeOption.id
              ? 'text-gh-accent-fg dark:text-gh-accent-dark-fg font-medium'
              : 'text-gh-fg-default dark:text-gh-fg-dark-default'}"
            on:click={() => selectTheme(themeOption.id)}
          >
            <span
              class="w-3 h-3 rounded-full border
                       {themeOption.base === 'vs'
                ? 'bg-white border-gray-300'
                : 'bg-gray-800 border-gray-600'}"
            ></span>
            {themeOption.name}
            {#if monacoTheme === themeOption.id}
              <svg
                class="w-4 h-4 ml-auto"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
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
    on:click={() => dispatch('close')}
  >
    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  </button>
</div>
