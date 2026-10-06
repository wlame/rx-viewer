<script lang="ts">
  import { onMount } from 'svelte';
  import { health, settings, detectors } from '$lib/stores';
  import { contractRefused } from '$lib/stores/health';
  import { readViewState } from '$lib/utils/urlState';
  import { loadView, startViewSync } from '$lib/viewState';
  import Header from './components/layout/Header.svelte';
  import Sidebar from './components/layout/Sidebar.svelte';
  import MainContent from './components/layout/MainContent.svelte';
  import StatusBar from './components/layout/StatusBar.svelte';
  import KeyboardShortcuts from './components/common/KeyboardShortcuts.svelte';
  import Notifications from './components/common/Notifications.svelte';
  import TokenPrompt from './components/common/TokenPrompt.svelte';
  import ContractRefused from './components/common/ContractRefused.svelte';

  onMount(() => {
    health.startPolling();

    // Fetch detector metadata on app load (non-blocking)
    detectors.fetchDetectors();

    // The link rebuilds the view. The URL follows the view only once that
    // is done, so a half-restored view never overwrites the link.
    let stopViewSync: (() => void) | null = null;
    let isDestroyed = false;
    loadView(readViewState())
      .catch((e) => console.error('Failed to restore the view from the URL:', e))
      .finally(() => {
        if (!isDestroyed) stopViewSync = startViewSync();
      });

    return () => {
      isDestroyed = true;
      health.stopPolling();
      stopViewSync?.();
    };
  });
</script>

<!-- While the contract is refused the app behind the cover takes no
     focus and no input: the cover is the only thing to act on. -->
<div class="h-screen flex flex-col" inert={$contractRefused}>
  <Header />

  <div class="flex-1 flex min-h-0">
    <Sidebar width={$settings.sidebarWidth} />
    <MainContent />
  </div>

  <StatusBar />
  <KeyboardShortcuts />
  <Notifications />
  <TokenPrompt />
</div>
<ContractRefused />
