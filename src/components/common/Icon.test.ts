// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { ICONS, type IconName } from '$lib/utils/icons';
import Icon from './Icon.svelte';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

let mounted: Icon | null = null;

function mount(props: { name: IconName; size?: number; class?: string }): SVGSVGElement {
  const target = document.createElement('div');
  document.body.appendChild(target);
  mounted = new Icon({ target, props });
  const svg = target.querySelector('svg');
  if (!svg) throw new Error('the icon drew no svg');
  return svg;
}

afterEach(() => {
  mounted?.$destroy();
  mounted = null;
  document.body.replaceChildren();
});

describe('Icon', () => {
  it.each(Object.keys(ICONS) as IconName[])(
    'draws %s as a hidden svg with one element per shape',
    (name) => {
      const svg = mount({ name });

      expect(svg.getAttribute('aria-hidden')).toBe('true');
      expect(svg.getAttribute('focusable')).toBe('false');
      expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
      expect(svg.children).toHaveLength(ICONS[name].length);
      [...svg.children].forEach((child, i) => {
        expect(child.tagName).toBe(ICONS[name][i].tag);
        expect(child.namespaceURI).toBe(SVG_NAMESPACE);
      });
    },
  );

  it('draws outlines in the text colour', () => {
    const svg = mount({ name: 'layers' });

    expect(svg.getAttribute('fill')).toBe('none');
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.getAttribute('stroke-width')).toBe('2');
    expect(svg.getAttribute('stroke-linecap')).toBe('round');
    expect(svg.getAttribute('stroke-linejoin')).toBe('round');
  });

  it('copies each shape attribute', () => {
    const svg = mount({ name: 'search' });

    const circle = svg.querySelector('circle');
    expect(circle?.getAttribute('cx')).toBe(ICONS.search[1].attrs.cx);
    expect(circle?.getAttribute('r')).toBe(ICONS.search[1].attrs.r);
  });

  it('is 16 pixels square unless a size is given, and takes a class', () => {
    expect(mount({ name: 'tag' }).getAttribute('width')).toBe('16');

    const svg = mount({ name: 'tag', size: 20, class: 'text-gh-fg-muted' });

    expect(svg.getAttribute('width')).toBe('20');
    expect(svg.getAttribute('height')).toBe('20');
    expect(svg.getAttribute('class')).toBe('text-gh-fg-muted');
  });
});
