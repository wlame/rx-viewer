<!--
  An outline icon from the table in `utils/icons.ts`, drawn in the text
  colour. It is decoration: the control that holds it carries the name.
-->
<script lang="ts">
  import { ICONS, type IconName } from '$lib/utils/icons';

  export let name: IconName;
  /** Width and height in CSS pixels. */
  export let size = 16;
  let className = '';
  export { className as class };

  $: shapes = ICONS[name];
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  focusable="false"
  class={className}
>
  {#each shapes as shape}
    <svelte:element this={shape.tag} {...shape.attrs} />
  {/each}
</svg>
