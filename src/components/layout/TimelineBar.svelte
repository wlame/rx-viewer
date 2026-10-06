<script lang="ts">
  /**
   * The timeline bar under the tab strip: one time axis over the open
   * files that have timestamps, a band for each file's span, a thumb at
   * the active file's position, the shared time cursor with a × that
   * clears it, and a Go to time box.
   *
   * Releasing a drag on the track, a click on it, Enter after the arrow
   * keys and Enter in the box each ask `jump` to move the active file;
   * nothing is asked while dragging. Times are written the way the
   * active file writes them, in the zone its lines show.
   */
  import type { OpenFile, TimeRangeResponse } from '$lib/types';
  import type { TimeJumpOutcome, TimeQuery } from '$lib/stores/files';
  import type { TimeCursor } from '$lib/utils/timeCursor';
  import { formatInFileLayout } from '$lib/utils/timeFormat';
  import { isShortcut, type ShortcutId } from '$lib/utils/shortcuts';
  import {
    effectiveTimeAt,
    fractionOf,
    hasTimeFormat,
    instantAt,
    isPointAxis,
    laneLayout,
    sideOfAxis,
    steppedInstant,
    timelineAxis,
    timelineBands,
    type TimeAxis,
    type TimelineStep,
  } from '$lib/utils/timeline';

  export let openFiles: OpenFile[];
  /** The file a jump moves; the thumb shows where it is. */
  export let activeFile: OpenFile | undefined;
  /** Whether the backend answers time queries (`samples_timestamps`). */
  export let canJump: boolean;
  /** Move the active file to a time: an instant (UTC ms) or the box's text. */
  export let jump: (query: TimeQuery) => Promise<TimeJumpOutcome>;
  /** The time cursor the open tabs share, or null when none is set. */
  export let cursor: TimeCursor | null;
  /** Clear the time cursor. */
  export let clearCursor: () => void;

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

  /** What the title says of a cursor outside the axis. */
  const CURSOR_SIDE_NOTES = {
    before: 'before the first time of the open files',
    after: 'after the last time of the open files',
  } as const;

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

  // The box's message is about the file that refused the value: it goes
  // when another file is shown.
  let messageFilePath = activeFile?.path;
  $: dropMessageForOtherFile(activeFile?.path);

  function dropMessageForOtherFile(path: string | undefined) {
    if (path === messageFilePath) return;
    messageFilePath = path;
    boxMessage = null;
  }

  $: isShown = canJump && openFiles.some(hasTimeFormat);
  $: axis = timelineAxis(openFiles);
  $: bands = axis ? timelineBands(openFiles, axis, activeFile?.path ?? null) : [];
  $: lanes = laneLayout(bands.length);
  $: isPoint = axis !== null && isPointAxis(axis);
  $: canType = hasTimeFormat(activeFile);
  $: canScrub = axis !== null && !isPoint && canType;

  // Times read the way the active file writes them, or the first timed
  // file when the active one has no timestamps.
  $: layout = (hasTimeFormat(activeFile) ? activeFile : openFiles.find(hasTimeFormat))?.timeRange;
  $: anchorMs = activeFile ? effectiveTimeAt(activeFile.lines, activeFile.anchorLine) : null;
  $: thumbMs = pendingMs ?? dragMs ?? keyMs ?? anchorMs;
  $: labelMs = dragMs ?? keyMs ?? hoverMs;

  // The cursor is drawn where its instant is; one outside the axis sits
  // at the end it is past, dashed.
  $: cursorMs = cursor?.instantMs ?? null;
  $: cursorSide = axis && cursorMs !== null ? sideOfAxis(cursorMs, axis) : null;
  $: cursorLabel = cursor
    ? cursorMs !== null
      ? labelOf(cursorMs, layout)
      : String(cursor.query)
    : '';
  $: cursorTitle =
    'Time cursor: a tab moves here when it is shown' +
    (cursorSide ? ` (${CURSOR_SIDE_NOTES[cursorSide]})` : '');

  // The axis ends are labelled on wide screens; the cursor's chip takes
  // their room on narrower ones.
  $: endLabelClass = cursor ? 'hidden xl:inline' : 'hidden lg:inline';

  /** Where the cursor's marker is drawn, in percent of the track. */
  function cursorPercent(ms: number, on: TimeAxis): number {
    const side = sideOfAxis(ms, on);
    if (side === 'before') return 0;
    if (side === 'after') return 100;
    return percentOf(ms, on);
  }

  /** `ms` written the way the file of `range` writes a time, or ISO 8601 without one. */
  function labelOf(ms: number, range: TimeRangeResponse | null | undefined): string {
    return range ? formatInFileLayout(ms, range) : new Date(ms).toISOString();
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
    else if (axis && !isPoint) hoverMs = pointerInstant(event);
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
    if (!isShortcut('timelineJump', event)) return;
    event.preventDefault();
    if (canType && boxValue.trim() !== '') void jumpTo(boxValue);
  }
</script>

