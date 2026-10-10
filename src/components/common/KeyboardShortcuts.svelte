<script lang="ts">
  import { get } from 'svelte/store';
  import { shortcutsHelpOpen, showPanel, toggleSidebar, type SidebarTab } from '$lib/stores/layout';
  import { contractRefused } from '$lib/stores/health';
  import {
    handleGlobalKey,
    isShortcut,
    shortcutLabel,
    shortcutsByScope,
    type GlobalShortcutActions,
  } from '$lib/utils/shortcuts';

  const groups = shortcutsByScope();

  /**
   * Show a panel and move the focus into it. Not while this help covers
   * the window: the key is then left to the browser.
   */
  function showPanelByKey(id: SidebarTab): boolean {
    if ($shortcutsHelpOpen) return false;
    showPanel(id, true);
    return true;
  }

  const actions: GlobalShortcutActions = {
    focusSearch: () => {
      shortcutsHelpOpen.set(false);
      showPanel('search', true);
      return true;
    },
    showFiles: () => showPanelByKey('tree'),
    showSearch: () => showPanelByKey('search'),
    toggleSidebar: () => {
      toggleSidebar();
      return true;
    },
    showShortcuts: () => {
      shortcutsHelpOpen.update((open) => !open);
      return true;
    },
    closeDialog: () => {
      if (!$shortcutsHelpOpen) return false;
      shortcutsHelpOpen.set(false);
      return true;
    },
  };

  // Under the cover of a refused contract the app is blocked; its
  // shortcuts would act on panels the user cannot see or reach.
  function handleKeydown(event: KeyboardEvent) {
    if (get(contractRefused)) return;
    handleGlobalKey(event, actions);
  }
</script>

<!-- The capture phase runs before the editor sees the key: Monaco binds
     Cmd/Ctrl+K and Cmd/Ctrl+/ itself and would stop them otherwise. -->
<svelte:window on:keydown|capture={handleKeydown} />

<!-- Help dialog -->
{#if $shortcutsHelpOpen}
  <div
    class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
    role="button"
    tabindex="-1"
    aria-label="Close dialog"
    on:click={() => shortcutsHelpOpen.set(false)}
    on:keydown={(e) => isShortcut('closeDialog', e) && shortcutsHelpOpen.set(false)}
  >
    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <div
      class="bg-gh-canvas-default dark:bg-gh-canvas-dark-default
             border border-gh-border-default dark:border-gh-border-dark-default
             rounded-lg shadow-lg p-6 max-w-lg w-full max-h-[85vh] overflow-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-title"
      on:click|stopPropagation
      on:keydown|stopPropagation
    >
      <h2 id="shortcuts-title" class="text-lg font-semibold mb-4">Keyboard Shortcuts</h2>

      {#each groups as group (group.scope)}
        <h3
          class="text-xs font-semibold uppercase tracking-wide mt-4 mb-2
                 text-gh-fg-subtle dark:text-gh-fg-dark-subtle"
        >
          {group.title}
        </h3>
        <dl class="space-y-2 text-sm">
          {#each group.shortcuts as shortcut (shortcut.id)}
            <div class="flex justify-between gap-4">
              <dt class="text-gh-fg-muted dark:text-gh-fg-dark-muted">{shortcut.description}</dt>
              <dd class="flex-shrink-0">
                <kbd
                  class="px-2 py-1 bg-gh-canvas-subtle dark:bg-gh-canvas-dark-subtle
                         border border-gh-border-default dark:border-gh-border-dark-default
                         rounded text-xs whitespace-nowrap"
                >
                  {shortcutLabel(shortcut)}
                </kbd>
              </dd>
            </div>
          {/each}
        </dl>
      {/each}

      <button class="btn btn-primary w-full mt-4" on:click={() => shortcutsHelpOpen.set(false)}>
        Close
      </button>
    </div>
  </div>
{/if}
