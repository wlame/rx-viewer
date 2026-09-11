# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- The `just` recipes run bun from the `oven/bun` image when bun is not
  on the `PATH`, mounting the directory that holds this repo so
  `../rx-go` still resolves for the generated types. A host that keeps no
  JavaScript runtime now runs `just ci` with Docker alone. `just dev`
  takes a port, `just bun` runs any other bun command and `just shell`
  opens the image; in Docker the dev server reaches the backend through
  `host.docker.internal`, and `RX_DEV_PROXY_TARGET` overrides the target.

- The generated types mark `modified_at` as `date-time`. Both backends
  now render it as RFC 3339 in UTC; the viewer does not format the field
  today, so nothing else changed.

- The generated types no longer declare `$schema`. rx-go stopped
  putting the field in its response bodies, so it is gone from the
  OpenAPI document the types are generated from. Nothing in the viewer
  read it.

- The search panel resolves up to 200 unknown line numbers per file
  eagerly, up from 20. The cap existed because each offset cost the
  backend a separate scan of the file; both backends now answer a whole
  batch from one pass, so what the number bounds is the response payload,
  not the work.

### Added

- A path outside the server's search roots is reported as a sentence
  naming the path and listing the roots that would have been accepted,
  instead of the machine code the backends now put in `detail`.
  `src/lib/utils/sandboxError.ts` reads the `SandboxError` body both
  backends return and builds the message; the other 403s — a hidden
  entry, an unreadable directory — keep the ordinary error path, because
  the fix for them is different. 9 tests cover it.

- `src/lib/utils/versionTag.ts` renders a version the way a git tag is
  written, adding the `v` only when it is missing and leaving a
  non-numeric version such as `dev` alone. 9 tests cover it.

- A release can be cut on GitHub Actions rather than locally.
  `just release-remote <part>`, or _Actions → Release → Run workflow_,
  runs the gates, promotes the changelog, commits, tags, pushes and
  publishes on the runner — so a machine with no bun can still ship. The
  dispatch and tag-push paths are one workflow because a push made with
  the default `GITHUB_TOKEN` does not trigger further workflows.

- Unit tests for `regexFilter`, `urlState`, `format`, the log grammar and
  `api`: 111 tests across 8 files, up from 14 across 2. They cover the
  filter's three modes and its HTML escaping, the URL round trip for
  paths with spaces, plus signs and non-ASCII, the relative-time
  boundaries, the grammar's rule order, and the request builder's path
  encoding.
- `src/lib/utils/latestRequest.ts`: `LatestRequest` and
  `LatestRequestMap` make the newest request the winner. They abort the
  request they supersede and report its result as `SUPERSEDED` if it
  answers anyway, so a caller cannot apply a stale response by
  forgetting half of the pattern. 18 tests cover it, including the
  out-of-order arrival that motivated it.
- `EditorPane.svelte` is split by responsibility, from 1,402 lines to
  582, each part checked in a browser against rx-go:
  - `src/lib/utils/editorDecorations.ts` builds the editor's Monaco
    decorations — trace matches, a highlighted range, an anomaly
    category, the regex filter's highlights and hidden-text markers — as
    plain data, with the file-to-Monaco line conversion in one function.
    12 tests cover it without booting an editor. Its classes are styled
    in `components/editor/editorDecorations.css`.
  - `RegexFilterPanel.svelte` is the regex filter bar: the highlighted
    pattern box with its caret handling, the three modes, Apply and
    Cancel. Its Prism token colors now apply inside the box only,
    rather than to every `.token` in the app.
  - `EditorToolbar.svelte` holds the toggles for syntax highlighting,
    word wrap, invisible characters and the filter bar, the Monaco theme
    picker and close. The toggles report clicks; the pane decides.
  - `AnomalyCategoryNav.svelte` holds the anomaly chips and their
    next/previous arrows. Which anomaly a step lands on is decided by
    `pickAnomalyTarget` in `src/lib/utils/anomalyCategories.ts`, with 5
    tests for stepping off the centered anomaly and wrapping at either
    end.