{#if isShown}
  <div
    class="flex items-center gap-3 h-8 px-3 shrink-0 text-xs
           bg-gh-canvas-default dark:bg-gh-canvas-dark-default
           border-b border-gh-border-default dark:border-gh-border-dark-default"
  >
    {#if axis}
      <span
        class="font-mono tabular-nums whitespace-nowrap text-gh-fg-muted dark:text-gh-fg-dark-muted
               {isPoint ? '' : endLabelClass}"
      >
        {labelOf(axis.startMs, layout)}
      </span>
      <div
        bind:this={track}
        role="slider"
        tabindex="0"
        aria-label="Time in {activeFile?.name ?? 'the open file'}"
        aria-valuemin={axis.startMs}
        aria-valuemax={axis.endMs}
        aria-valuenow={thumbMs ?? axis.startMs}
        aria-valuetext={thumbMs !== null ? labelOf(thumbMs, layout) : 'Position not known'}
        aria-disabled={!canScrub}
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
        <!-- The lanes sit on a faint rail that marks the axis's extent. -->
        <div
          class="absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-sm
                 bg-gh-canvas-inset dark:bg-gh-canvas-dark-subtle"
          style="height: {lanes.height + 4}px"
        >
          {#each bands as band, i (band.path)}
            <div
              data-band
              data-active={String(band.isActive)}
              title={band.path}
              class="absolute rounded-full
                     {band.isActive
                ? 'bg-gh-accent-emphasis/75 dark:bg-gh-accent-dark-fg/70'
                : 'bg-gh-fg-subtle/35 dark:bg-gh-fg-dark-subtle/50'}"
              style="top: {lanes.tops[i] + 2}px; height: {lanes.bandHeight}px; {isPoint
                ? 'left: calc(50% - 3px); width: 6px'
                : `left: ${band.start * 100}%; width: ${band.width * 100}%; min-width: 2px`}"
            />
          {/each}
        </div>
        {#if hoverMs !== null && dragMs === null}
          <div
            class="absolute top-1 bottom-1 w-px pointer-events-none bg-gh-fg-muted/40 dark:bg-gh-fg-dark-muted/40"
            style="left: {percentOf(hoverMs, axis)}%"
          />
        {/if}
        {#if cursorMs !== null}
          <div
            data-cursor
            data-outside={cursorSide ?? undefined}
            class="absolute top-0.5 bottom-0.5 w-0 pointer-events-none"
            style="left: {cursorPercent(cursorMs, axis)}%"
          >
            <div
              class="absolute inset-y-0 -left-px border-l-2
                     border-gh-attention-emphasis dark:border-gh-attention-dark-fg
                     {cursorSide ? 'border-dashed opacity-70' : ''}"
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
            style="left: {percentOf(thumbMs, axis)}%; height: {lanes.height + 12}px"
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
            {labelOf(labelMs, layout)}
          </div>
        {/if}
      </div>
      {#if !isPoint}
        <span
          class="{endLabelClass} font-mono tabular-nums whitespace-nowrap text-gh-fg-muted dark:text-gh-fg-dark-muted"
        >
          {labelOf(axis.endMs, layout)}
        </span>
      {/if}
    {:else}
      <span class="flex-1 text-gh-fg-subtle dark:text-gh-fg-dark-subtle">
        The time range is not known yet
      </span>
    {/if}
    {#if cursor}
      <div
        data-cursor-chip
        title={cursorTitle}
        class="flex items-center gap-1.5 h-6 pl-2 pr-0.5 shrink-0 rounded
               font-mono tabular-nums whitespace-nowrap
               border border-gh-attention-emphasis/50 dark:border-gh-attention-dark-fg/50
               text-gh-attention-fg dark:text-gh-attention-dark-fg"
      >
        <span
          aria-hidden="true"
          class="w-1.5 h-1.5 rotate-45 bg-gh-attention-emphasis dark:bg-gh-attention-dark-fg"
        />
        <span class="hidden sm:inline">{cursorLabel}</span>
        <button
          type="button"
          aria-label="Clear the time cursor"
          title="Clear the time cursor"
          on:click={clearCursor}
          class="p-0.5 rounded outline-none
                 text-gh-fg-muted dark:text-gh-fg-dark-muted
                 hover:text-gh-fg-default dark:hover:text-gh-fg-dark-default
                 hover:bg-gh-canvas-inset dark:hover:bg-gh-canvas-dark-inset
                 focus-visible:ring-1 focus-visible:ring-gh-accent-emphasis dark:focus-visible:ring-gh-accent-dark-emphasis"
        >
          <svg
            class="w-3 h-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    {/if}
    <div class="relative shrink-0">
      <input
        type="text"
        aria-label="Go to time"
        placeholder={canType ? 'Go to time' : 'No timestamps in this file'}
        disabled={!canType}
        spellcheck="false"
        autocomplete="off"
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
               disabled:opacity-60 disabled:cursor-not-allowed"
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
  </div>
{/if}
