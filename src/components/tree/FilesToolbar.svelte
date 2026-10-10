<!--
  The files panel's toolbar: its title, the Group rotated logs and Show
  labels toggles, and the Size/Date switch of the value each row shows.
  Switching the value moves a sort on the other value to this one.
  Alt+G, Alt+L and Alt+V do the same from anywhere while the panel is
  shown and no dialog is open; at any other time the key is left alone.
-->
<script lang="ts">
  import { tooltip } from '$lib/actions/tooltip';
  import { backendHas, health } from '$lib/stores';
  import { chainMode } from '$lib/stores/chainMode';
  import { switchChainMode } from '$lib/stores/chainModeSwitch';
  import { filesPanelShown, filesView, showFilesValue } from '$lib/stores/filesView';
  import { modalOpen } from '$lib/stores/layout';
  import {
    handleFilesPanelKey,
    isShortcut,
    type FilesPanelShortcutActions,
  } from '$lib/utils/shortcuts';
  import { VALUE_COLUMNS, type ValueColumn } from '$lib/utils/urlState';
  import Icon from '../common/Icon.svelte';

  /** The name of each value on its button of the switch. */
  const VALUE_NAMES: Readonly<Record<ValueColumn, string>> = { size: 'Size', date: 'Date' };
  /** How far each arrow key moves the choice through the values, around the ends. */
  const MOVES: readonly { key: string; step: number }[] = [
    { key: 'ArrowLeft', step: -1 },
    { key: 'ArrowRight', step: 1 },
  ];
  const GROUP_DETAIL = 'app.log, app.log.1, app.log.2.gz … as one log chain';
  /** The tooltip of each value's button: the key that switches between them. */
  const VALUE_SWITCH_LABEL = 'Size or date';

  // The syntax-highlighting toggle's look: the accent fill while on, inset while off.
  const ON_CLASS =
    'bg-gh-accent-emphasis dark:bg-gh-accent-dark-emphasis text-white ' +
    'hover:bg-gh-accent-fg dark:hover:bg-gh-accent-dark-fg';
  const OFF_CLASS =
    'bg-gh-canvas-inset dark:bg-gh-canvas-dark-inset text-gh-fg-muted dark:text-gh-fg-dark-muted ' +
    'hover:bg-gh-canvas-subtle dark:hover:bg-gh-canvas-dark-subtle';
  // An outline outside the control, so it shows on the accent fill as well.
  const FOCUS_CLASS =
    'focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 ' +
    'focus-visible:outline-gh-accent-emphasis dark:focus-visible:outline-gh-accent-dark-emphasis';
  const TOGGLE_CLASS = `p-1 rounded flex-shrink-0 transition-colors ${FOCUS_CLASS}`;
  const VALUE_CLASS = `px-1.5 py-0.5 text-xs leading-4 transition-colors first:rounded-l last:rounded-r ${FOCUS_CLASS}`;

  let valueSwitch: HTMLElement;

  // The toggle is offered only by a backend that serves log chains.
  $: canGroupChains = backendHas('log_chains', $health);

  function toggleChainMode(): boolean {
    if (!canGroupChains) return false;
    void switchChainMode(!$chainMode);
    return true;
  }

  function toggleLabels(): boolean {
    filesView.update((view) => ({ ...view, labels: !view.labels }));
    return true;
  }

  /** The value `step` places after `from` in the switch, around the ends. */
  function valueAfter(from: ValueColumn, step: number): ValueColumn {
    const count = VALUE_COLUMNS.length;
    return VALUE_COLUMNS[(VALUE_COLUMNS.indexOf(from) + step + count) % count];
  }

  function switchValue(): boolean {
    showFilesValue(valueAfter($filesView.show, 1));
    return true;
  }

  const actions: FilesPanelShortcutActions = { toggleChainMode, toggleLabels, switchValue };

  // The panel's keys are its own only while it is on screen and no
  // dialog owns the keyboard.
  function handleWindowKeydown(event: KeyboardEvent) {
    if (!$filesPanelShown || $modalOpen) return;
    handleFilesPanelKey(event, actions);
  }

  /**
   * ← and → choose the value before or after the chosen one, and focus
   * its button; while a dialog is open, they are the dialog's.
   */
  function handleValueKeydown(event: KeyboardEvent) {
    if ($modalOpen) return;
    const move = MOVES.find((m) => m.key === event.key && isShortcut('valueSwitchMove', event));
    if (!move) return;
    event.preventDefault();
    const next = valueAfter($filesView.show, move.step);
    showFilesValue(next);
    valueSwitch.querySelector<HTMLElement>(`[data-value="${next}"]`)?.focus();
  }
</script>

<svelte:window on:keydown={handleWindowKeydown} />

<div
  class="flex items-center gap-1.5 px-3 py-2 border-b border-gh-border-default dark:border-gh-border-dark-default"
>
  <h2
    class="flex-1 text-xs font-semibold uppercase tracking-wide text-gh-fg-muted dark:text-gh-fg-dark-muted"
  >
    Files
  </h2>
  {#if canGroupChains}
    <button
      type="button"
      class="{TOGGLE_CLASS} {$chainMode ? ON_CLASS : OFF_CLASS}"
      aria-label="Group rotated logs"
      aria-pressed={$chainMode}
      use:tooltip={{
        label: 'Group rotated logs',
        shortcut: 'toggleChainMode',
        detail: GROUP_DETAIL,
      }}
      on:click={toggleChainMode}
    >
      <Icon name="layers" />
    </button>
  {/if}
  <button
    type="button"
    class="{TOGGLE_CLASS} {$filesView.labels ? ON_CLASS : OFF_CLASS}"
    aria-label="Show labels"
    aria-pressed={$filesView.labels}
    use:tooltip={{ label: 'Show labels', shortcut: 'toggleLabels' }}
    on:click={toggleLabels}
  >
    <Icon name="tag" />
  </button>
  <div
    bind:this={valueSwitch}
    role="radiogroup"
    aria-label="Value shown"
    class="flex flex-shrink-0 rounded border border-gh-border-default dark:border-gh-border-dark-default"
  >
    {#each VALUE_COLUMNS as value (value)}
      {@const isChecked = value === $filesView.show}
      <button
        type="button"
        role="radio"
        aria-checked={isChecked}
        tabindex={isChecked ? 0 : -1}
        data-value={value}
        class="{VALUE_CLASS} {isChecked ? ON_CLASS : OFF_CLASS}"
        use:tooltip={{ label: VALUE_SWITCH_LABEL, shortcut: 'switchValue' }}
        on:click={() => showFilesValue(value)}
        on:keydown={handleValueKeydown}
      >
        {VALUE_NAMES[value]}
      </button>
    {/each}
  </div>
</div>
