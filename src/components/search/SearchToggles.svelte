<script lang="ts">
  /**
   * The match toggles. Each has the shared tooltip: its name, its key and
   * the ripgrep flag its state sends. A toggle that cannot act stays in
   * the Tab order (`aria-disabled`), so its tooltip still says why, and a
   * click does nothing: on a backend that takes no match options the
   * tooltip names that reason, and without a root to search it names no
   * key, since the key does nothing then either.
   */
  import { tooltip, type TooltipParams } from '$lib/actions/tooltip';
  import {
    SEARCH_TOGGLES,
    toggleFlagLine,
    type SearchToggleSpec,
    type SearchToggles,
  } from '$lib/utils/searchToggles';

  /** The toggle states; the search panel binds to them. */
  export let toggles: SearchToggles;
  /** Whether the toggles cannot act: there is no root to search. */
  export let disabled = false;
  /** Why the backend cannot honor the toggles, shown as their tooltip; null when it can. */
  export let unavailableReason: string | null = null;

  const PRESSED =
    'bg-gh-accent-emphasis dark:bg-gh-accent-dark-emphasis text-white hover:bg-gh-accent-fg dark:hover:bg-gh-accent-dark-fg';
  const RELEASED =
    'bg-gh-canvas-inset dark:bg-gh-canvas-dark-inset text-gh-fg-muted dark:text-gh-fg-dark-muted hover:bg-gh-canvas-subtle dark:hover:bg-gh-canvas-dark-subtle';

  $: canAct = !disabled && unavailableReason === null;

  function flip(spec: SearchToggleSpec) {
    if (!canAct) return;
    toggles = { ...toggles, [spec.key]: !toggles[spec.key] };
  }

  /** The tooltip of `spec`: the reason it cannot act, else its name, key and flag line. */
  function tooltipOf(
    spec: SearchToggleSpec,
    reason: string | null,
    isActive: boolean,
  ): TooltipParams {
    if (reason !== null) return { label: reason };
    return {
      label: spec.title,
      shortcut: isActive ? `toggle:${spec.key}` : undefined,
      detail: toggleFlagLine(spec),
    };
  }
</script>

<div class="flex gap-1" role="group" aria-label="Match options">
  {#each SEARCH_TOGGLES as spec (spec.key)}
    <button
      type="button"
      class="w-7 h-6 rounded font-mono text-xs flex-shrink-0 transition-colors
             aria-disabled:opacity-50 aria-disabled:cursor-not-allowed
             {toggles[spec.key] ? PRESSED : RELEASED}"
      aria-label={spec.title}
      aria-pressed={toggles[spec.key]}
      aria-disabled={!canAct}
      use:tooltip={tooltipOf(spec, unavailableReason, canAct)}
      on:click={() => flip(spec)}
    >
      {spec.label}
    </button>
  {/each}
</div>
