<!-- A button with a tooltip, for the tests of the tooltip action. -->
<script lang="ts">
  import { tooltip, type TooltipParams } from '$lib/actions/tooltip';

  export let params: TooltipParams;
</script>

<button type="button" use:tooltip={params}>trigger</button>
