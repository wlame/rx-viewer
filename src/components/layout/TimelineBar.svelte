<script lang="ts">
  /**
   * The timeline bar under the tab strip: the active file's time axis,
   * from its first to its last time, a thumb at its position, a marker
   * at the time cursor when the cursor is inside the file's range, and a
   * Go to time box. It follows the active file: a switch shows the new
   * file's axis.
   *
   * Releasing a drag on the track, a click on it, Enter after the arrow
   * keys and Enter in the box each ask `jump` to move the active file;
   * nothing is asked while dragging. Times are written the way the
   * active file writes them, in the zone its lines show.
   *
   * Hidden for a backend without time queries and for a file without
   * timestamps; a short note shows while the file's range is being read.
   * While the file wants a line index and has none (it is being built,
   * or its build failed) the axis neither scrubs nor jumps and the box is
   * disabled, each with a tooltip that says why.
   *
   * On a backend that reads a file in a chosen zone (`file_tz`), the
   * bar starts with the file's zone, which opens a picker to choose one
   * or to go back to the file's own.
   *
   * A log chain's tab shows the chain's axis, from its first to its last
   * time, with a tick where each part starts, a band over each time gap
   * and a dot where missing parts would be; the slider's value names the
   * part of its time. Until the chain is ready the bar says why it does
   * not jump, and its zone is the chain's.
   */
  import type { OpenFile } from '$lib/types';
  import type { TimeJumpOutcome, TimeQuery } from '$lib/stores/files';
  import { partAtTime } from '$lib/utils/chainTime';
  import { chainTimelineMarks } from '$lib/utils/chainTimeline';
  import { isShortcut, type ShortcutId } from '$lib/utils/shortcuts';
  import ChainTimelineMarks from './ChainTimelineMarks.svelte';
  import FileZoneControl from './FileZoneControl.svelte';
  import {
    effectiveTimeAt,
    fractionOf,
    hasTimeFormat,
    instantAt,
    isPointAxis,
    sideOfAxis,
    steppedInstant,
    pendingIndexReason,
    timeLabelFor,
    timeLayoutOf,
    timeRangeUnknownReason,
    timelineAxis,
    type TimeAxis,
    type TimelineStep,
  } from '$lib/utils/timeline';

  /** The file a jump moves; the axis is its range and the thumb shows where it is. */
  export let activeFile: OpenFile | undefined;
  /** Whether the backend answers time queries (`samples_timestamps`). */
  export let canJump: boolean;
  /** Move the active file to a time: an instant (UTC ms) or the box's text. */
  export let jump: (query: TimeQuery) => Promise<TimeJumpOutcome>;
  /** The time cursor (UTC ms), or null when none is set. */
  export let cursorMs: number | null;
  /** Whether the backend reads a file in a chosen zone (`file_tz`). */
  export let canChooseZone = false;
  /** The zone chosen for the active file, or null when it is read in its own. */
  export let chosenZone: string | null = null;
  /** Read the active file in a zone, or in its own with null. */
  export let chooseZone: (zone: string | null) => void = () => {};

  /** The arrow and Home/End keys: which shortcut row and key make which step. */
  const KEY_STEPS: readonly { id: ShortcutId; key: string; step: TimelineStep }[] = [
    { id: 'timelineStep', key: 'ArrowLeft', step: 'earlier' },
    { id: 'timelineStep', key: 'ArrowRight', step: 'later' },
    { id: 'timelineBigStep', key: 'ArrowLeft', step: 'muchEarlier' },
    { id: 'timelineBigStep', key: 'ArrowRight', step: 'muchLater' },
    { id: 'timelineEnds', key: 'Home', step: 'start' },
    { id: 'timelineEnds', key: 'End', step: 'end' },
  ];

  const MESSAGE_ID = 'timeline-box-message';

  /** The height of the file's band on the rail, in px. */
  const BAND_HEIGHT = 3;

  let track: HTMLElement;
  let boxValue = '';
  /** The backend's refusal of the last jump, shown under the box. */
  let boxMessage: string | null = null;
  /** The instant under the pointer while it is over the track. */
  let hoverMs: number | null = null;
  /** The instant under the pointer while it drags. */
  let dragMs: number | null = null;
  /** The instant the keys moved to, before Enter. */
  let keyMs: number | null = null;
  /** The instant of a jump on its way, shown until the file moves. */
  let pendingMs: number | null = null;

  // What the bar holds belongs to one file: the box's message, and a
  // time under the pointer, under the keys or on its way. All of it goes
  // when another file is shown.
  let shownFilePath = activeFile?.path;
  $: forgetOtherFile(activeFile?.path);

  function forgetOtherFile(path: string | undefined) {
    if (path === shownFilePath) return;
    shownFilePath = path;
    boxMessage = null;
    hoverMs = null;
    dragMs = null;
    keyMs = null;
    pendingMs = null;
  }

  // A chain's tab reads its times from the chain's description.
  $: description = activeFile?.chain?.description ?? null;
  $: canType = hasTimeFormat(activeFile);
  $: isReadingRange = activeFile?.chain
    ? description === null && activeFile.error === null
    : Boolean(activeFile?.isReadingTimeRange && activeFile.timeRange === null);
  // A described chain shows the bar in every state, to say why it cannot jump yet.
  $: isShown =
    canJump && activeFile !== undefined && (canType || isReadingRange || description !== null);
  $: axis = timelineAxis(activeFile);
  $: isPoint = axis !== null && isPointAxis(axis);
  // Why the file cannot be jumped by time yet, or null when it can.
  $: blockedReason = pendingIndexReason(activeFile);
  $: canScrub = axis !== null && !isPoint && blockedReason === null;

  $: marks = description ? chainTimelineMarks(description) : null;
  $: shownZone = timeLayoutOf(activeFile)?.display_zone ?? null;
  $: unknownRangeText = activeFile?.chain
    ? timeRangeUnknownReason(activeFile)
    : 'The time range is not known yet';
  $: anchorMs = activeFile ? effectiveTimeAt(activeFile.lines, activeFile.anchorLine) : null;
  $: thumbMs = pendingMs ?? dragMs ?? keyMs ?? anchorMs;
  $: labelMs = dragMs ?? keyMs ?? hoverMs;

  // The cursor is marked only where the file has times.
  $: isCursorOnAxis = axis !== null && cursorMs !== null && sideOfAxis(cursorMs, axis) === null;

  /** What the slider reads out for `ms` in `file`: its time and, on a chain, the part that holds it. */
  function valueTextOf(ms: number | null, file: OpenFile | undefined): string {
    if (ms === null) return 'Position not known';
    const label = timeLabelFor(ms, file);
    const chain = file?.chain?.description;
    const part = chain ? partAtTime(chain, ms) : null;
    return part ? `${label}, in ${part.name}` : label;
  }

  /** Where `ms` is on the axis, in percent of the track. */
  function percentOf(ms: number, on: TimeAxis): number {
    return fractionOf(ms, on) * 100;
  }

  function pointerInstant(event: MouseEvent): number | null {
    if (!axis) return null;
    const rect = track.getBoundingClientRect();
    return instantAt(event.clientX - rect.left, rect.width, axis);
  }

  function handlePointerDown(event: PointerEvent) {
    if (!canScrub || event.button > 0) return;
    // No text selection while dragging; focus stays for the keys.
    event.preventDefault();
    track.focus();
    if (typeof event.pointerId === 'number') track.setPointerCapture?.(event.pointerId);
    keyMs = null;
    dragMs = pointerInstant(event);
  }

  function handlePointerMove(event: PointerEvent) {
    if (dragMs !== null) dragMs = pointerInstant(event) ?? dragMs;
    else if (canScrub) hoverMs = pointerInstant(event);
  }

  function handlePointerUp(event: PointerEvent) {
    if (dragMs === null) return;
    const ms = pointerInstant(event) ?? dragMs;
    dragMs = null;
    void jumpTo(ms);
  }

  async function jumpTo(query: TimeQuery) {
    pendingMs = typeof query === 'number' ? query : null;
    keyMs = null;
    boxMessage = null;
    const outcome = await jump(query);
    pendingMs = null;
    if (outcome.kind === 'refused') boxMessage = outcome.message;
  }

  function handleTrackKey(event: KeyboardEvent) {
    if (!canScrub || !axis) return;
    const row = KEY_STEPS.find((r) => r.key === event.key && isShortcut(r.id, event));
    if (row) {
      event.preventDefault();
      keyMs = steppedInstant(keyMs ?? anchorMs ?? axis.startMs, row.step, axis);
    } else if (keyMs !== null && isShortcut('timelineJump', event)) {
      event.preventDefault();
      void jumpTo(keyMs);
    } else if (keyMs !== null && isShortcut('timelineCancel', event)) {
      event.preventDefault();
      keyMs = null;
    }
  }

  function handleBoxKey(event: KeyboardEvent) {
    if (blockedReason !== null || !isShortcut('timelineJump', event)) return;
    event.preventDefault();
    if (boxValue.trim() !== '') void jumpTo(boxValue);
  }
