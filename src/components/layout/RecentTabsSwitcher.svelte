<!--
  The recent-tab switcher (`utils/recentSwitch.ts`). Alt+Q opens it on the
  tab used before the one shown; each further Q while Alt is held goes one
  entry further, Shift+Q one back, and releasing Alt shows the chosen tab.
  Esc closes it without a switch, and so does the window losing the focus
  or the page being hidden, where the release of Alt never arrives.

  It is a modal dialog from the first Alt+Q, so the viewer's other keys
  wait while Alt is held, and its list shows only after a moment: a
  quick Alt+Q switches with nothing drawn. The app draws it over the whole
  page, never inside a panel.
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { modal } from '$lib/actions/modal';
  import { takeFocus } from '$lib/actions/takeFocus';
  import { files } from '$lib/stores';
  import { chainTopLines } from '$lib/stores/chainTopLines';
  import { contractRefused } from '$lib/stores/health';
  import { modalOpen } from '$lib/stores/layout';
  import { focusPlaceOf, returnFocusTo, type FocusPlace } from '$lib/stores/tabFocus';
  import type { OpenFile } from '$lib/types';
  import { chainTabCaption, type ChainTopLine } from '$lib/utils/chainPane';
  import {
    CLOSED_SWITCH,
    RECENT_LIST_DELAY_MS,
    stepRecentSwitch,
    type RecentSwitch,
    type RecentSwitchEvent,
  } from '$lib/utils/recentSwitch';
  import { handleRecentTabsKey, type RecentTabsShortcutActions } from '$lib/utils/shortcuts';
  import type { TabKey } from '$lib/utils/tabKey';

  const OPTION_ID_PREFIX = 'rx-recent-tab-';

  let switcher: RecentSwitch = CLOSED_SWITCH;
  let revealTimer: ReturnType<typeof setTimeout> | null = null;
  /** Where the focus was at the first Alt+Q, before the list took it. */
  let focusOrigin: FocusPlace = 'none';

  /**
   * Apply `event`, show the tab it chose with the focus back in its
   * place, and start or stop the list's delay.
   */
  function apply(event: RecentSwitchEvent) {
    const wasOpen = switcher.isOpen;
    const step = stepRecentSwitch(switcher, event);
    switcher = step.state;
    if (switcher.isOpen && !wasOpen) {
      focusOrigin = focusPlaceOf(document.activeElement);
      revealTimer = setTimeout(() => apply({ kind: 'reveal' }), RECENT_LIST_DELAY_MS);
    }
    if (!switcher.isOpen) stopRevealTimer();
    if (step.activate !== null) {
      files.setActiveFile(step.activate);
      void returnFocusTo(focusOrigin);
    }
  }

  function stopRevealTimer() {
    if (revealTimer !== null) clearTimeout(revealTimer);
    revealTimer = null;
  }

  onDestroy(stopRevealTimer);

  // A tab closed meanwhile (by another action) leaves the list.
  $: apply({ kind: 'tabs', open: $files.openFiles.map((f) => f.path) });

  /**
   * Alt+Q or Alt+Shift+Q: open, or move on. Another dialog keeps the
   * keyboard; the switcher's own dialog does not stop it.
   */
  function press(back: boolean): boolean {
    if (!switcher.isOpen && $modalOpen) return false;
    apply({ kind: 'press', recent: get(files).recentTabs, back });
    return switcher.isOpen;
  }

  const actions: RecentTabsShortcutActions = {
    recentTab: () => press(false),
    recentTabBack: () => press(true),
    closeRecentTabs: () => {
      if (!switcher.isOpen) return false;
      apply({ kind: 'cancel' });
      return true;
    },
  };

  function handleKeydown(event: KeyboardEvent) {
    if (get(contractRefused)) return;
    handleRecentTabsKey(event, actions);
  }

  /**
   * Alt released: the keyup of Alt itself, or of any key once Alt is no
   * longer held. It shows the chosen tab, unless the contract was refused
   * meanwhile.
   */
  function handleKeyup(event: KeyboardEvent) {
    if (!switcher.isOpen || event.altKey) return;
    event.preventDefault();
    apply({ kind: get(contractRefused) ? 'cancel' : 'release' });
  }

  /** A click on an entry of the list shows its tab; the keys stay with the window. */
  function chooseClicked(event: MouseEvent) {
    const option = (event.target as Element | null)?.closest<HTMLElement>('[role="option"]');
    const key = option?.dataset.tabKey;
    if (key !== undefined) apply({ kind: 'choose', key });
  }

  function cancelWhenHidden() {
    if (document.hidden) apply({ kind: 'cancel' });
  }

  function optionId(index: number): string {
    return `${OPTION_ID_PREFIX}${index}`;
  }

  /** The tab's name as the strip shows it: a chain's names the part of its top line. */
  function captionOf(tab: OpenFile, topLines: ReadonlyMap<TabKey, ChainTopLine>): string {
    if (!tab.chain) return tab.name;
    return chainTabCaption(tab.name, tab.chain, topLines.get(tab.path) ?? null).caption;
  }
</script>

<!-- The capture phase runs before the editor and the text fields see the
     key, so Option+Q types no "œ" into them. -->
<svelte:window
  on:keydown|capture={handleKeydown}
  on:keyup|capture={handleKeyup}
  on:blur={() => apply({ kind: 'cancel' })}
/>
<svelte:document on:visibilitychange={cancelWhenHidden} />

{#if switcher.isOpen}
  <div
    class="fixed inset-0 z-50 flex items-start justify-center pt-24 pointer-events-none"
    role="dialog"
    aria-modal="true"
    aria-label="Recently used tabs"
    use:modal
  >
    {#if switcher.isListShown}
      <!-- The keyboard reaches every entry at the window (Q, Shift+Q and
           the release of Alt); a click is the pointer's way to the same. -->
      <!-- svelte-ignore a11y-click-events-have-key-events -->
      <div
        class="pointer-events-auto min-w-[280px] max-w-[min(640px,90vw)] py-1 rounded-lg shadow-lg
               bg-gh-canvas-default dark:bg-gh-canvas-dark-default
               border border-gh-border-default dark:border-gh-border-dark-default
               focus:outline-none"
        role="listbox"
        tabindex="-1"
        aria-label="Recently used tabs"
        aria-activedescendant={optionId(switcher.selected)}
        use:takeFocus
        on:click={chooseClicked}
      >
        {#each switcher.keys as key, index (key)}
          {@const tab = $files.openFiles.find((f) => f.path === key)}
          {#if tab}
            {@const isChosen = index === switcher.selected}
            <div
              id={optionId(index)}
              role="option"
              aria-selected={isChosen}
              data-tab-key={key}
              title={tab.chain?.handle ?? tab.path}
              class="px-3 py-1.5 text-sm truncate cursor-pointer
                     {isChosen
                ? 'bg-gh-accent-emphasis dark:bg-gh-accent-dark-emphasis text-white'
                : 'text-gh-fg-default dark:text-gh-fg-dark-default hover:bg-gh-canvas-subtle dark:hover:bg-gh-canvas-dark-subtle'}"
            >
              {captionOf(tab, $chainTopLines)}
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  </div>
{/if}
