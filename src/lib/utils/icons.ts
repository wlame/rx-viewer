/**
 * The shapes below are copied from Lucide (lucide-static v1.54.0,
 * https://lucide.dev), under this licence:
 *
 * ISC License
 *
 * Copyright (c) 2026 Lucide Icons and Contributors
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
 * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 *
 * Lucide derives `search`, `arrow-up` and `arrow-down` from the Feather
 * project, under this licence:
 *
 * The MIT License (MIT)
 *
 * Copyright (c) 2013-present Cole Bemis
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

/**
 * The viewer's icons, as data. Each icon is a list of SVG shapes on a
 * 24×24 grid, drawn as outlines in the text colour (stroke width 2,
 * round caps and joins) by `components/common/Icon.svelte`. Add an icon
 * by adding its name to `IconName` and its shapes to `ICONS`.
 */

export type IconName =
  'files' | 'search' | 'keyboard' | 'layers' | 'tag' | 'square-stack' | 'arrow-up' | 'arrow-down';

/** One SVG element of an icon: its tag and its attributes, as written. */
export interface IconShape {
  tag: 'path' | 'circle' | 'rect' | 'line' | 'polyline';
  attrs: Readonly<Record<string, string>>;
}

export const ICONS: Readonly<Record<IconName, readonly IconShape[]>> = {
  files: [
    { tag: 'path', attrs: { d: 'M15 2h-4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8' } },
    {
      tag: 'path',
      attrs: { d: 'M16.706 2.706A2.4 2.4 0 0 0 15 2v5a1 1 0 0 0 1 1h5a2.4 2.4 0 0 0-.706-1.706z' },
    },
    { tag: 'path', attrs: { d: 'M5 7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 1.732-1' } },
  ],
  search: [
    { tag: 'path', attrs: { d: 'm21 21-4.34-4.34' } },
    { tag: 'circle', attrs: { cx: '11', cy: '11', r: '8' } },
  ],
  keyboard: [
    { tag: 'path', attrs: { d: 'M10 8h.01' } },
    { tag: 'path', attrs: { d: 'M12 12h.01' } },
    { tag: 'path', attrs: { d: 'M14 8h.01' } },
    { tag: 'path', attrs: { d: 'M16 12h.01' } },
    { tag: 'path', attrs: { d: 'M18 8h.01' } },
    { tag: 'path', attrs: { d: 'M6 8h.01' } },
    { tag: 'path', attrs: { d: 'M7 16h10' } },
    { tag: 'path', attrs: { d: 'M8 12h.01' } },
    { tag: 'rect', attrs: { width: '20', height: '16', x: '2', y: '4', rx: '2' } },
  ],
  layers: [
    {
      tag: 'path',
      attrs: {
        d: 'M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z',
      },
    },
    {
      tag: 'path',
      attrs: { d: 'M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12' },
    },
    {
      tag: 'path',
      attrs: { d: 'M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17' },
    },
  ],
  tag: [
    {
      tag: 'path',
      attrs: {
        d: 'M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z',
      },
    },
    { tag: 'circle', attrs: { cx: '7.5', cy: '7.5', r: '.5', fill: 'currentColor' } },
  ],
  'square-stack': [
    { tag: 'path', attrs: { d: 'M4 10c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h4c1.1 0 2 .9 2 2' } },
    { tag: 'path', attrs: { d: 'M10 16c-1.1 0-2-.9-2-2v-4c0-1.1.9-2 2-2h4c1.1 0 2 .9 2 2' } },
    { tag: 'rect', attrs: { width: '8', height: '8', x: '14', y: '14', rx: '2' } },
  ],
  'arrow-up': [
    { tag: 'path', attrs: { d: 'm5 12 7-7 7 7' } },
    { tag: 'path', attrs: { d: 'M12 19V5' } },
  ],
  'arrow-down': [
    { tag: 'path', attrs: { d: 'M12 5v14' } },
    { tag: 'path', attrs: { d: 'm19 12-7 7-7-7' } },
  ],
};
