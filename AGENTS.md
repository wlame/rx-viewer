# AGENTS.md — rx-viewer

Instructions for AI coding agents working in this repository. If a sibling
checkout exists at `../AGENTS.md`, read it first: it holds the parity rules that
bind this repo to the two backends. The same rules are repeated below so this
file stands alone.

## What this is

`rx-viewer` is the single shared web frontend for `rx` (Regex Tracer): a
Svelte 4 + TypeScript + Monaco SPA for browsing, searching and inspecting very
large log files through an `rx` backend's HTTP API.

It is a standalone artifact. It builds to a static `dist/`, is published as
`dist.tar.gz` on GitHub Releases, and every backend downloads it at runtime,
caches it under `~/.cache/rx/frontend/` and serves it. One frontend, two
interchangeable backends, no vendoring.

| Repo | Role |
|---|---|
| `rx-go` | Flagship backend. Reference for the HTTP wire contract. Default port 7777. |
| `rx-python` | Second backend, drop-in replacement for rx-go. Default port 8000. |
| `rx-viewer` (this repo) | Must work against both backends with no code change. |

`rx-rust` also exists beside them. It is frozen. Do not target it.

## Parity rules (binding)

1. **Target the contract, not a backend.** The wire contract is rx-go's
   OpenAPI document (`rx-go/internal/webapi/testdata/openapi.golden.json`).
   `src/lib/types.ts` mirrors it. When a field is missing in `types.ts`, add it
   from the spec; never invent a shape.
2. **Never call an endpoint that only one backend has** without a capability
   check. Today both backends implement `/health`, `/v1/tree`, `/v1/samples`,
   `/v1/trace`, `/v1/index` (GET and POST), `/v1/tasks/{id}` and
   `/v1/detectors`. `/v1/complexity` exists only in rx-python; this app does
   not call it.
3. **Never hardcode detector names, category names or ports.** Detector sets
   differ between backends. Drive the UI from the live `/v1/detectors`
   response (`src/lib/stores/detectors.ts`).
4. **Respect `file_chunks`.** In a trace response `file_chunks` is a
   `{file_id: chunk_count}` map. `relative_line_number` is absolute only when
   the count is 1. `absolute_line_number` is `-1` when unknown. When it is
   unknown, resolve the position through `/v1/samples` by byte offset, which is
   always absolute.
5. **Test against both backends before a release.** Start each backend with
   `--port=8080`, run the app, and exercise tree, open file, search, jump to
   result, index and detectors. A viewer release changes behaviour for every
   installed backend on its next cache refresh.
6. **Release order:** a viewer change that needs a new backend field ships
   after both backends have released that field.

## Quick orientation

| Where | What |
|---|---|
| `src/main.ts`, `src/App.svelte` | Entry point and root layout |
| `src/lib/api.ts` | The entire backend surface: one `api` object, `fetchJson`, `ApiError` |
| `src/lib/types.ts` | TypeScript mirror of the wire schema |
| `src/lib/stores/` | `files`, `tree`, `trace`, `health`, `detectors`, `settings`, `notifications`, `version` |
| `src/lib/utils/regexFilter.ts` | Regex filter engine (hide, show, highlight) |
| `src/lib/utils/urlState.ts` | URL to app-state persistence (no router) |
| `src/lib/utils/monacoLanguage.ts`, `monacoLogLanguage.ts` | Monaco language registration and the log grammar |
| `src/components/editor/` | `MonacoEditor.svelte`, `EditorPane.svelte` (paged large-file viewing) |
| `src/components/tree/`, `search/`, `trace/`, `layout/`, `common/` | Tree, search panel, results, chrome, shared widgets |
| `vite.config.ts` | Dev proxy `/v1` → `localhost:8080`; Monaco manual chunk |
| `.github/workflows/` | `ci.yml` (build) and `build-release.yml` (tag → `dist.tar.gz` release) |

## Build, run, test

```bash
bun install --frozen-lockfile     # install from the committed bun.lock
bun run dev                       # dev server :5173, proxies /v1 to localhost:8080
bun run check                     # svelte-check type check
bun run build                     # production build → dist/
bun run preview
```