- `src/lib/utils/processContent.ts` holds the line-to-editor-text
  transformation that `EditorPane.svelte` used to do inline: carriage
  return handling and the hide/show filter modes. It returns the
  hidden-content map instead of writing to a component variable, which
  removes an ordering trap and makes the logic testable — 20 tests now
  cover it. `EditorPane.svelte` drops from 1,596 to 1,394 lines.
- `src/lib/utils/logGrammar.ts` holds the log-file Monarch grammar and
  its theme rules as data, importing Monaco for types only. Registering
  it stays in `monacoLogLanguage.ts`, which re-exports the grammar so
  callers keep one import. The split is what makes the grammar testable
  without booting an editor.
- A `Content-Security-Policy` meta tag in `index.html` restricting the
  page to same-origin resources, so a remote dependency cannot come back
  unnoticed. `src/lib/utils/externalResources.test.ts` fails if either
  the policy or the same-origin rule is broken.

- The wire types are generated from rx-go's OpenAPI document into
  `src/lib/types.generated.ts` (`just gen-types`), and `types.ts` aliases
  them. `just ci` fails when the generated file is stale, so a backend field
  can no longer be missing here by accident. Generating them immediately
  showed that a hand-written type allowed `context_lines: null`, which the
  contract does not.
- The status bar shows the backend's `contract_version`, and refuses a
  contract major this viewer was not built for instead of misreading the
  data (`src/lib/utils/contractVersion.ts`, with tests).

- `justfile` as the single dev entrypoint. `just ci` runs `fmt-check
typecheck lint test build` in the order CI runs them, and
  `.github/workflows/ci.yml` invokes `just ci` rather than repeating the
  commands.
- Prettier, ESLint (with `eslint-plugin-svelte`) and Vitest. The whole
  source tree was formatted once; `just fmt-check` keeps it that way.
- `scripts/release.sh`, driven by `just release` / `just release-dry`:
  clean tree on `main`, non-empty `[Unreleased]`, changelog promotion,
  commit, tag, and printed push commands.
- Dependabot for npm and GitHub Actions, weekly.
- `src/vite-env.d.ts`, which also resolved five `svelte-check` errors about
  Monaco's worker imports.

- The release workflow publishes a `dist.tar.gz.sha256` sidecar beside the
  bundle and asserts that `index.html` sits at the archive root before
  uploading. Both backends verify the sidecar before unpacking a download.

- `resolveMatchLine()` (`src/lib/utils/matchLine.ts`), which decides whether
  a match's line number is trustworthy, with unit tests.
- `api.getSamplesByOffset()` for resolving byte offsets to line numbers.

### Changed

- The documentation now states the intended use plainly: rx is for
  internal use on a trusted network and is not intended to be exposed to
  the internet. `serve` has no authentication by design; the operator
  builds the perimeter. Added to the README.

- The type check is a real gate. CI ran `bun run check || echo "..."`, which
  could not fail; it now runs through `just ci`, and the four errors it had
  been hiding are fixed, so `just ci` passes end to end for the first time.
- `vite.config.ts` no longer drops every `a11y-*` and `unused-export-let`
  warning at build time. The build reports what it finds; there were four
  a11y warnings and no unused exports, and the four are fixed rather than
  filtered.
- The release version is stamped through a vite `define` from
  `RX_VIEWER_VERSION` instead of rewriting `package.json` with `jq`, and
  `dist/version.json` is written by the build rather than by the workflow,
  so a local build produces the same artifact shape as a release.
- `bun-version` is pinned in CI; it was `latest`.

### Removed

- The highlight.js script and two stylesheets loaded from
  `cdnjs.cloudflare.com` on every page load. Nothing imported the module
  that used them — Monaco does the highlighting — so they were three
  requests telling a third party the user's IP and that they run rx,
  with no `integrity` attribute and no benefit. `src/lib/utils/highlighter.ts`,
  which nothing imported, went with them.

