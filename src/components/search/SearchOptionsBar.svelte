<!--
  The search options in one line under the patterns, wrapping when the
  panel is narrow: the match toggles, Only opened files with the number
  of opened files, and the most matches to find. Every value is the
  search draft's, so a panel switch keeps it. A max the search cannot
  take shows red with its rule under the line; the search panel refuses
  to run it and calls `refuseMax`.
-->
<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { tooltip } from '$lib/actions/tooltip';
  import { parseMaxResults, searchDraft } from '$lib/stores/searchDraft';
  import { isShortcut } from '$lib/utils/shortcuts';
  import Icon from '../common/Icon.svelte';
  import SearchToggles from './SearchToggles.svelte';

  /** Whether the match toggles are disabled: there is no root to search. */
  export let togglesDisabled = false;
  /** Why the backend cannot honor the match toggles, as their tooltip; null when it can. */
  export let togglesUnavailable: string | null = null;
  /** How many opened files a search of the opened files reads. */
  export let openCount: number;
  /** Whether Only opened files is disabled: it is off and no file is open. */
  export let onlyOpenedDisabled: boolean;

  const dispatch = createEventDispatcher<{ run: null; switchOnlyOpened: null }>();

  const MAX_RULE = 'max: 1 to 10,000';
  const MAX_RULE_ID = 'search-max-rule';
  const MAX_TOOLTIP = 'Stop after this many matches';

  // The look of the Files toolbar's toggles: the accent fill while on.
  const ON_CLASS =
    'bg-gh-accent-emphasis dark:bg-gh-accent-dark-emphasis text-white ' +
    'hover:bg-gh-accent-fg dark:hover:bg-gh-accent-dark-fg';
  const OFF_CLASS =
    'bg-gh-canvas-inset dark:bg-gh-canvas-dark-inset text-gh-fg-muted dark:text-gh-fg-dark-muted ' +
    'hover:bg-gh-canvas-subtle dark:hover:bg-gh-canvas-dark-subtle';
  const ONLY_OPENED_CLASS =
    'h-6 px-1.5 rounded flex items-center gap-1 text-xs flex-shrink-0 transition-colors ' +
    'aria-disabled:opacity-50 aria-disabled:cursor-not-allowed ' +
    'focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 ' +
    'focus-visible:outline-gh-accent-emphasis dark:focus-visible:outline-gh-accent-dark-emphasis';
  const SEPARATOR_CLASS = 'w-px h-4 bg-gh-border-default dark:bg-gh-border-dark-default';
  const MAX_BOX_CLASS = 'input px-1.5 py-0.5 text-xs font-mono';
  // Red also while focused, over the accent border `.input` gives a focused field.
  const INVALID_CLASS =
    'border-gh-danger-emphasis dark:border-gh-danger-dark-emphasis ' +
    'focus:border-gh-danger-emphasis dark:focus:border-gh-danger-dark-emphasis ' +
    'focus:ring-gh-danger-emphasis dark:focus:ring-gh-danger-dark-emphasis';

  let maxBox: HTMLInputElement;
  /** Bumped by each refused run, so the rule is announced again each time. */
  let refusals = 0;

  $: isMaxValid = parseMaxResults($searchDraft.maxResults) !== null;
  $: if (isMaxValid) refusals = 0;
  $: onlyOpenedLabel =
    openCount === 0
      ? 'No file is open'
      : `Search only the ${openCount} opened ${openCount === 1 ? 'file' : 'files'}`;

  /** A run was refused for the max: announce the rule and move the focus to the box. */
  export function refuseMax(): void {
    refusals += 1;
    maxBox.focus();
  }

  function switchOnlyOpened() {
    if (!onlyOpenedDisabled) dispatch('switchOnlyOpened');
  }

  function handleMaxKeydown(event: KeyboardEvent) {
    if (!isShortcut('runSearch', event)) return;
    event.preventDefault();
    dispatch('run');
  }
</script>

<div class="mt-2">
  <div
    class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gh-fg-muted dark:text-gh-fg-dark-muted"
    role="group"
    aria-label="Search options"
  >
    <SearchToggles
      bind:toggles={$searchDraft.toggles}
      disabled={togglesDisabled}
      unavailableReason={togglesUnavailable}
    />
    <span class={SEPARATOR_CLASS} aria-hidden="true" />
    <button
      type="button"
      class="{ONLY_OPENED_CLASS} {$searchDraft.onlyOpenedFiles ? ON_CLASS : OFF_CLASS}"
      aria-label="Search only the opened files"
      aria-pressed={$searchDraft.onlyOpenedFiles}
      aria-disabled={onlyOpenedDisabled}
      use:tooltip={{
        label: onlyOpenedLabel,
        shortcut: onlyOpenedDisabled ? undefined : 'toggleOnlyOpened',
      }}
      on:click={switchOnlyOpened}
    >
      <Icon name="square-stack" size={14} />
      <span>{openCount}</span>
    </button>
    <span class={SEPARATOR_CLASS} aria-hidden="true" />
    <label class="flex items-center gap-1">
      <span>max</span>
      <input
        bind:this={maxBox}
        bind:value={$searchDraft.maxResults}
        type="text"
        inputmode="numeric"
        size="5"
        class="{MAX_BOX_CLASS} {isMaxValid ? '' : INVALID_CLASS}"
        aria-label="Most matches"
        aria-invalid={isMaxValid ? undefined : 'true'}
        aria-describedby={isMaxValid ? undefined : MAX_RULE_ID}
        use:tooltip={{ label: MAX_TOOLTIP, detail: isMaxValid ? undefined : MAX_RULE }}
        on:keydown={handleMaxKeydown}
      />
    </label>
  </div>
  {#if !isMaxValid}
    <!-- Made again on each refused run, so a screen reader reads it again. -->
    {#key refusals}
      <p
        id={MAX_RULE_ID}
        data-max-rule
        role={refusals > 0 ? 'alert' : undefined}
        class="mt-1 text-xs text-gh-danger-fg dark:text-gh-danger-dark-fg"
      >
        {MAX_RULE}
      </p>
    {/key}
  {/if}
</div>