Run a backend on the proxy port first: `rx serve --port=8080 --search-root=/var/log`
(rx-go or rx-python). Bun is the package manager; Node is not used for tooling.
A `Dockerfile` builds without a host Bun install.

The `justfile`, lint (`prettier` + `eslint`), `vitest` suite, and the release
recipe with a sha256 sidecar described in `../release-toolchain-reference.md`
are tracked in `../tickets/08-ci-release-toolchain.md`. When they exist,
prefer `just ci`.

## Architecture notes

- Svelte 4 stores, no router. Navigation state lives in the URL via `urlState.ts`.
- Monaco is code-split into its own chunk (about 3.3 MB, 860 KB gzip). Check the
  bundle delta before adding Monaco features.
- Large files are never loaded whole. The editor requests windows through
  `/v1/samples` by line range or byte offset. A feature that needs "the whole
  file" is wrong by construction.
- Content is set with Monaco `setValue`, never `innerHTML` or `{@html}`. Log
  content is untrusted.
- The app ships with no third-party runtime requests. Do not add a CDN script
  or stylesheet; bundle it.

## Coding standards

- TypeScript strict; `svelte-check` must pass with zero errors.
- Keep components under about 400 lines; split by responsibility (search,
  go-to-line, filter, rendering).
- Every request that can be superseded (file window loads, searches) carries an
  `AbortController` and a sequence number; a stale response is dropped.
- Do not suppress warning classes globally. Fix or annotate accessibility
  findings one by one.
- Long flags use `=` in docs and printed commands.
- Comments describe the code as it is. No references to plans or review rounds.

## Testing

- Unit tests with `vitest` for the pure modules: `regexFilter.ts`,
  `urlState.ts`, `format.ts`, `monacoLogLanguage.ts`, `api.ts` with a stubbed
  `fetch`, and the line-number resolution logic in the search flow.
- Names: `describe(unit) / it("scenario returns expected")`.
- End-to-end smoke against a real backend is manual until a Playwright job
  exists; record the manual check in the pull request or final report.
- The completion gate before you say "done":

```bash
bun run check && bun run build
```

(plus `bun run lint` and `bun run test` once they exist). Paste the output.

## Git, changelog, release

- Commit: one imperative sentence, capital, full stop, no prefix, no body.
- Version comes from the git tag. `package.json` stays at `0.0.0`; the release
  workflow stamps the tag into `dist/version.json`. Do not commit a real version.
- Release: tag `vX.Y.Z` on `main` from a clean tree. The workflow builds with a
  frozen lockfile, packages `dist/` with `index.html` at the archive root,
  publishes `dist.tar.gz` and its `.sha256` sidecar. Backends verify the sidecar.
- rx-go keeps a real bundle as a test fixture
  (`rx-go/internal/webapi/testdata/rx-viewer-v0.2.0-dist.tar.gz`). If the bundle
  layout changes, refresh that fixture in rx-go.
- Never push. Working files go in the gitignored `.claude/`.

## Gotchas

- A partially installed `node_modules` makes `svelte-check` fail with
  `Cannot find module`; re-run `bun install`. A `node_modules` copied from
  macOS does not work on Linux.
- `dist/` and `dist.tar.gz` are gitignored; the workflow produces them.
- Relative asset paths must stay relative; backends serve the app from a cache
  directory with an SPA fallback.
- `/health` accepts a `client` query parameter; `clientId.ts` generates it.
- Backend responses use `file` and `pattern` IDs (`f1`, `p1`) with lookup maps
  in the response, not paths, to keep payloads small.

## Open work

Audit tickets live in `../tickets/` (outside this repo). Read
`../tickets/README.md` before taking one. Do not create a "known issues" list
in this file; file a ticket.

## What NOT to do

- Do not hardcode detector names, category names or ports.
- Do not call an endpoint one backend lacks without a capability check.
- Do not change a wire type in `types.ts` away from the spec.
- Do not treat `relative_line_number` as absolute when `file_chunks` is not 1.
- Do not load a whole file into the editor.
- Do not add CDN scripts or styles.
- Do not use `{@html}` or `innerHTML` for file content.
- Do not commit a real version into `package.json`.
- Do not silence a warning class in the build config.
