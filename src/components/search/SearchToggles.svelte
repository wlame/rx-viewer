<script lang="ts">
  import {
    SEARCH_TOGGLES,
    toggleTooltip,
    type SearchToggleSpec,
    type SearchToggles,
  } from '$lib/utils/searchToggles';

  /** The toggle states; the search panel binds to them. */
  export let toggles: SearchToggles;
  export let disabled = false;
  /** Why the backend cannot honor the toggles, shown as their tooltip; null when it can. */
  export let unavailableReason: string | null = null;

  const PRESSED =
    'bg-gh-accent-emphasis dark:bg-gh-accent-dark-emphasis text-white hover:bg-gh-accent-fg dark:hover:bg-gh-accent-dark-fg';
  const RELEASED =
    'bg-gh-canvas-inset dark:bg-gh-canvas-dark-inset text-gh-fg-muted dark:text-gh-fg-dark-muted hover:bg-gh-canvas-subtle dark:hover:bg-gh-canvas-dark-subtle';

  function flip(spec: SearchToggleSpec) {
    toggles = { ...toggles, [spec.key]: !toggles[spec.key] };
  }
</script>

<div class="flex gap-1" role="group" aria-label="Match options">
  {#each SEARCH_TOGGLES as spec (spec.key)}
    <button
      type="button"
      class="w-7 h-6 rounded font-mono text-xs flex-shrink-0 transition-colors
             disabled:opacity-50 disabled:cursor-not-allowed
             {toggles[spec.key] ? PRESSED : RELEASED}"
      aria-label={spec.title}
      aria-pressed={toggles[spec.key]}
      title={unavailableReason ?? toggleTooltip(spec)}
      disabled={disabled || unavailableReason !== null}
      on:click={() => flip(spec)}
    >
      {spec.label}
    </button>
  {/each}
</div>
