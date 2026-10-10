<script lang="ts">
  /**
   * Asks for the API token when the backend refuses a request for want
   * of one (a backend started with RX_API_TOKEN). The token is kept for
   * this tab and the page reloads, so every store fetches again with it.
   *
   * The dialog cannot be dismissed: without the token nothing else in
   * the viewer works, and pretending otherwise would leave the user in
   * front of empty panels.
   */
  import { tick } from 'svelte';
  import { getApiToken, setApiToken, tokenRequired } from '$lib/utils/apiToken';
  import { modal } from '$lib/actions/modal';

  let token = '';
  let inputEl: HTMLInputElement;

  // A token the tab already held and the backend still refused.
  $: refused = $tokenRequired && getApiToken() !== null;

  // Focus the field when the dialog appears.
  $: if ($tokenRequired) {
    tick().then(() => inputEl?.focus());
  }

  function submit() {
    const value = token.trim();
    if (!value) return;
    setApiToken(value);
    window.location.reload();
  }
</script>

{#if $tokenRequired}
  <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
    <form
      class="bg-gh-canvas-default dark:bg-gh-canvas-dark-default
             border border-gh-border-default dark:border-gh-border-dark-default
             rounded-lg shadow-lg p-6 max-w-md w-full space-y-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="token-title"
      aria-describedby="token-help"
      use:modal
      on:submit|preventDefault={submit}
    >
      <h2 id="token-title" class="text-lg font-semibold">This server requires an API token</h2>
      <p id="token-help" class="text-sm text-gh-fg-muted dark:text-gh-fg-dark-muted">
        It was started with <code>RX_API_TOKEN</code>. Paste the token below, or open the link you
        were given — it carries the token after <code>#token=</code>. The token is kept for this
        browser tab only.
      </p>
      {#if refused}
        <p class="text-sm text-gh-danger-fg dark:text-gh-danger-dark-fg">
          The token this tab held was refused.
        </p>
      {/if}
      <input
        bind:this={inputEl}
        bind:value={token}
        type="password"
        autocomplete="off"
        aria-label="API token"
        class="w-full text-sm bg-gh-canvas-default dark:bg-gh-canvas-dark-default
               border border-gh-border-default dark:border-gh-border-dark-default
               rounded px-3 py-2 outline-none focus:border-gh-accent-fg dark:focus:border-gh-accent-dark-fg
               font-mono"
      />
      <div class="flex justify-end">
        <button
          type="submit"
          disabled={!token.trim()}
          class="px-4 py-1.5 text-sm font-medium rounded
                 bg-gh-accent-emphasis dark:bg-gh-accent-dark-emphasis text-white
                 hover:bg-gh-accent-fg dark:hover:bg-gh-accent-dark-fg disabled:opacity-50"
        >
          Use token
        </button>
      </div>
    </form>
  </div>
{/if}
