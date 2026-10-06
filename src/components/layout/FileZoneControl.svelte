<script lang="ts">
  /**
   * The active file's time zone, a small button before the timeline: the
   * zone its times are shown in, marked when one was chosen for it. The
   * button opens a picker with the file's own zone (a reset), a filter
   * field over every zone this browser knows that also takes a typed
   * offset `±HH:MM`, and the zones: the common ones while the field is
   * empty, the matching ones after.
   *
   * Choosing a zone, or the reset, goes to `choose` and closes the
   * picker; so do Escape and a press outside it, which choose nothing.
   * The arrow keys move between the field and the zones, and Enter in
   * the field chooses the first one listed.
   */
  import { tick } from 'svelte';
  import { isShortcut } from '$lib/utils/shortcuts';
  import { matchingZones, zoneNames } from '$lib/utils/fileZones';

  /** The file's name, for the labels. */
  export let fileName: string;
  /** The zone the file's times are shown in (its range's `display_zone`), or null when unknown. */
  export let shownZone: string | null;
  /** The zone chosen for the file, or null when it is read as its lines write times. */
  export let chosenZone: string | null;
  /** Read the file in a zone, or as its lines write times with null. */
  export let choose: (zone: string | null) => void;

  const PICKER_ID = 'file-zone-picker';
  const OFFSET_HINT = 'Write an offset as ±HH:MM, at most ±18:00';

  /** The arrow keys of the picker: which way each moves the focus. */
  const MOVES: readonly { key: string; step: number }[] = [
    { key: 'ArrowDown', step: 1 },
    { key: 'ArrowUp', step: -1 },
  ];

  const names = zoneNames();

  let isOpen = false;
  let query = '';
  let trigger: HTMLButtonElement;
  let picker: HTMLElement | null = null;
  let field: HTMLInputElement | null = null;
  let list: HTMLElement | null = null;

  $: label = chosenZone ?? shownZone ?? 'Zone';
  $: matches = matchingZones(names, query);
  $: listed = matches.offset !== null ? [matches.offset] : matches.zones;
  $: isOffsetTyped = /^[+-]/.test(query.trim());
  $: description =
    chosenZone !== null
      ? `Time zone of ${fileName}: ${chosenZone}, chosen here`
      : `Time zone of ${fileName}: ${shownZone ?? 'not known'}, as its lines write times`;

  async function open() {
    isOpen = true;
    query = '';
    await tick();
    field?.focus();
  }

  function close() {
    isOpen = false;
    trigger?.focus();
  }

  function pick(zone: string | null) {
    close();
    choose(zone);
  }

  /** The field and the listed zones, in the order the arrow keys walk them. */
  function focusables(): HTMLElement[] {
    const zones = [...(list?.querySelectorAll<HTMLElement>('[data-zone]') ?? [])];
    return field ? [field, ...zones] : zones;
  }

  function handleKey(event: KeyboardEvent) {
    if (isShortcut('zoneClose', event)) {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    const move = MOVES.find((m) => m.key === event.key && isShortcut('zoneMove', event));
    if (!move) return;
    const order = focusables();
    const at = order.indexOf(event.currentTarget as HTMLElement);
    const next = order[Math.min(Math.max(at + move.step, 0), order.length - 1)];
    if (!next) return;
    event.preventDefault();
    next.focus();
  }

  function handleFieldKey(event: KeyboardEvent) {
    if (isShortcut('zoneChoose', event)) {
      event.preventDefault();
      if (listed.length > 0) pick(listed[0]);
      return;
    }
    handleKey(event);
  }

  function handleWindowPointerDown(event: PointerEvent) {
    if (!isOpen) return;
    const target = event.target as Node | null;
    if (picker?.contains(target) || trigger?.contains(target)) return;
    isOpen = false;
  }

  const ITEM_CLASS = `w-full text-left px-2 py-1 rounded outline-none truncate
    enabled:hover:bg-gh-canvas-inset dark:enabled:hover:bg-gh-canvas-dark-inset
    focus-visible:bg-gh-canvas-inset dark:focus-visible:bg-gh-canvas-dark-inset
    focus-visible:ring-1 focus-visible:ring-gh-accent-emphasis dark:focus-visible:ring-gh-accent-dark-emphasis
    disabled:opacity-50 disabled:cursor-default`;
</script>

<svelte:window on:pointerdown={handleWindowPointerDown} />

<div class="relative shrink-0">
  <button
    bind:this={trigger}
    type="button"
    aria-haspopup="dialog"
    aria-expanded={isOpen}
    aria-controls={isOpen ? PICKER_ID : undefined}
    aria-label="{description}. Choose another zone"
    title="{description}. Click to choose another zone"
    data-chosen={chosenZone !== null ? 'true' : undefined}
    on:click={() => (isOpen ? close() : void open())}
    class="flex items-center gap-1 h-6 max-w-[9rem] px-1.5 rounded outline-none
           font-mono tabular-nums whitespace-nowrap border
           focus-visible:ring-1 focus-visible:ring-gh-accent-emphasis dark:focus-visible:ring-gh-accent-dark-emphasis
           {chosenZone !== null
      ? 'border-gh-accent-emphasis/60 dark:border-gh-accent-dark-fg/60 text-gh-accent-fg dark:text-gh-accent-dark-fg'
      : 'border-transparent text-gh-fg-muted dark:text-gh-fg-dark-muted hover:border-gh-border-default dark:hover:border-gh-border-dark-default'}"
  >
    {#if chosenZone !== null}
      <span
        aria-hidden="true"
        class="w-1.5 h-1.5 shrink-0 rounded-full bg-gh-accent-emphasis dark:bg-gh-accent-dark-fg"
      />
    {/if}
    <span class="truncate">{label}</span>
  </button>

  {#if isOpen}
    <div
      bind:this={picker}
      id={PICKER_ID}
      role="dialog"
      aria-label="Time zone of {fileName}"
      class="absolute left-0 top-full mt-1 z-30 w-64 p-1.5 rounded shadow-md
             bg-gh-canvas-default dark:bg-gh-canvas-dark-subtle
             border border-gh-border-default dark:border-gh-border-dark-default
             text-gh-fg-default dark:text-gh-fg-dark-default"
    >
      <button
        type="button"
        data-own-zone
        disabled={chosenZone === null}
        title={chosenZone === null
          ? `${fileName} is read in its own zone`
          : `Read ${fileName} in the zone its lines write`}
        on:click={() => pick(null)}
        on:keydown={handleKey}
        class={ITEM_CLASS}
      >
        The file's own zone{chosenZone === null ? ' (in use)' : ''}
      </button>
      <input
        bind:this={field}
        bind:value={query}
        type="text"
        aria-label="Filter the zones, or type an offset ±HH:MM"
        placeholder="Filter, or ±HH:MM"
        spellcheck="false"
        autocomplete="off"
        on:keydown={handleFieldKey}
        class="w-full h-6 my-1 px-2 rounded font-mono text-xs outline-none
               bg-gh-canvas-subtle dark:bg-gh-canvas-dark-default
               border border-gh-border-default dark:border-gh-border-dark-default
               placeholder:text-gh-fg-subtle dark:placeholder:text-gh-fg-dark-subtle
               focus:border-gh-accent-emphasis dark:focus:border-gh-accent-dark-emphasis"
      />
      <div bind:this={list} role="group" aria-label="Zones" class="max-h-60 overflow-y-auto">
        {#each listed as zone (zone)}
          <button
            type="button"
            data-zone={zone}
            aria-pressed={zone === chosenZone}
            on:click={() => pick(zone)}
            on:keydown={handleKey}
            class="{ITEM_CLASS} font-mono {zone === chosenZone
              ? 'text-gh-accent-fg dark:text-gh-accent-dark-fg'
              : ''}"
          >
            {zone}
          </button>
        {:else}
          <p class="px-2 py-1 text-gh-fg-subtle dark:text-gh-fg-dark-subtle">
            {isOffsetTyped ? OFFSET_HINT : 'No zone matches'}
          </p>
        {/each}
      </div>
    </div>
  {/if}
</div>
