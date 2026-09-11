<script lang="ts">
  /**
   * The editor header's anomaly chips: one per category the file has
   * anomalies in, with the count, and next/previous arrows on the
   * selected one.
   *
   * A plain click toggles a category. Cmd or Alt on the selected chip
   * steps to the next anomaly of it, and Shift with them to the
   * previous one. The pane does the stepping, since it owns the view.
   */
  import { createEventDispatcher } from 'svelte';
  import { CATEGORY_ICONS } from '$lib/stores';

  /** Anomaly count per category, or null when the file was not analyzed. */
  export let summary: Record<string, number> | null;
  /** The category whose anomalies are highlighted, if any. */
  export let selectedCategory: string | null;

  const dispatch = createEventDispatcher<{
    toggle: { category: string };
    navigate: { category: string; direction: 'next' | 'previous' };
  }>();

  /** A symbol per category, so chips differ by more than color. */
  const CATEGORY_SYMBOLS: Record<string, string> = {
    error: '\u2716', // ✖ Heavy multiplication X
    warning: '\u26A0', // ⚠ Warning sign
    traceback: '\u2261', // ≡ Identical to (stack symbol)
    format: '\u00B6', // ¶ Pilcrow sign
    security: '\u2622', // ☢ Radioactive
    timing: '\u23F1', // ⏱ Stopwatch
    multiline: '\u2630', // ☰ Trigram for heaven (hamburger menu)
  };

  function getCategorySymbol(category: string): string {
    return CATEGORY_SYMBOLS[category] || '\u2022'; // • Bullet as fallback
  }

  function handleChipClick(e: MouseEvent, category: string) {
    const isNavModifier = e.metaKey || e.altKey; // Cmd or Alt/Option
    if (selectedCategory === category && isNavModifier) {
      dispatch('navigate', { category, direction: e.shiftKey ? 'previous' : 'next' });
    } else {
      dispatch('toggle', { category });
    }
  }
</script>

<!-- Anomaly category toggles (only shown if file has anomalies) -->
{#if summary && Object.keys(summary).length > 0}
  {#each Object.entries(summary) as [category, count] (category)}
    {@const categoryInfo = CATEGORY_ICONS[category] || {
      icon: '?',
      color: '#6b7280',
      label: category,
    }}
    {@const isActive = selectedCategory === category}
    <button
      class="px-1.5 py-0.5 rounded flex-shrink-0 transition-colors text-xs font-medium flex items-center gap-1"
      style={isActive
        ? `background-color: ${categoryInfo.color}; color: white;`
        : `background-color: transparent; color: ${categoryInfo.color}; border: 1px solid ${categoryInfo.color};`}
      title="{categoryInfo.label}: {count} anomal{count === 1 ? 'y' : 'ies'}"
      on:click={(e) => handleChipClick(e, category)}
    >
      <span class="anomaly-icon" style="font-size: 10px;">{getCategorySymbol(category)}</span>
      <span>{count}</span>
    </button>
    {#if isActive}
      <div class="flex flex-col gap-0 flex-shrink-0">
        <button
          class="px-0.5 rounded-t flex-shrink-0 transition-colors hover:opacity-80"
          style="background-color: {categoryInfo.color}; color: white; line-height: 0;"
          title="Previous {categoryInfo.label.toLowerCase()}"
          on:click={() => dispatch('navigate', { category, direction: 'previous' })}
        >
          <svg class="w-2.5 h-2" viewBox="0 0 10 8" fill="currentColor">
            <path d="M5 1L1 7h8L5 1z" />
          </svg>
        </button>
        <button
          class="px-0.5 rounded-b flex-shrink-0 transition-colors hover:opacity-80"
          style="background-color: {categoryInfo.color}; color: white; line-height: 0;"
          title="Next {categoryInfo.label.toLowerCase()}"
          on:click={() => dispatch('navigate', { category, direction: 'next' })}
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
