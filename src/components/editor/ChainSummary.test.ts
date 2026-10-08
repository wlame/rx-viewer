// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import type { ChainPart, ChainResponse, ChainTab } from '$lib/types';
import ChainSummary from './ChainSummary.svelte';

function part(name: string, fields: Partial<ChainPart> = {}): ChainPart {
  return {
    name,
    path: `/l/${name}`,
    is_active: false,
    key: null,
    compression_format: null,
    size: 100,
    modified_at: '2026-10-01T00:00:00.000000Z',
    is_indexed: true,
    line_count: 10,
    first_ms: null,
    last_ms: null,
    max_ms: null,
    max_is_bound: false,
    global_start: null,
    time_format: null,
    day_first: null,
    example: null,
    duplicates: [],
    ...fields,
  };
}

function chainTab(description: Partial<ChainResponse>, fields: Partial<ChainTab> = {}): ChainTab {
  return {
    handle: '/l/app.log',
    description: {
      path: '/l/app.log',
      name: 'app.log',
      state: 'ready',
      reasons: [],
      fingerprint: '0123456789abcdef',
      parts: [
        part('app.log.2', { is_indexed: false }),
        part('app.log.1'),
        part('app.log', { is_active: true }),
      ],
      missing: [],
      missing_count: 0,
      gaps: [],
      first_ms: null,
      last_ms: null,
      frozen_line_count: null,
      line_count: null,
      index_build: null,
      index_build_refused: null,
      cli_command: 'rx logs show /l/app.log',
      ...description,
    },
    numbering: 'global',
    bases: new Map(),
    counts: new Map(),
    anchor: null,
    indexTask: null,
    indexProblem: null,
    buildRefused: null,
    invalidDetail: null,
    ...fields,
  };
}

let summary: ChainSummary | null = null;

function mount(chain: ChainTab): string {
  const target = document.createElement('div');
  document.body.appendChild(target);
  summary = new ChainSummary({ target, props: { chain } });
  return target.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

afterEach(() => {
  summary?.$destroy();
  summary = null;
  document.body.replaceChildren();
});

describe('ChainSummary', () => {
  it('shows a ready chain state, its lines, its time range and its parts', () => {
    const text = mount(
      chainTab({
        line_count: 1500,
        first_ms: Date.UTC(2026, 9, 1),
        last_ms: Date.UTC(2026, 9, 2),
      }),
    );

    expect(text).toContain('ready');
    expect(text).toContain(`${(1500).toLocaleString()} lines`);
    expect(text).toContain('2026-10-01T00:00:00.000Z – 2026-10-02T00:00:00.000Z');
    expect(text).toContain('3 parts');
  });

  it('shows the frozen lines and an ellipsis while the active part is not counted', () => {
    expect(mount(chainTab({ frozen_line_count: 20 }))).toContain('20… lines');
  });

  it('shows how far the index task of a pending chain has got', () => {
    const text = mount(
      chainTab(
        { state: 'pending' },
        { numbering: 'local', indexTask: { taskId: 't', progress: 0.5 } },
      ),
    );

    expect(text).toContain('pending');
    expect(text).toContain('indexing 1/2 parts · 50%');
  });

  it('says a pending chain waits for an index task, with the backend reason in its tooltip', () => {
    const chain = chainTab({ state: 'pending' }, { buildRefused: 'no place for its task' });
    const text = mount(chain);

    expect(text).toContain('waiting for an index task');
    expect(document.querySelector('[title="no place for its task"]')).not.toBeNull();
  });

  it('names the gaps and the missing parts, and the reasons of an invalid chain', () => {
    const gaps = [{ after: 'app.log.2', before: 'app.log.1', from_ms: 1, to_ms: 2 }];
    expect(mount(chainTab({ gaps, missing: ['app.log.3'], missing_count: 1 }))).toContain(
      '1 gap · 1 missing',
    );
    summary?.$destroy();

    const reasons = [
      { code: 'overlap' as const, parts: [], message: 'they overlap', overlap_ms: 5 },
    ];
    expect(mount(chainTab({ state: 'invalid', reasons }))).toContain('invalid: overlap');
  });
});
