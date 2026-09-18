# AGENTS.md — rx-viewer

Instructions for AI coding agents working in this repository. If a sibling
checkout exists at `../AGENTS.md`, read it first: it holds the rules that bind
this repo to the backends. The ones that bind this repo are repeated below so
this file stands alone.

## What this is

`rx-viewer` is the single shared web frontend for `rx` (Regex Tracer): a
Svelte 4 + TypeScript + Monaco SPA for browsing, searching and inspecting very
large log files through an `rx` backend's HTTP API.

It is a standalone artifact. It builds to a static `dist/`, is published as
`dist.tar.gz` on GitHub Releases, and every backend downloads it at runtime,
caches it under `~/.cache/rx/frontend/` and serves it. One frontend, two
interchangeable backends, no vendoring.

| Repo                    | Role                                                                              |
| ----------------------- | --------------------------------------------------------------------------------- |
| `rx-go`                 | The focus. Reference for the HTTP wire contract. Default port 7777.               |
| `rx-python`             | The original backend. **Paused** since 2026-10-02. Default port 7777.             |
| `rx-viewer` (this repo) | Works against rx-go; against rx-python on a best-effort basis while it is paused. |

`rx-rust` also exists beside them. It is frozen. Do not target it.

## Parity rules (binding)

1. **Target the contract, not a backend.** The wire contract is rx-go's
   OpenAPI document, published at `rx-go/docs/api/openapi.json`. The wire
   types are **generated** from it into `src/lib/types.generated.ts` by
   `just gen-types`, and `src/lib/types.ts` aliases them — so they cannot
   drift. `just ci` runs `types-check` and fails when the generated file is
   stale. Never hand-edit a wire type; regenerate.
2. **Never call an endpoint that only one backend has** without a capability
   check. Both backends implement `/health`, `/v1/tree`, `/v1/samples`,
   `/v1/trace`, `/v1/index` (GET and POST), `/v1/tasks/{id}` and
   `/v1/detectors`. `/v1/complexity` exists only in rx-python; this app does
   not call it. An endpoint rx-go adds while rx-python is paused is
   rx-go-only until rx-python catches up: check for it before calling it.
3. **Never hardcode detector names, category names or ports.** Detector sets
   differ between backends. Drive the UI from the live `/v1/detectors`
   response (`src/lib/stores/detectors.ts`).
4. **Respect `file_chunks`.** In a trace response `file_chunks` is a
   `{file_id: chunk_count}` map. `relative_line_number` is absolute only when
   the count is 1. `absolute_line_number` is `-1` when unknown. When it is
   unknown, resolve the position through `/v1/samples` by byte offset, which is
   always absolute.
5. **Test against rx-go before a release.** Start it with `--port=8080`, run
   the app, and exercise tree, open file, search, jump to result, index and
   detectors. A viewer release changes behaviour for every installed backend
   on its next cache refresh. rx-python is paused: test against it only when
   the owner asks, and record a difference you find in
   `../tickets/PARITY-DEBT.md`.
6. **Release order:** a viewer change that needs a new backend field ships
   after rx-go has released that field.
7. **Check the contract version.** `/health` reports `contract_version`
   (MAJOR.MINOR). `src/lib/utils/contractVersion.ts` holds the major this
   viewer supports. A different major is refused rather than misread: a
   blocking message names both versions, and `src/lib/contractGate.ts`
   holds every `/v1` request (the first ones wait for the first `/health`
   answer) until `/health`, asked every 10 s meanwhile, reports a
   supported major. Every request goes through `fetchJson`, so it passes
   the gate; do not call `fetch` for `/v1` directly. Bump it together with rx-go's `ContractVersion`. A
   feature a later minor added — the trace matching flags of 1.3 — is
   listed in `CONTRACT_FEATURES` there; check `contractSupports()` before
   using it, since an older backend ignores what it does not know.

## Quick orientation

| Where                                                     | What                                                                                                                                               |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main.ts`, `src/App.svelte`                           | Entry point and root layout                                                                                                                        |
| `src/lib/api.ts`                                          | The entire backend surface: one `api` object, `fetchJson`, `ApiError`                                                                              |
| `src/lib/types.generated.ts`                              | Generated from rx-go's OpenAPI document — do not edit                                                                                              |
| `src/lib/types.ts`                                        | Aliases of the generated wire types, plus the app's own types                                                                                      |
| `src/lib/stores/`                                         | `files`, `tree`, `trace`, `health`, `detectors`, `settings`, `notifications`, `version`, `layout`; `paneMemory` keeps each file tab's editor state |
| `src/lib/utils/processContent.ts`, `editorDecorations.ts` | The editor's regex filter: hide and show rewrite the text, highlight draws decorations                                                             |
| `src/lib/utils/urlState.ts`, `src/lib/viewState.ts`       | The view in the URL (no router): one parse/serialize table per key; URL written from stores                                                        |
| `src/lib/utils/monacoLanguage.ts`, `monacoLogLanguage.ts` | Monaco language registration and the log grammar                                                                                                   |
| `src/components/editor/`                                  | `MonacoEditor.svelte`, `EditorPane.svelte` (paged large-file viewing)                                                                              |
| `src/components/tree/`, `search/`, `layout/`, `common/`   | Tree, search form and results, chrome, shared widgets                                                                                              |
| `vite.config.ts`                                          | Dev proxy `/v1`, `/health` → `localhost:8080`; Monaco manual chunk                                                                                 |
| `.github/workflows/`                                      | `ci.yml` (build) and `build-release.yml` (tag → `dist.tar.gz` release)                                                                             |

## Build, run, test

`just` is the entrypoint. `just --list` shows every recipe.

```bash
just install                      # bun install --frozen-lockfile
just dev                          # dev server :5173, proxies /v1 and /health to localhost:8080
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
(rx-go). Bun is the package manager; Node is not used for tooling.
Every recipe runs bun from the `PATH` when it is installed and from the
`oven/bun` image when it is not, so the gates run on a host that keeps no
JavaScript runtime. `just bun <args>` runs any other bun command the same
way, and `just shell` opens the image.

