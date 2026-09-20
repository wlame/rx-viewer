# RX Viewer

The web interface of RX (Regex Tracer), a tool for searching, indexing and
reading very large text files: logs of gigabytes, sometimes code.

## Overview

The viewer is a static single-page app that an `rx` backend serves:

- [rx-go](https://github.com/wlame/rx-go), the Go backend. The viewer is
  built and tested against it.
- [rx-python](https://github.com/wlame/rx-python), the original Python
  backend, on PyPI as `rx-tool`. Its development is paused; the viewer
  works with it as far as it speaks the same contract.

The viewer targets the HTTP contract, not a backend. Its wire types are
generated from rx-go's OpenAPI document, and it checks the backend's
contract version before it sends any `/v1` request (see
[The API it calls](#the-api-it-calls)).

## Intended use

rx is built for **internal use on a trusted network. It is not intended to
be exposed to the internet.**

`rx serve` has no identity system: no users, no sessions, no TLS. Reach it
over loopback, a VPN, an SSH tunnel or an authenticating reverse proxy.

rx-go can require one shared token on every `/v1` request (`RX_API_TOKEN`).
The viewer takes the token from the link it is opened with,
`http://loghost:7777/#token=…`, keeps it for the browser tab
(`sessionStorage`), removes it from the address bar, and sends it as
`Authorization: Bearer …`. When the backend answers `401`, the viewer asks
for the token. The token crosses plain HTTP in clear text, so it does not
replace TLS. rx-python has no token support.

The viewer fetches nothing from a third party: everything it needs is in
the bundle, and a `Content-Security-Policy` in `index.html` keeps it that
way.

## Features

- **File tree** of the backend's search roots, with sizes, compression and
  index badges. A file the backend marks as not text is not opened.
- **Tabs** for the open files, reordered by drag and drop. Each tab keeps
  its own filter bar and scroll position.
- **Paged reading of large files.** The editor never loads a whole file:
  it asks `/v1/samples` for windows of 1,000 lines as you scroll and holds
  at most five of them. Line numbers are the file's own, also in gzip and
  seekable-zstd files.
- **Go to a line of the file** with `:` or Cmd/Ctrl+G, or jump to the end.
- **Search** with one or more regex patterns over files or directories,
  through `/v1/trace`, with match-case, whole-word and regular-expression
  toggles when the backend's contract has them. A result opens its file at the match; a
  line number the backend could not know is resolved by byte offset.
- **Regex filter** on the open file: hide or show the matches (or their
  captured groups), or highlight them. Hidden text shows in a hover.
- **Find in the loaded lines** (Cmd/Ctrl+F, Monaco's own find).
- **Syntax highlighting** by file extension through Monaco, with a log
  grammar for logs and unknown file types. It is off by default for files
  of 1 MB and more, and can be switched per file. Invisible characters and
  word wrap can be switched per file as well.
- **Index and analysis.** The tree's context menu builds a file's index or
  runs the analysis; the report lists line statistics and anomalies, and
  the editor's chips step through the anomalies of a category. Detector
  names, categories and severity levels come from `/v1/detectors`.
- **The URL holds the view.** A link or a reload reopens the file at its
  line, with its highlighting, filter and anomaly category, the sidebar
  tab and the search. Back and Forward step through the files opened, the
  searches run and the tabs switched.
- **The equivalent command.** The status bar shows the `rx` command the
  backend reports for the last answer, with a copy button and a list of
  recent commands.
- **Themes**: system, light and dark for the app (each click on the
  header button changes the look: it switches between system and the
  theme the system does not show), and a choice of editor themes.

### Keyboard shortcuts

Cmd/Ctrl+/ lists every shortcut in the app. They are:

| Where                     | Keys                    | Action                                                              |
| ------------------------- | ----------------------- | ------------------------------------------------------------------- |
| Anywhere                  | Cmd/Ctrl+K              | Go to the search pattern field                                      |
| Anywhere                  | Cmd/Ctrl+B              | Show or hide the sidebar                                            |
| Anywhere                  | Cmd/Ctrl+/              | Show or hide the shortcut list                                      |
| Anywhere                  | Esc                     | Close the shortcut list                                             |
| In a search pattern field | Enter                   | Run the search                                                      |
| In a search pattern field | Alt+C, Alt+W, Alt+R     | Switch match case, whole word, regular expression                   |
| In the open file          | `:` or Cmd/Ctrl+G       | Go to a line of the file                                            |
| In the open file          | Cmd/Ctrl+F              | Find in the lines loaded in the editor                              |
| In the open file          | Cmd/Alt+click on a chip | Next anomaly of the selected category; with Shift, the previous one |

The table in the app is generated from `src/lib/utils/shortcuts.ts`, so it
is the one to trust if the two ever differ.

## The API it calls

| Request              | What for                                                 |
| -------------------- | -------------------------------------------------------- |
| `GET /health`        | Connection status, backend version, contract version     |
| `GET /v1/tree`       | The file tree, and a file's size when a search opens it  |
| `GET /v1/samples`    | A window of a file's lines, by line range or byte offset |
| `GET /v1/trace`      | Search                                                   |
| `GET /v1/index`      | A file's stored index: line count and anomalies          |
| `POST /v1/index`     | Build an index, or run the analysis                      |
| `GET /v1/tasks/{id}` | Follow an index or analysis task                         |
| `GET /v1/detectors`  | Detector names, categories and severity levels           |
| `GET /version.json`  | The viewer's own version, from its bundle                |

`/health` reports `contract_version` (`MAJOR.MINOR`). The viewer reads
contract major 1 (`src/lib/utils/contractVersion.ts`). A backend on
another major is refused with a blocking message, and every `/v1` request
waits until `/health` reports a major the viewer reads. The rx-go
documentation describes each endpoint.

## Development

### Prerequisites

- [just](https://github.com/casey/just), the single entrypoint.
- [Bun](https://bun.sh/) 1.0 or later, **or** Docker. Every recipe runs bun
  from the `PATH` when it is installed and from the `oven/bun` image when it
  is not, so a machine that keeps no JavaScript runtime needs only Docker.
- A checkout of `rx-go` beside this repository, for the generated wire
  types (`just gen-types`, `just types-check`).

### Setup

```bash
just install    # install dependencies from the lockfile
just dev        # dev server on :5173 (just dev 5174 for another port)
just ci         # the gates CI runs: format, types, lint, tests, build
just shell      # a shell in the oven/bun image, with this repo mounted
```

### Dev server

The dev server runs on `http://localhost:5173` and forwards the backend's
paths, `/v1` and `/health`, to `http://localhost:8080`. Start a backend
there first:

```bash
rx serve --port=8080 --search-root=/var/log
just dev
```

When the dev server runs in Docker, it reaches the backend on the host
through `host.docker.internal`; `RX_DEV_PROXY_TARGET` overrides the target
either way.

## Building

```bash
just build      # production build into dist/
just package    # dist.tar.gz and its .sha256, the way a release does
```

`dist/` holds `index.html`, the bundled `assets/`, `favicon.svg` and
`version.json`.

## Versions

The git tag is the version. `package.json` stays at `0.0.0`; `just build`
writes the version from `git describe` into `dist/version.json`, which the
header shows and the backends read to name the bundle they cache:

```json
{
  "version": "v0.2.0",
  "buildDate": "2026-10-03T02:00:00Z",
  "commit": "<full commit hash>"
}
```

### Backends only install a compatible viewer

Each backend accepts a range of viewer versions and does not install a
release outside it. Today both rx-go (`internal/frontend/compat.go`) and
rx-python accept `0.2.0 <= v < 0.4.0`. A minor version past that range
needs a backend release that widens it first; see the parity rules in
`AGENTS.md`.

## Release workflow

```
Cut (locally or on Actions) → Tag → Build → Create Release → dist.tar.gz
                                                             + .sha256
                                                                  ↓
Backend serve → Check latest release → Verify sha256 → Cache → Serve
```

### Cutting a release

Two ways, same result. Neither needs a version edited anywhere.

**On GitHub Actions** — nothing needed locally except `gh`:

```bash
just release-remote minor     # or: patch, major
gh run watch
```

Or from the GitHub UI: _Actions → Release → Run workflow_, and pick the
part to bump.

**Locally** — needs just, and bun or Docker:

```bash
just release-dry minor        # preview, changes nothing
just release minor            # gates, changelog, commit, tag
git push origin main && git push origin v0.3.0
```

Either way `just ci` runs first, so a release cannot be cut from a tree
that does not pass; `[Unreleased]` in `CHANGELOG.md` is promoted to the new
version heading, and the commit and tag are created. The build then
packages `dist.tar.gz` with its sha256 sidecar and creates the GitHub
Release with that version's changelog section as the notes.

A release is refused if you are not on `main`, if the working tree is
dirty (untracked files included), if the tag already exists, or if
`[Unreleased]` is empty.

The dispatch and tag-push paths are one workflow rather than two because
a push made with the default `GITHUB_TOKEN` does not trigger further
workflows — a separate "cut" workflow that pushed a tag would never fire
the build.

### The sidecar is not optional

Both backends fetch `<asset>.sha256` and verify the bundle before
unpacking it. A digest that does not match is refused and the previously
cached bundle is kept. A release that ships without the sidecar still
installs, with a warning, so older releases stay usable — do not rely on
that for new ones.

## Browser support

The viewer uses `Array.prototype.at` and regex match indices, which put
its floor at Chrome and Edge 92, Firefox 90 and Safari 15.4.

## Contributing

1. Read `AGENTS.md`: it holds the rules that keep the viewer on the
   contract rather than on one backend.
2. Make the change with its tests, and run `just ci`.
3. Check it in a browser against rx-go (`rx serve --port=8080`, then
   `just dev`): tree, open file, search, jump to a result, index and
   analysis.
4. Add an entry under `[Unreleased]` in `CHANGELOG.md`.

## License

MIT

## Links

- [rx-go](https://github.com/wlame/rx-go), with the API documentation
- [rx-python](https://github.com/wlame/rx-python)
- [Issues](https://github.com/wlame/rx-viewer/issues)
