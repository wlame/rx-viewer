<!--
  The analysis dialog, drawn by the app over every panel. A tree row
  opens it through `openAnalysis`; it stays on screen until its Close,
  its backdrop or Esc closes it, whatever panel the side panel shows.
-->
<script lang="ts">
  import { analysisTarget, closeAnalysis } from '$lib/stores/analysisDialog';
  import AnalyzeDialog from './AnalyzeDialog.svelte';
</script>

{#if $analysisTarget}
  <!-- A new request is a new dialog, with its own analysis run. -->
  {#key $analysisTarget}
    <AnalyzeDialog
      path={$analysisTarget.path}
      name={$analysisTarget.name}
      on:close={closeAnalysis}
    />
  {/key}
{/if}
