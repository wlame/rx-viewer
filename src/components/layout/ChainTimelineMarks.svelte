<script lang="ts">
  /**
   * The marks of a log chain on the timeline bar's track: a shaded band
   * over each time gap, a tick where each part starts and a dot where
   * missing parts would be, each with a tooltip that names it. They sit
   * under the thumb and the time cursor, and a press on one scrubs the
   * track as a press anywhere else does. The slider's value names the
   * part of its time, so the parts are read out without the tooltips.
   */
  import type { ChainTimelineMarks } from '$lib/utils/chainTimeline';

  export let marks: ChainTimelineMarks;

  /** A share of the axis as a CSS length along the track. */
  function percent(fraction: number): string {
    return `${fraction * 100}%`;
  }
</script>

{#each marks.gaps as gap, index (index)}
  <div
    data-gap
    title={gap.title}
    class="absolute top-1 bottom-1 rounded-sm min-w-[2px]
           bg-gh-attention-emphasis/20 dark:bg-gh-attention-dark-fg/20"
    style="left: {percent(gap.fromFraction)}; width: {percent(gap.toFraction - gap.fromFraction)}"
  />
{/each}
{#each marks.ticks as tick, index (index)}
  <div
    data-part-edge
    title={tick.title}
    class="absolute top-0.5 bottom-0.5 w-2 -translate-x-1/2"
    style="left: {percent(tick.fraction)}"
  >
    <div class="mx-auto w-px h-full bg-gh-fg-muted/60 dark:bg-gh-fg-dark-muted/60" />
  </div>
{/each}
{#each marks.missing as mark, index (index)}
  <div
    data-missing-part
    title={mark.title}
    class="absolute top-0 w-1.5 h-1.5 -translate-x-1/2 rounded-full
           bg-gh-danger-fg dark:bg-gh-danger-dark-fg"
    style="left: {percent(mark.fraction)}"
  />
{/each}
