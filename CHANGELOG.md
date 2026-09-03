# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- The type check is a real gate. CI ran `bun run check || echo "..."`, which
  could not fail; it now runs through `just ci`. Four `svelte-check` errors
  it had been hiding are still open and are tracked separately.
- The release version is stamped through a vite `define` from
  `RX_VIEWER_VERSION` instead of rewriting `package.json` with `jq`, and
  `dist/version.json` is written by the build rather than by the workflow,
  so a local build produces the same artifact shape as a release.
- `bun-version` is pinned in CI; it was `latest`.

### Fixed

- Dead code removed: an unused `checkAndLoadMore` in `EditorPane.svelte`,
  a `lastScrollTop` that was written in four places and never read, an
  unused store setter in two stores, an unused import, and a redundant
  escape in the log-language tokenizer.
- Clicking a search result in a large file jumped to the wrong line. A
  match's `relative_line_number` counts from the start of its chunk, and
  the viewer used it as a file line whenever `absolute_line_number` was
  `-1`. On a 60 MB file that put the cursor 351,232 lines away from the
  match. The line is now resolved through `/v1/samples` by byte offset,
  which is always absolute, and the result list shows "resolving line…"
  while the lookup is in flight.
- `TraceResponse` was missing `file_chunks`, `context_lines`,
  `before_context`, `after_context` and `cli_command`, and `TraceMatch` was
  missing `submatches`. All are declared now, matching the golden OpenAPI
  document.
- The committed `bun.lock` did not contain `monaco-editor`, which
  `package.json` declares, so `bun install --frozen-lockfile` failed and a
  fresh checkout could not run `bun run check`.

### Added

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
