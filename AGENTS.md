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

| Repo                    | Role                                                                       |
| ----------------------- | -------------------------------------------------------------------------- |
| `rx-go`                 | Flagship backend. Reference for the HTTP wire contract. Default port 7777. |
| `rx-python`             | Second backend, drop-in replacement for rx-go. Default port 8000.          |
| `rx-viewer` (this repo) | Must work against both backends with no code change.                       |

`rx-rust` also exists beside them. It is frozen. Do not target it.

## Parity rules (binding)

1. **Target the contract, not a backend.** The wire contract is rx-go's
   OpenAPI document, published at `rx-go/docs/api/openapi.json`. The wire
   types are **generated** from it into `src/lib/types.generated.ts` by
   `just gen-types`, and `src/lib/types.ts` aliases them — so they cannot
   drift. `just ci` runs `types-check` and fails when the generated file is
   stale. Never hand-edit a wire type; regenerate.
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
7. **Check the contract version.** `/health` reports `contract_version`
   (MAJOR.MINOR). `src/lib/utils/contractVersion.ts` holds the major this
   viewer supports; a different major is refused in the status bar rather
   than misread. Bump it together with both backends' constants.

## Quick orientation

| Where                                                             | What                                                                                    |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `src/main.ts`, `src/App.svelte`                                   | Entry point and root layout                                                             |
| `src/lib/api.ts`                                                  | The entire backend surface: one `api` object, `fetchJson`, `ApiError`                   |
| `src/lib/types.generated.ts`                                      | Generated from rx-go's OpenAPI document — do not edit                                   |
| `src/lib/types.ts`                                                | Aliases of the generated wire types, plus the app's own types                           |
| `src/lib/stores/`                                                 | `files`, `tree`, `trace`, `health`, `detectors`, `settings`, `notifications`, `version` |
| `src/lib/utils/regexFilter.ts`                                    | Regex filter engine (hide, show, highlight)                                             |
| `src/lib/utils/urlState.ts`                                       | URL to app-state persistence (no router)                                                |
| `src/lib/utils/monacoLanguage.ts`, `monacoLogLanguage.ts`         | Monaco language registration and the log grammar                                        |
| `src/components/editor/`                                          | `MonacoEditor.svelte`, `EditorPane.svelte` (paged large-file viewing)                   |
| `src/components/tree/`, `search/`, `trace/`, `layout/`, `common/` | Tree, search panel, results, chrome, shared widgets                                     |
| `vite.config.ts`                                                  | Dev proxy `/v1` → `localhost:8080`; Monaco manual chunk                                 |
| `.github/workflows/`                                              | `ci.yml` (build) and `build-release.yml` (tag → `dist.tar.gz` release)                  |

## Build, run, test

`just` is the entrypoint. `just --list` shows every recipe.

```bash
just install                      # bun install --frozen-lockfile
just dev                          # dev server :5173, proxies /v1 to localhost:8080
just build                        # production build → dist/ (+ version.json)
just package                      # dist.tar.gz + .sha256, the way a release does
just preview

just gen-types                    # regenerate the wire types from rx-go's spec
just fmt                          # prettier --write
just fmt-check                    # prettier --check (CI gate)
just typecheck                    # svelte-check
just lint                         # eslint
just test                         # vitest run

just ci                           # exactly what GitHub CI runs
just check                        # ci + package + audit
```

`just ci` is `fmt-check types-check typecheck lint test build`, in that order, and
`.github/workflows/ci.yml` runs `just ci` — the two cannot disagree.

Run a backend on the proxy port first: `rx serve --port=8080 --search-root=/var/log`
(rx-go or rx-python). Bun is the package manager; Node is not used for tooling.
A `Dockerfile` builds without a host Bun install.

**`just typecheck` is red today**: `svelte-check` reports 4 errors that
predate the gate (a Monaco option name, a missing `prismjs` declaration, one
`number | null`). They are tracked in `../tickets/`; do not add more.

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
just ci
```

Paste the output.

## Git, changelog, release

- Commit: one imperative sentence, capital, full stop, no prefix, no body.
- Version comes from the git tag. `package.json` stays at `0.0.0`; the build
  stamps `git describe` into `dist/version.json` and into the
  `__RX_VIEWER_VERSION__` define. Do not commit a real version.
- Release: `just release-dry patch` previews, `just release patch` runs the
  gates, promotes the changelog, commits and tags, then prints the push
  commands rather than running them. Pushing the tag runs `release.yml`,
  which builds with a frozen lockfile, packages `dist/` with `index.html` at
  the archive root, and publishes `dist.tar.gz` with its `.sha256` sidecar.
  Backends verify that sidecar and only install a version inside their
  supported range, so a minor bump needs a matching backend release.
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
- Do not hand-edit `types.generated.ts` or write a wire type by hand — run
  `just gen-types`.
- Do not treat `relative_line_number` as absolute when `file_chunks` is not 1.
- Do not load a whole file into the editor.
- Do not add CDN scripts or styles.
- Do not use `{@html}` or `innerHTML` for file content.
- Do not commit a real version into `package.json`.
- Do not silence a warning class in the build config.
