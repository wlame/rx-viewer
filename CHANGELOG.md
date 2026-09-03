# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

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

- `resolveMatchLine()` (`src/lib/utils/matchLine.ts`), which decides whether
  a match's line number is trustworthy, with unit tests.
- `api.getSamplesByOffset()` for resolving byte offsets to line numbers.
