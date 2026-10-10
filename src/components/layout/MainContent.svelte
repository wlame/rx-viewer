<script lang="ts">
  import { files } from '$lib/stores';
  import { activeOpenFile, type TimeQuery } from '$lib/stores/files';
  import { fileZones } from '$lib/stores/fileZones';
  import { backendHas, health } from '$lib/stores/health';
  import { notifications } from '$lib/stores/notifications';
  import { timeCursor } from '$lib/stores/timeCursor';
  import { timeStash } from '$lib/stores/timeStash';
  import { FILE_ZONES_FULL, fileZoneOf } from '$lib/utils/fileZones';
  import { timeJumpFeature } from '$lib/utils/timeline';
  import { STASH_ADD_LABEL, STASH_REFUSALS, stashAddRefusal } from '$lib/utils/timeStash';
  import EditorPane from '../editor/EditorPane.svelte';
  import TabStrip, { tabElementId } from './TabStrip.svelte';
  import TimeCursorIndicator from './TimeCursorIndicator.svelte';
  import TimeStashRow from './TimeStashRow.svelte';
  import TimelineBar from './TimelineBar.svelte';

  /** The id of the editor area, the tab panel every tab of the strip controls. */
  const TAB_PANEL_ID = 'rx-tab-panel';

  // The same rule picks the file the URL names, so the two cannot differ.
  $: activeFile = activeOpenFile($files);
  $: validActiveIndex = activeFile ? $files.openFiles.indexOf(activeFile) : 0;

  $: canJump = backendHas(timeJumpFeature(activeFile), $health);
  $: canChooseZone = backendHas('file_tz', $health);
  // Zones are kept by tab key, which a tab holds in `path`.
  $: chosenZone = activeFile ? fileZoneOf($fileZones, activeFile.path) : null;

  /** Read the active file in `zone`, or in its own with null; say so when it cannot be kept. */
  async function chooseActiveFileZone(zone: string | null) {
    if (!activeFile) return;
    const isKept = await files.setFileZone(activeFile.path, zone);
    if (!isKept) notifications.info(FILE_ZONES_FULL);
  }

  /**
   * A jump from the timeline bar or a stash entry moves the file the
   * editor shows and sets the time cursor; no other file moves.
   */
  async function jumpActiveFileToTime(query: TimeQuery) {
    if (!activeFile) return { kind: 'unsupported' } as const;
    return files.jumpToTime(activeFile.path, query);
  }

  // The stash row keeps its place while files are open on a backend that
  // can jump by time, so the editor does not move when the first moment
  // is saved or the last one removed; saved moments show in any case.
  $: isStashShown = $timeStash.length > 0 || ($files.openFiles.length > 0 && canJump);

  // Why the cursor cannot go into the stash, or null when it can.
  $: cursorRefusal = $timeCursor === null ? null : stashAddRefusal($timeStash, $timeCursor);

  /** The `+` of the time cursor: save its instant, or say why it was refused. */
  function addCursorToStash(instantMs: number) {
    const outcome = timeStash.add(instantMs);
    if (outcome !== 'added') notifications.info(STASH_REFUSALS[outcome]);
  }
</script>

<main class="flex-1 flex flex-col min-w-0 bg-gh-canvas-default dark:bg-gh-canvas-dark-default">
  {#if isStashShown}
    <TimeStashRow
      stash={$timeStash}
      {activeFile}
      {canJump}
      jump={jumpActiveFileToTime}
      remove={timeStash.remove}
    />
  {/if}
  {#if $files.openFiles.length === 0}
    <!-- Empty state -->
    <div
      class="flex-1 flex items-center justify-center text-gh-fg-muted dark:text-gh-fg-dark-muted"
    >
      <div class="text-center">
        <svg
          class="w-16 h-16 mx-auto mb-4 opacity-50"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1"
        >
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
          <path d="M14 2v6h6" />
          <path d="M16 13H8M16 17H8M10 9H8" />
        </svg>
        <p class="text-lg font-medium">No files open</p>
        <p class="text-sm mt-1">Select a file from the tree to view its contents</p>
      </div>
    </div>
  {:else}
    <!-- The tab row: the tabs, with drag-to-reorder, scroll in the space
         left of the time cursor at its right edge. -->
    <div
      class="flex items-center bg-gh-canvas-subtle dark:bg-gh-canvas-dark-subtle border-b border-gh-border-default dark:border-gh-border-dark-default"
    >
      <TabStrip panelId={TAB_PANEL_ID} />
      {#if $timeCursor !== null}
        <div class="shrink-0 pl-1 pr-2">
          <TimeCursorIndicator
            cursorMs={$timeCursor}
            {activeFile}
            addToStash={cursorRefusal === null ? addCursorToStash : null}
            addTitle={cursorRefusal === null ? STASH_ADD_LABEL : STASH_REFUSALS[cursorRefusal]}
            clearCursor={files.clearTimeCursor}
          />
        </div>
      {/if}
    </div>

    <TimelineBar
      {activeFile}
      {canJump}
      jump={jumpActiveFileToTime}
      cursorMs={$timeCursor}
      {canChooseZone}
      {chosenZone}
      chooseZone={chooseActiveFileZone}
    />

    <!-- The active tab's editor, built again for each tab key (`path`, see
         utils/tabKey.ts) so no state of one tab reaches another; each tab's
         own state is kept in paneMemory under its key. -->
    <div
      id={TAB_PANEL_ID}
      role="tabpanel"
      aria-labelledby={tabElementId(validActiveIndex)}
      class="flex-1 min-h-0 overflow-hidden"
    >
      {#if activeFile}
        {#key activeFile.path}
          <EditorPane file={activeFile} hideHeader={false} isActive={true} />
        {/key}
      {/if}
    </div>
  {/if}
</main>
