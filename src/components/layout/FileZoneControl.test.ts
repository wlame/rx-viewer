// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import FileZoneControl from './FileZoneControl.svelte';

let control: FileZoneControl | null = null;

afterEach(() => {
  control?.$destroy();
  control = null;
  document.body.innerHTML = '';
});

function mount(props: { shownZone?: string | null; chosenZone?: string | null } = {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const choose = vi.fn();
  control = new FileZoneControl({
    target,
    props: {
      fileName: 'middleware.log',
      shownZone: props.shownZone === undefined ? 'UTC' : props.shownZone,
      chosenZone: props.chosenZone ?? null,
      choose,
    },
  });
  const trigger = () => target.querySelector<HTMLButtonElement>('button[aria-haspopup]')!;
  const popup = () => target.querySelector<HTMLElement>('[role="dialog"]');
  const field = () => popup()?.querySelector<HTMLInputElement>('input') ?? null;
  const options = () => [...(popup()?.querySelectorAll<HTMLButtonElement>('[data-zone]') ?? [])];
  const zones = () => options().map((o) => o.dataset.zone);
  const reset = () => popup()?.querySelector<HTMLButtonElement>('[data-own-zone]') ?? null;
  return { target, choose, trigger, popup, field, options, zones, reset };
}

async function openPicker(view: ReturnType<typeof mount>) {
  view.trigger().click();
  await tick();
  await tick();
}

async function type(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await tick();
}

async function keyDown(element: HTMLElement, key: string) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key });
  element.dispatchEvent(event);
  await tick();
  return event;
}

describe('FileZoneControl', () => {
  it('shows the zone the file is shown in, unmarked, with the picker closed', () => {
    const view = mount({ shownZone: '+02:00' });

    expect(view.trigger().textContent?.trim()).toBe('+02:00');
    expect(view.trigger().dataset.chosen).toBeUndefined();
    expect(view.trigger().getAttribute('aria-expanded')).toBe('false');
    expect(view.trigger().getAttribute('aria-label')).toContain('middleware.log');
    expect(view.popup()).toBeNull();
  });

  it('marks a chosen zone', () => {
    const view = mount({ shownZone: 'Europe/Berlin', chosenZone: 'Europe/Berlin' });

    expect(view.trigger().textContent?.trim()).toBe('Europe/Berlin');
    expect(view.trigger().dataset.chosen).toBe('true');
    expect(view.trigger().getAttribute('aria-label')).toContain('chosen');
  });

  it('opens a labelled picker with the common zones and the filter field focused', async () => {
    const view = mount();

    await openPicker(view);

    expect(view.trigger().getAttribute('aria-expanded')).toBe('true');
    expect(view.popup()?.getAttribute('aria-label')).toContain('middleware.log');
    expect(view.zones()).toContain('Europe/Berlin');
    expect(view.zones()).toContain('UTC');
    expect(document.activeElement).toBe(view.field());
  });

  it('chooses a listed zone and closes', async () => {
    const view = mount();
    await openPicker(view);

    view
      .options()
      .find((o) => o.dataset.zone === 'Europe/Berlin')!
      .click();
    await tick();

    expect(view.choose).toHaveBeenCalledWith('Europe/Berlin');
    expect(view.popup()).toBeNull();
    expect(document.activeElement).toBe(view.trigger());
  });

  it('filters the zones and chooses the first one on Enter', async () => {
    const view = mount();
    await openPicker(view);

    await type(view.field()!, 'new york');
    expect(view.zones()).toEqual(['America/New_York']);
    await keyDown(view.field()!, 'Enter');

    expect(view.choose).toHaveBeenCalledWith('America/New_York');
  });

  it('offers a typed offset and chooses it on Enter', async () => {
    const view = mount();
    await openPicker(view);

    await type(view.field()!, '+05:30');
    expect(view.zones()).toEqual(['+05:30']);
    await keyDown(view.field()!, 'Enter');

    expect(view.choose).toHaveBeenCalledWith('+05:30');
  });

  it('says how to write an offset it cannot read, and chooses nothing on Enter', async () => {
    const view = mount();
    await openPicker(view);

    await type(view.field()!, '+19:00');
    await keyDown(view.field()!, 'Enter');

    expect(view.zones()).toEqual([]);
    expect(view.popup()?.textContent).toContain('±HH:MM');
    expect(view.choose).not.toHaveBeenCalled();
  });

  it('resets a chosen zone to the file own one', async () => {
    const view = mount({ shownZone: 'Europe/Berlin', chosenZone: 'Europe/Berlin' });
    await openPicker(view);

    view.reset()!.click();
    await tick();

    expect(view.choose).toHaveBeenCalledWith(null);
  });

  it('offers no reset while the file is read in its own zone', async () => {
    const view = mount();
    await openPicker(view);

    expect(view.reset()?.disabled).toBe(true);
  });

  it('moves through the zones with the arrow keys', async () => {
    const view = mount();
    await openPicker(view);

    await keyDown(view.field()!, 'ArrowDown');
    expect(document.activeElement).toBe(view.options()[0]);
    await keyDown(view.options()[0], 'ArrowDown');
    expect(document.activeElement).toBe(view.options()[1]);
    await keyDown(view.options()[1], 'ArrowUp');
    await keyDown(view.options()[0], 'ArrowUp');
    expect(document.activeElement).toBe(view.field());
  });

  it('closes on Escape and gives the focus back to its button', async () => {
    const view = mount();
    await openPicker(view);

    const event = await keyDown(view.field()!, 'Escape');

    expect(event.defaultPrevented).toBe(true);
    expect(view.popup()).toBeNull();
    expect(document.activeElement).toBe(view.trigger());
    expect(view.choose).not.toHaveBeenCalled();
  });

  it('closes on a press outside it', async () => {
    const view = mount();
    await openPicker(view);

    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    await tick();

    expect(view.popup()).toBeNull();
  });
});
