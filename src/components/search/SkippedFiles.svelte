<script lang="ts">
  import { formatCount } from '$lib/utils/format';
  import { pathInSearch, type SkippedEntry } from '$lib/utils/traceSummary';

  /** The files a search left out that the list shows, and how many more there are. */
  export let skipped: { shown: SkippedEntry[]; more: number };
  /** The paths the search was given; each skipped path reads relative to the one that holds it. */
  export let searched: readonly string[] = [];

  $: total = skipped.shown.length + skipped.more;
</script>

<!-- A search's skipped files with the backend's reasons: binary files, files
     that cannot be read and, in chain mode, other encodings of a chain's
     parts (duplicate_part). Closed by default; a summary opens it by
     keyboard as well. -->
{#if total > 0}
  <details
    class="px-3 py-2 border-b border-gh-border-default dark:border-gh-border-dark-default text-xs"
  >
    <summary class="cursor-pointer text-gh-fg-muted dark:text-gh-fg-dark-muted">
      {formatCount(total, 'file')} skipped
    </summary>
    <ul class="mt-1 space-y-1">
      {#each skipped.shown as entry (entry.path)}
        <li class="break-all">
          <span class="font-mono text-gh-fg-default dark:text-gh-fg-dark-default" title={entry.path}
            >{pathInSearch(entry.path, searched)}</span
          >{#if entry.reason}: <span class="text-gh-fg-muted dark:text-gh-fg-dark-muted"
              >{entry.reason}</span
            >{/if}
        </li>
      {/each}
      {#if skipped.more > 0}
        <li class="text-gh-fg-muted dark:text-gh-fg-dark-muted">and {skipped.more} more</li>
      {/if}
    </ul>
  </details>
{/if}
