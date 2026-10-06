<script lang="ts">
  import { indexingLabel } from '$lib/samplesWait';
  import type { IndexBuild } from '$lib/types';

  export let isCompressed: boolean | null = null;
  export let compressionFormat: string | null = null;
  export let isIndexed: boolean | null = null;
  /** The line index build followed in the background, shown as `indexing N%`. */
  export let indexBuild: IndexBuild | null = null;
</script>

<span class="flex items-center gap-1 flex-shrink-0">
  {#if isCompressed && compressionFormat}
    <span class="badge badge-info text-[10px] py-0" title="Compressed file: {compressionFormat}">
      {compressionFormat}
    </span>
  {/if}
  {#if isIndexed}
    <span class="badge badge-success text-[10px] py-0" title="Indexed"> idx </span>
  {/if}
  {#if indexBuild}
    <span
      data-indexing
      class="badge badge-warning text-[10px] py-0 tabular-nums"
      title="The line index is being built; jumps by time wait for it"
    >
      {indexingLabel(indexBuild)}
    </span>
  {/if}
</span>
