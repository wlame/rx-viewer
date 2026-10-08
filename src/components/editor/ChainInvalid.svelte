<script lang="ts">
  /**
   * The body of a log chain's tab when the chain cannot be read as one
   * text: why, as the backend says it. No line is shown.
   */
  import type { ChainReason } from '$lib/types';

  /** The failed checks of the chain's description. */
  export let reasons: readonly ChainReason[];
  /** The backend's refusal of a read (a 422's detail), or null. */
  export let detail: string | null = null;
</script>

<div class="flex items-center justify-center h-full p-4" role="status">
  <div class="max-w-xl text-sm">
    <p class="font-medium text-gh-danger-fg dark:text-gh-danger-dark-fg">
      This log chain cannot be read as one text
    </p>
    {#if reasons.length > 0}
      <ul class="mt-2 list-disc pl-5 space-y-1 text-gh-fg-muted dark:text-gh-fg-dark-muted">
        {#each reasons as reason, index (index)}
          <li><code>{reason.code}</code>: {reason.message}</li>
        {/each}
      </ul>
    {/if}
    {#if detail}
      <p class="mt-2 text-gh-fg-muted dark:text-gh-fg-dark-muted">{detail}</p>
    {/if}
  </div>
</div>
