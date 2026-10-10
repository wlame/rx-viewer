<!--
  The activity bar at the window's left edge: a button per panel of the
  side panel, then the keyboard shortcuts button at the bottom. A panel's
  button shows its panel, or hides the side panel when that panel is the
  one shown. The buttons form one toolbar with one Tab stop: the button
  last focused, else the shown panel's; ↓ and ↑ move between them.
-->
<script lang="ts">
  import { tooltip } from '$lib/actions/tooltip';
  import {
    clickPanelButton,
    shortcutsHelpOpen,
    sidebarTab,
    sidebarVisible,
  } from '$lib/stores/layout';
  import { PANELS } from '$lib/utils/panels';
  import { isShortcut } from '$lib/utils/shortcuts';
  import Icon from '../common/Icon.svelte';

  /** How far each arrow key moves the focus through the buttons, around the ends. */
  const MOVES: readonly { key: string; step: number }[] = [
    { key: 'ArrowDown', step: 1 },
    { key: 'ArrowUp', step: -1 },
  ];
  const ICON_SIZE_PX = 20;
  /** The keyboard shortcuts button comes after the panels' buttons. */
  const HELP_INDEX = PANELS.length;

  const BUTTON_CLASS =
    'relative w-10 h-10 flex items-center justify-center ' +
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset ' +
    'focus-visible:ring-gh-accent-emphasis dark:focus-visible:ring-gh-accent-dark-emphasis';
  const PRESSED_CLASS = 'text-gh-fg-default dark:text-gh-fg-dark-default';
  const IDLE_CLASS =
    'text-gh-fg-muted dark:text-gh-fg-dark-muted ' +
    'hover:text-gh-fg-default dark:hover:text-gh-fg-dark-default';

  let toolbar: HTMLElement;
  /** The index of the button focused last, or null while none has been. */
  let focusedIndex: number | null = null;

  $: shownIndex = $sidebarVisible ? PANELS.findIndex((panel) => panel.id === $sidebarTab) : -1;
  $: tabStopIndex = focusedIndex ?? Math.max(shownIndex, 0);

  function handleKeydown(event: KeyboardEvent) {
    const move = MOVES.find((m) => m.key === event.key && isShortcut('activityBarMove', event));
    if (!move) return;
    const buttons = [...toolbar.querySelectorAll<HTMLElement>('button')];
    const at = buttons.indexOf(event.currentTarget as HTMLElement);
    event.preventDefault();
    buttons[(at + move.step + buttons.length) % buttons.length].focus();
  }
</script>

<div
  bind:this={toolbar}
  role="toolbar"
  aria-orientation="vertical"
  aria-label="Panels"
  class="w-10 flex-shrink-0 flex flex-col justify-between
         bg-gh-canvas-subtle dark:bg-gh-canvas-dark-subtle
         border-r border-gh-border-default dark:border-gh-border-dark-default"
>
  <div class="flex flex-col">
    {#each PANELS as panel, index (panel.id)}
      {@const isPressed = index === shownIndex}
      <button
        type="button"
        class="{BUTTON_CLASS} {isPressed ? PRESSED_CLASS : IDLE_CLASS}"
        aria-label={panel.label}
        aria-pressed={isPressed}
        tabindex={index === tabStopIndex ? 0 : -1}
        use:tooltip={{ label: panel.label, shortcut: panel.shortcut, placement: 'right' }}
        on:click={() => clickPanelButton(panel.id)}
        on:focus={() => (focusedIndex = index)}
        on:keydown={handleKeydown}
      >
        {#if isPressed}
          <span
            class="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r
                   bg-gh-accent-emphasis dark:bg-gh-accent-dark-emphasis"
            aria-hidden="true"
          />
        {/if}
        <Icon name={panel.icon} size={ICON_SIZE_PX} />
      </button>
    {/each}
  </div>

  <button
    type="button"
    class="{BUTTON_CLASS} {IDLE_CLASS}"
    aria-label="Keyboard shortcuts"
    tabindex={HELP_INDEX === tabStopIndex ? 0 : -1}
    use:tooltip={{ label: 'Keyboard shortcuts', shortcut: 'showShortcuts', placement: 'right' }}
    on:click={() => shortcutsHelpOpen.set(true)}
    on:focus={() => (focusedIndex = HELP_INDEX)}
    on:keydown={handleKeydown}
  >
    <Icon name="keyboard" size={ICON_SIZE_PX} />
  </button>
</div>