**`just typecheck` is green and must stay that way.** `svelte-check` reports
0 errors and 0 warnings. The a11y suppression that used to hide warnings is
gone from `vite.config.ts`; fix a warning rather than filtering it. A
`svelte-ignore` takes bare rule names on one line — put the justification in a
separate comment above, or eslint reads every word as another rule.

## Architecture notes

- Svelte 4 stores, no router. The view a link should restore lives in the
  URL: `urlState.ts` reads and writes every key from one table and is the
  only module that writes the view to `history` (`apiToken.ts` only strips
  the token); `viewState.ts` writes the URL from the stores and restores
  the stores from a URL. A component never writes the URL. A change of a
  key that is a step (open a file, run a search, switch the sidebar tab)
  is a `pushState`, every other change a `replaceState`, and `popstate`
  restores the entry. `line` is the file's anchor line, whose rule is in
  `utils/anchorLine.ts`.
- The status bar's equivalent command comes from `stores/commands.ts`,
  which records the backend's `cli_command` of each answer to a user
  action (search, file window, index, analysis). Record a new action's
  command there; never build a command in the viewer.
- Every keyboard shortcut and mouse gesture is a row of one table,
  `src/lib/utils/shortcuts.ts`. The key handlers ask it whether a key is
  theirs and the help dialog (Cmd/Ctrl+/) lists it, so add a shortcut
  there, never as a bare `event.key` check. A handler calls
  `preventDefault` only when it acted.
- Monaco is code-split into its own chunk (about 3.3 MB, 860 KB gzip). Check the
  bundle delta before adding Monaco features.
- Large files are never loaded whole. The editor requests windows through
  `/v1/samples` by line range or byte offset. A feature that needs "the whole
  file" is wrong by construction. An open file holds at most `HELD_PAGES`
  pages (`src/lib/utils/slidingWindow.ts`): a page loaded at one end drops
  lines at the other, and the editor keeps the file line at the top of the
  view in place when lines come or go above it.
- Content is set with Monaco `setValue`, never `innerHTML` or `{@html}`. Log
  content is untrusted.
- The app ships with no third-party runtime requests. Do not add a CDN script
  or stylesheet; bundle it.
- The API token (a backend started with `RX_API_TOKEN`) arrives as
  `#token=…` in the link, is moved to `sessionStorage` and stripped from the
  address bar on load (`src/lib/utils/apiToken.ts`), and is sent as
  `Authorization: Bearer …` on every request. `sessionStorage`, not memory
  only: a script in the page could read either (it could wrap `fetch`), and
  memory would lose the token on every reload. Not `localStorage`: it would
  outlive the tab. A 401 opens `TokenPrompt.svelte`.

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

- Unit tests with `vitest` for the pure modules: `processContent.ts`,
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
  stamps `git describe` into `dist/version.json`, which the header reads.
  Do not commit a real version.
- Release: `just release-dry patch` previews, `just release patch` runs the
  gates, promotes the changelog, commits and tags, then prints the push
  commands rather than running them. Pushing the tag runs `release.yml`,
  which builds with a frozen lockfile, packages `dist/` with `index.html` at
  the archive root, and publishes `dist.tar.gz` with its `.sha256` sidecar.
  Backends verify that sidecar and only install a version inside their
  supported range, so a minor bump needs a matching backend release.
- **A minor bump is not released until rx-go accepts it.** Each backend
  hardcodes the window it was checked against — `MaxViewerVersionExclusive`
  in `rx-go/internal/frontend/compat.go` and `MAX_VIEWER_VERSION_EXCLUSIVE`
  in `rx-python/src/rx/frontend_manager.py`. Publish a viewer past the
  window and that backend refuses to install it: `rx serve` comes up with
  no interface and redirects to its API docs, which is how v0.3.0 shipped
  on 2026-09-03 against backends that stopped at 0.2.x. Widen rx-go's
  constant, with its test, and release rx-go before you cut the viewer
  release. rx-python's window stays where it is while it is paused; add a
  `../tickets/PARITY-DEBT.md` row instead.
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
- On the macOS host the recipes run in Docker, and right after a file is
  written on the host the container can still read the old copy:
  prettier has reported a just-formatted file as unformatted, and vitest
  has failed to load a module it read the next second. Run the check
  again before believing a failure that follows an edit, and chain a
  commit on the checks with `&&`, never `;`.
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
