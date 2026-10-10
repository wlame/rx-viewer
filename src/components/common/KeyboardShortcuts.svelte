<script lang="ts">
  import { get } from 'svelte/store';
  import { modal } from '$lib/actions/modal';
  import { takeFocus } from '$lib/actions/takeFocus';
  import { files } from '$lib/stores';
  import { activeOpenFile } from '$lib/stores/files';
  import { modalOpen, shortcutsHelpOpen, showPanel, toggleSidebar } from '$lib/stores/layout';
  import { contractRefused } from '$lib/stores/health';
  import {
    handleFileTabsKey,
    handleGlobalKey,
    isShortcut,
    shortcutLabel,
    shortcutsByScope,
    type FileTabsShortcutActions,
    type GlobalShortcutActions,
  } from '$lib/utils/shortcuts';
  import { tabBeside } from '$lib/utils/tabOrder';

  const groups = shortcutsByScope();

  /**
   * An action that acts only while no modal dialog is open. A key that
   * would show a panel behind the dialog, move the focus out of it or
   * hide it is left to the dialog and the browser instead.
   */
  function unlessModalOpen(act: () => void): () => boolean {
    return () => {
      if ($modalOpen) return false;
      act();
      return true;
    };
  }

  const actions: GlobalShortcutActions = {
    focusSearch: unlessModalOpen(() => showPanel('search', true)),
    showFiles: unlessModalOpen(() => showPanel('tree', true)),
    showSearch: unlessModalOpen(() => showPanel('search', true)),
    toggleSidebar: unlessModalOpen(toggleSidebar),
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

  /** Show the tab `step` places from the active one in strip order; not with fewer than two. */
  function showTabBeside(step: number): boolean {
    const state = get(files);
    const active = activeOpenFile(state);
    if (!active) return false;
    const target = tabBeside(
      state.openFiles.map((f) => f.path),
      active.path,
      step,
    );
    if (target === null) return false;
    files.setActiveFile(target);
    return true;
  }

  /** Close the active tab; the store shows the tab used before it. */
  function closeActiveTab(): boolean {
    const active = activeOpenFile(get(files));
    if (!active) return false;
    files.closeFile(active.path);
    return true;
  }

  // A key that would change the tab behind a dialog is left to the dialog.
  const tabActions: FileTabsShortcutActions = {
    nextTab: () => !$modalOpen && showTabBeside(1),
    previousTab: () => !$modalOpen && showTabBeside(-1),
    closeTab: () => !$modalOpen && closeActiveTab(),
  };

  // Under the cover of a refused contract the app is blocked; its
  // shortcuts would act on panels the user cannot see or reach.
  function handleKeydown(event: KeyboardEvent) {
    if (get(contractRefused)) return;
    if (handleGlobalKey(event, actions)) return;
    handleFileTabsKey(event, tabActions);
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
      use:modal
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

      <button
        class="btn btn-primary w-full mt-4"
        use:takeFocus
        on:click={() => shortcutsHelpOpen.set(false)}
      >
        Close
      </button>
    </div>
  </div>
{/if}
