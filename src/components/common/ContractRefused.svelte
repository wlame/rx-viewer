<script lang="ts">
  /**
   * Covers the app while the backend speaks a contract major this viewer
   * cannot read. No `/v1` request goes out meanwhile (contractGate.ts);
   * the health store keeps asking `/health`, and the cover goes away by
   * itself once the backend reports a supported contract.
   */
  import { health } from '$lib/stores';
  import { BLOCKED_RECHECK_MS } from '$lib/stores/health';
  import { SUPPORTED_CONTRACT_MAJOR } from '$lib/utils/contractVersion';

  const recheckSeconds = BLOCKED_RECHECK_MS / 1000;
</script>

{#if $health.contract.kind === 'incompatible'}
  <div class="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4">
    <div
      class="bg-gh-canvas-default dark:bg-gh-canvas-dark-default
             border border-gh-border-default dark:border-gh-border-dark-default
             rounded-lg shadow-lg p-6 max-w-lg w-full"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="contract-refused-title"
      aria-describedby="contract-refused-detail"
    >
      <h2 id="contract-refused-title" class="text-lg font-semibold mb-3">
        This backend speaks an API this viewer cannot read
      </h2>
      <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm mb-3">
        <dt class="text-gh-fg-muted dark:text-gh-fg-dark-muted">Backend contract</dt>
        <dd class="font-mono">{$health.contract.major}.{$health.contract.minor}</dd>
        <dt class="text-gh-fg-muted dark:text-gh-fg-dark-muted">This viewer reads</dt>
        <dd class="font-mono">{SUPPORTED_CONTRACT_MAJOR}.x</dd>
      </dl>
      <p id="contract-refused-detail" class="text-sm mb-3">{$health.contract.message}</p>
      <p class="text-sm text-gh-fg-muted dark:text-gh-fg-dark-muted">
        Nothing is requested from this backend. The viewer asks it again every {recheckSeconds} seconds
        and continues by itself once the contract matches.
      </p>
      <button class="btn btn-primary w-full mt-4" on:click={() => health.check()}>
        Check now
      </button>
    </div>
  </div>
{/if}