### Fixed

- The anomaly chips in the editor did nothing against rx-go. Their
  counts came from the index's `anomaly_summary`, which rx-go keys by
  detector name and rx-python by category, while selecting a chip
  picks anomalies by category — so against rx-go the chips were named
  after detectors, highlighted no line, and next/previous never moved.
  The counts now come from the anomalies themselves
  (`src/lib/utils/anomalyCategories.ts`, 4 tests), which carry their
  category in both backends.

- The version badge printed a doubled `v` and linked to a release that
  does not exist. `dist/version.json` is written by the build recipe
  from `git describe --tags`, so its value already starts with `v`, and
  the header added a second one — the badge read `vv0.2.0` and "View
  release on GitHub" pointed at `/releases/tag/vv0.2.0`, which is a 404.
  The backend badge had the same prefix hardcoded and turned an untagged
  build into `vdev`.

- The regex filter box scrambled a pattern typed into it. It rewrote its
  own markup to highlight the pattern, and assigning `innerHTML`
  collapses the caret to the start of the element; the rewrite and the
  caret restore were spread over two animation frames, so a keystroke
  arriving in between landed at the front. Typing `step (\d+)` produced
  `)+d\( pets` and then a syntax error. The rewrite and the restore are
  now one synchronous step, and a second writer that rewrote the same
  element on every keystroke without restoring the caret at all no
  longer runs while the box has focus. Verified from an empty box up to
  instant input and a paste.

- An API error reached the user as the raw JSON envelope — braces,
  `$schema` and all — because the whole response body became the error
  message. `ApiError.message` is now the `detail` sentence both backends
  send, falling back to `message`, then the body, then the status text;
  the unparsed body stays available as `ApiError.body`.

- Six `console.log` calls in `TreeNode.svelte` shipped to users, dumping
  index and analysis payloads into the browser console on every file
  analysis.
- A slow response could overwrite a newer one. The file, search and tree
  stores keyed their updates on a path alone with no request ordering, so
  two overlapping loads both applied in arrival order: jumping to line
  1,000,000 and then to line 5 could leave the editor on the first
  target, and a refined search could show the previous query's results.
  Every load now runs through a `LatestRequest`, and `api` methods accept
  an `AbortSignal` so a superseded request is cancelled rather than
  merely ignored. Closing a file cancels its in-flight load. An aborted
  request raises no error notification, and in `loadMore` it no longer
  gets misread as the end of the file.
- Four `svelte-check` errors the old CI could not see. Monaco's
  `bracketPairColorization` was passed as a flat
  `'bracketPairColorization.enabled'` key, which its typings reject and
  which Monaco silently ignored — bracket colouring had never actually
  been switched by language. `prismjs` had no type declarations
  (`@types/prismjs` added), and a `number | null` reached a `number`
  parameter in `EditorPane.svelte`.
- The analysis dialog was unreachable by keyboard: it could only be
  closed by clicking, and the backdrop and panel were `div`s with click
  handlers and no roles. Escape now closes it, the panel is a labelled
  `role="dialog"`, and the backdrop closes only when it is itself the
  click target — which replaces the panel's `stopPropagation` handler
  rather than suppressing a warning about it.

- Dead code removed: an unused `checkAndLoadMore` in `EditorPane.svelte`,
  a `lastScrollTop` that was written in four places and never read, an
  unused store setter in two stores, an unused import, and a redundant
  escape in the log-language tokenizer.
- Clicking a search result in a large file jumped to the wrong line. A
  match's `relative_line_number` counts from the start of its chunk, and
  the viewer used it as a file line whenever `absolute_line_number` was
  `-1`. On a 60 MB file that put the cursor 351,232 lines away from the
  match. The line is now resolved through `/v1/samples` by byte offset,
  which is always absol