</script>

{#if isShown}
  <div
    class="flex items-center gap-3 h-8 px-3 shrink-0 text-xs
           bg-gh-canvas-default dark:bg-gh-canvas-dark-default
           border-b border-gh-border-default dark:border-gh-border-dark-default"
  >
    {#if canType && canChooseZone && activeFile}
      <FileZoneControl fileName={activeFile.name} {shownZone} {chosenZone} choose={chooseZone} />
    {/if}
    {#if !canType && isReadingRange}
      <span data-reading-range class="flex-1 text-gh-fg-subtle dark:text-gh-fg-dark-subtle">
        Reading the time range…
      </span>
    {:else if axis}
      <span
        class="font-mono tabular-nums whitespace-nowrap text-gh-fg-muted dark:text-gh-fg-dark-muted
               {isPoint ? '' : 'hidden lg:inline'}"
      >
        {timeLabelFor(axis.startMs, activeFile)}
      </span>
      <div
        bind:this={track}
        role="slider"
        tabindex="0"
        aria-label="Time in {activeFile?.name ?? 'the open file'}"
        aria-valuemin={axis.startMs}
        aria-valuemax={axis.endMs}
        aria-valuenow={thumbMs ?? axis.startMs}
        aria-valuetext={valueTextOf(thumbMs, activeFile)}
        aria-disabled={!canScrub}
        title={blockedReason ?? undefined}
        class="relative flex-1 min-w-24 self-stretch rounded outline-none touch-none select-none
               focus-visible:ring-1 focus-visible:ring-gh-accent-emphasis dark:focus-visible:ring-gh-accent-dark-emphasis
               {canScrub ? 'cursor-pointer' : 'cursor-default'}"
        on:pointerdown={handlePointerDown}
        on:pointermove={handlePointerMove}
        on:pointerup={handlePointerUp}
        on:pointercancel={() => (dragMs = null)}
        on:pointerleave={() => (hoverMs = null)}
        on:keydown={handleTrackKey}
        on:blur={() => (keyMs = null)}
      >
        <!-- The file's band sits on a faint rail; both span the axis. -->
        <div
          class="absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-sm
                 bg-gh-canvas-inset dark:bg-gh-canvas-dark-subtle"
          style="height: {BAND_HEIGHT + 4}px"
        >
          <div
            data-band
            title={activeFile?.chain?.handle ?? activeFile?.path}
            class="absolute rounded-full bg-gh-accent-emphasis/75 dark:bg-gh-accent-dark-fg/70"
            style="top: 2px; height: {BAND_HEIGHT}px; {isPoint
              ? 'left: calc(50% - 3px); width: 6px'
              : 'left: 0; width: 100%'}"
          />
        </div>
        {#if marks}
          <ChainTimelineMarks {marks} />
        {/if}
        {#if hoverMs !== null && dragMs === null}
          <div
            class="absolute top-1 bottom-1 w-px pointer-events-none bg-gh-fg-muted/40 dark:bg-gh-fg-dark-muted/40"
            style="left: {percentOf(hoverMs, axis)}%"
          />
        {/if}
        {#if isCursorOnAxis && cursorMs !== null}
          <div
            data-cursor
            class="absolute top-0.5 bottom-0.5 w-0 pointer-events-none"
            style="left: {percentOf(cursorMs, axis)}%"
          >
            <div
              class="absolute inset-y-0 -left-px border-l-2
                     border-gh-attention-emphasis dark:border-gh-attention-dark-fg"
            />
            <div
              class="absolute top-0 -left-[3px] w-1.5 h-1.5 rotate-45
                     bg-gh-attention-emphasis dark:bg-gh-attention-dark-fg"
            />
          </div>
        {/if}
        {#if thumbMs !== null && !isPoint}
          <div
            data-thumb
            class="absolute top-1/2 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none
                   bg-gh-accent-fg dark:bg-gh-accent-dark-fg"
            style="left: {percentOf(thumbMs, axis)}%; height: {BAND_HEIGHT + 12}px"
          />
        {/if}
        {#if labelMs !== null}
          <div
            data-pointer-label
            class="absolute top-full mt-0.5 z-20 px-1.5 py-0.5 rounded pointer-events-none shadow-sm
                   font-mono tabular-nums whitespace-nowrap
                   bg-gh-canvas-default dark:bg-gh-canvas-dark-subtle
                   border border-gh-border-default dark:border-gh-border-dark-default
                   text-gh-fg-default dark:text-gh-fg-dark-default"
            style="left: {percentOf(labelMs, axis)}%; transform: translateX(-{percentOf(
              labelMs,
              axis,
            )}%)"
          >
            {timeLabelFor(labelMs, activeFile)}
          </div>
        {/if}
      </div>
      {#if !isPoint}
        <span
          class="hidden lg:inline font-mono tabular-nums whitespace-nowrap text-gh-fg-muted dark:text-gh-fg-dark-muted"
        >
          {timeLabelFor(axis.endMs, activeFile)}
        </span>
      {/if}
    {:else if blockedReason !== null}
      <span data-index-pending class="flex-1 text-gh-fg-subtle dark:text-gh-fg-dark-subtle">
        {blockedReason}
      </span>
    {:else}
      <span class="flex-1 text-gh-fg-subtle dark:text-gh-fg-dark-subtle">
        {unknownRangeText}
      </span>
    {/if}
    {#if canType}
      <div class="relative shrink-0">
        <input
          type="text"
          aria-label="Go to time"
          placeholder="Go to time"
          spellcheck="false"
          autocomplete="off"
          disabled={blockedReason !== null}
          title={blockedReason ?? undefined}
          bind:value={boxValue}
          on:input={() => (boxMessage = null)}
          on:keydown={handleBoxKey}
          aria-invalid={boxMessage !== null}
          aria-describedby={boxMessage !== null ? MESSAGE_ID : undefined}
          class="w-48 h-6 px-2 rounded font-mono text-xs outline-none
               bg-gh-canvas-subtle dark:bg-gh-canvas-dark-subtle
               border {boxMessage !== null
            ? 'border-gh-danger-fg dark:border-gh-danger-dark-fg'
            : 'border-gh-border-default dark:border-gh-border-dark-default'}
               text-gh-fg-default dark:text-gh-fg-dark-default
               placeholder:text-gh-fg-subtle dark:placeholder:text-gh-fg-dark-subtle
               focus:border-gh-accent-emphasis dark:focus:border-gh-accent-dark-emphasis
               disabled:opacity-50 disabled:cursor-not-allowed"
        />
        {#if boxMessage !== null}
          <p
            id={MESSAGE_ID}
            role="alert"
            class="absolute right-0 top-full mt-1 z-30 w-max max-w-sm px-2 py-1 rounded shadow-sm
                 bg-gh-canvas-default dark:bg-gh-canvas-dark-subtle
                 border border-gh-danger-fg/40 dark:border-gh-danger-dark-fg/40
                 text-gh-danger-fg dark:text-gh-danger-dark-fg"
          >
            {boxMessage}
          </p>
        {/if}
      </div>
    {/if}
  </div>
{/if}
