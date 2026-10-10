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

- **Activity bar** at the window's left edge: a button for each panel of
  the side panel (Files, Search) and one for the keyboard shortcuts. A
  click on the shown panel's button hides the side panel. Alt+1 or
  Cmd/Ctrl+Shift+E shows Files and Alt+2 or Cmd/Ctrl+Shift+F shows
  Search, each with the focus in it. A panel keeps its state while
  another is shown.
- **File tree** of the backend's search roots. Its toolbar groups rotated
  logs into chains (Alt+G), shows or hides the labels of the rows (the
  compression, index and chain marks; Alt+L), and switches the value
  right of each name between the size (a folder's item count) and the
  modification time in the browser's time zone (Alt+V). The column
  header under it sorts each folder's rows by name (Alt+N) or by the
  value shown (Alt+S), and a second click or key press reverses the
  order; folders come first, and names with numbers sort by number
  (`app.log.2` before `app.log.10`). The link keeps each choice. The
  tree works from the keyboard as one Tab stop: arrows, Home and End,
  PageUp and PageDown, Enter to open, typing a name to go to it, and Esc
  back to the open file. A file the backend marks as not text is not
  opened.
- **Tabs** for the open files, reordered by drag and drop. Each tab keeps
  its own filter bar and scroll position.
- **Paged reading of large files.** The editor never loads a whole file:
  it asks `/v1/samples` for windows of 1,000 lines as you scroll and holds
  at most five of them. Line numbers are the file's own, also in gzip and
  seekable-zstd files.
- **Go to a line of the file** with `:` or Cmd/Ctrl+G, or jump to the end.
- **Search** with one or more regex patterns over files or directories,
  through `/v1/trace`. One line under the patterns holds the options:
  match-case, whole-word and regular-expression toggles when the
  backend's contract has them (Alt+C, Alt+W, Alt+R), Only opened files
  with the number of opened files (Alt+O), and the most matches to find,
  a whole number from 1 to 10,000 (a search with any other value is
  refused, never changed). The panel keeps unsent patterns and options
  while Files is shown. A result opens its file at the match; a line
  number the backend could not know is resolved by byte offset.
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
- **Log chains.** On a backend that serves them, the rotated files of one
  log (`app.log`, `app.log.1`, `app.log.2.gz`, …) open as one text, in
  time order: see [Log chains](#log-chains).
- **The URL holds the view.** A link or a reload reopens the file at its
  line, with its highlighting, filter and anomaly category, the panel
  the side panel shows and the search. Back and Forward step through the
  files opened, the searches run and the panels switched in the activity
  bar. See
  [Link parameters](#link-parameters).
- **The equivalent command.** The status bar shows the `rx` command the
  backend reports for the last answer, with a copy button and a list of
  recent commands.
- **Themes**: system, light and dark for the app (each click on the
  header button changes the look: it switches between system and the
  theme the system does not show), and a choice of editor themes.

### Keyboard shortcuts

Cmd/Ctrl+/ lists every shortcut in the app. They are:

| Where                                    | Keys                      | Action                                                                             |
| ---------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------- |
| Anywhere                                 | Cmd/Ctrl+K                | Go to the search pattern field                                                     |
| Anywhere                                 | Cmd/Ctrl+B                | Show or hide the sidebar                                                           |
| Anywhere                                 | Cmd/Ctrl+/                | Show or hide the shortcut list                                                     |
| Anywhere                                 | Esc                       | Close the shortcut list                                                            |
| Panels, from anywhere                    | Alt+1 or Cmd/Ctrl+Shift+E | Show the files panel and go to the file tree                                       |
| Panels, from anywhere                    | Alt+2 or Cmd/Ctrl+Shift+F | Show the search panel and go to the first pattern field                            |
| In the activity bar                      | ↓ or ↑                    | Move down or up through the panel buttons                                          |
| In the files panel, while it is shown    | Alt+G                     | Group rotated logs: on or off                                                      |
| In the files panel, while it is shown    | Alt+L                     | Show labels: on or off                                                             |
| In the files panel, while it is shown    | Alt+V                     | Show the size or the date of each file                                             |
| In the files panel, while it is shown    | Alt+N                     | Sort by name, or reverse a sort by name                                            |
| In the files panel, while it is shown    | Alt+S                     | Sort by the size or date shown, or reverse that sort                               |
| On the Size/Date switch                  | ← or →                    | Choose the value before or after the chosen one                                    |
| In the file tree                         | ↓ or ↑                    | Go to the next or the previous row                                                 |
| In the file tree                         | →                         | Open the folder, or go to its first row                                            |
| In the file tree                         | ←                         | Close the folder, or go to the folder that holds the row                           |
| In the file tree                         | Home or End               | Go to the first or the last row                                                    |
| In the file tree                         | PageDown or PageUp        | Go one panel height down or up                                                     |
| In the file tree                         | Enter or Space            | Open the file, or open or close the folder                                         |
| In the file tree                         | Type a name               | Go to the next row whose name starts with the letters typed                        |
| In the file tree                         | Esc                       | Go back to the open file                                                           |
| In the search panel                      | Alt+C, Alt+W, Alt+R       | Switch match case, whole word, regular expression                                  |
| In the search panel                      | Alt+O                     | Switch Only opened files                                                           |
| In a search pattern field or the max box | Enter                     | Run the search                                                                     |
| In the open file                         | `:` or Cmd/Ctrl+G         | Go to a line of the file; in a log chain's tab, see below                          |
| In the open file                         | Cmd/Ctrl+F                | Find in the lines loaded in the editor                                             |
| In the open file                         | Cmd/Alt+click on a chip   | Next anomaly of the selected category; with Shift, the previous one                |
| In the go-to-line box                    | Enter                     | Jump to the typed line                                                             |
| In the go-to-line box                    | Esc                       | Close the go-to-line box                                                           |
| In the editor filter field               | Enter                     | Apply the filter to the open file                                                  |
| In the editor filter field               | Esc                       | Close the filter bar (an applied filter stays)                                     |
| On the timeline bar                      | ← or →                    | Move the time by 1/200 of the bar, to a whole second                               |
| On the timeline bar                      | Shift+← or Shift+→        | Move the time by 1/20 of the bar, to a whole second                                |
| On the timeline bar                      | Home or End               | Move the time to the start or the end of the bar                                   |
| On the timeline bar                      | Enter                     | Go to that time in the open file (also in the Go to time box)                      |
| On the timeline bar                      | Esc                       | Put the time back where the open file is                                           |
| On the timeline bar                      | Drag or click             | Go to the time under the pointer when the button is released                       |
| In the picker of a file's time zone      | ↓ or ↑                    | Move down or up through the listed zones and the filter field                      |
| In the picker of a file's time zone      | Enter                     | In the filter field: read the file in the first listed zone or the typed offset    |
| In the picker of a file's time zone      | Esc                       | Close the picker and keep the zone                                                 |
| While a panel is open                    | Esc                       | Close the recent commands, the analysis dialog, or the list of a log chain's parts |

While a dialog is open (the shortcut list, the analysis, the API token
prompt), the keys that show a panel or the sidebar, Alt+1, Alt+2,
Cmd/Ctrl+Shift+E or F, Cmd/Ctrl+K and Cmd/Ctrl+B, do nothing: the
keyboard stays with the dialog. Alt+G, Alt+L, Alt+V, Alt+N and Alt+S act
only while the files panel is shown and no dialog is open; otherwise the
key is left to the browser. Alt+G acts only on a backend that serves log
chains. Alt+C, Alt+W, Alt+R and Alt+O act wherever the focus is in the
search panel, a pattern field or not, while no dialog is open; a toggle
that is disabled leaves the key to the browser (the match toggles on a
backend that takes no match options, Only opened files while it is off
and no file is open).

The file tree is one Tab stop. Tab enters it on the row that had the
focus last, else on the open file's row, else on the first row, and Tab
again leaves it; Alt+1 goes to the same row. Moving never opens a file:
Enter or Space does. Letters typed within half a second make one name,
and the same letter typed again goes on to the next row that starts with
it. Esc goes back to the open file or chain, when one is open. A key
with Ctrl, Cmd or Alt is never the tree's.

The table in the app is generated from `src/lib/utils/shortcuts.ts`, so it
is the one to trust if the two ever differ.

## Log chains

A log chain is the set of files one rotated log leaves in a directory
(`syslog`, `syslog.1`, `syslog.2.gz`, …, or `app-2026-10-01.log.gz` and
`app.log`), read as one text with the oldest line first. The backend finds
the chains by their file names and orders the parts by their timestamps;
the viewer shows what it answers. Chains need a backend whose `/health`
lists the `log_chains` feature (rx-go); with any other, nothing below
shows.

**Chain mode.** The "Group rotated logs" toggle in the files panel's
toolbar (or Alt+G) turns it on; it is off by default. The link holds it as
`chains=1`; a link without it opens with the mode off, whatever mode was
chosen before. With the mode on, each folder shows one row per
chain in place of its parts, with its name, `chain · N` (its parts), its
size, `idx` once every part but the active file is indexed, and marks for
missing or unreadable parts, a chain of more than 10,000 parts, and an
invalid chain. With the date shown, a chain's row shows the newest
modification time of its parts. Every file that is not a part stays listed. The parts
themselves are not listed: turn the mode off to see them, or open the
parts list in the chain's tab. A click or Enter opens the chain's tab;
the row's menu indexes or re-indexes the parts. Turning the mode off
turns each chain's tab into the file tab of the part that holds its line,
at that line; turning it on turns the file tabs of parts into their
chain's tab at the same line.

**The chain's tab.** Opening a chain starts the index builds of its
parts. Until they end the chain is _pending_: the tab shows each part's
own line numbers, muted, and pages within one part, then into the next.
Once it is _ready_ the gutter shows the chain's global line numbers, and
the tab stays on the same line. Every second part's numbers are in a
second colour. A line of text between two parts names the part below it
with its times and its lines, and marks a time gap or a missing part; it
is no line, so it moves no number, mark or jump. The caption reads
`syslog [3/12]`, where 3 is the part of the top line. A row under the
header shows the chain's state, lines, time range and index progress,
and a parts list whose entries go to a part's first line. The status
bar's equivalent command is the `rx logs samples` command of the lines
shown, with each part's `rx samples PART --lines=A-B` under it.

**Keys and jumps.** In a chain's tab the go-to box (`:` or Cmd/Ctrl+G)
takes a line of the chain (`123456`) or a line of a part
(`syslog.3.gz:500`). The timeline bar spans the chain, with a tick where
each part starts, a band over each time gap and a dot where missing
parts would be; it, the Go to time box and the timestamps stash jump
once the chain is ready. The zone button sets a zone for the chain alone.

**Search.** With the mode on, a search covers the same folders as log
chains (`/v1/logs/trace`). A match reads `syslog:123456`, its line in the
chain, with `syslog.3.gz:500`, its part's line, beside it (only the part's
line while the chain is pending); a click opens the chain's tab there.

**Rotation.** When the chain's files change on disk while its tab is open
(the backend answers 409), a notice says how ("renamed 2, new 1,
removed 1"), and the tab reloads and finds its line again by its time and
text; a notice says so when the line's text is not found again, and what
the view shows instead. The search marks of the tab are dropped (search
again). A chain that is invalid after the change, or no chain any more,
becomes the file tab of the file that held the line, or closes with a
notice when that file is gone. Switching the mode checks the files first:
a chain's tab finds its line in the renamed file before it becomes a
file tab, and a file tab's line is looked for by its time and text when
the chain shows other text at that line. Every time a tab shows its line
again (after a change of the files, a reload in another zone, the end of
the chain's indexing, a mode switch) it checks the line against the one
it showed, by its text and its time, or by either one when the other is
not known (a time read in another zone is not known): another line
leaves the screen and the line is looked for by its time, with a notice
when it is not found. A file tab a chain's tab becomes says so
when the file holds other text at the line, or no longer reaches it.

## Link parameters

The address bar holds the view; a link or a reload opens the same view.
An unknown or invalid value is read as absent.

| Parameter                                     | What it holds                                                                                                        |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `file`                                        | The active file's absolute path                                                                                      |
| `chain`                                       | The active log chain's handle: its folder and name, `/var/log/syslog`                                                |
| `part`                                        | With `chain`: the file name of the part that holds the line, `syslog.3.gz`                                           |
| `line`                                        | The line the view is anchored on; with `part`, the line in that part                                                 |
| `time`                                        | The time the file jumped to, or a chain's line time, `2026-10-03T14:00:00.123Z`                                      |
| `fp`                                          | With `chain`: the fingerprint of the chain's files the line was read in, 16 hex digits                               |
| `highlight`                                   | `1` or `0`: syntax highlighting on or off; absent, the file's size decides                                           |
| `filter`, `filter_mode`                       | The editor's regex filter and what it does: `highlight` (default), `hide` or `show`                                  |
| `category`                                    | The anomaly category marked in the file                                                                              |
| `tab`                                         | The panel the side panel shows: `files` or `search`                                                                  |
| `chains`                                      | `1`: chain mode on; absent, off                                                                                      |
| `labels`                                      | `0`: the files panel hides the labels of its rows; absent, it shows them                                             |
| `show`                                        | `date`: the files panel shows each row's modification time; absent, its size                                         |
| `sort`                                        | The files panel's order: `name-desc`, `size-asc`, `size-desc`, `date-asc` or `date-desc`; absent, `name-asc`         |
| `regexp`                                      | A search pattern, once per pattern                                                                                   |
| `max_results`, `only_opened`                  | The search's cap (1 to 10,000, default 100) and "Only opened files"                                                  |
| `ignore_case`, `word_regexp`, `fixed_strings` | The search's matching toggles                                                                                        |
| `offsets`                                     | `1`: the search results show byte offsets                                                                            |
| `stash`                                       | The timestamps stash: up to 7 instants, comma-separated                                                              |
| `ftz`                                         | A zone chosen for a file, `ftz=UTC@/var/log/app.log`, or for a chain, `ftz=UTC@chain:/var/log/syslog`; once per file |

A `sort` on the value the link does not show is read as a sort on the
value it shows, in the same direction: `?sort=date-desc` without
`show=date` opens sorted by size, largest first, and the address bar is
rewritten to `?sort=size-desc`.

A chain's tab writes `chain`, `part`, `line`, `time` and `fp` together:
`?chains=1&chain=/var/log/syslog&part=syslog.3.gz&line=500&time=2026-10-03T14:00:00.123Z&fp=3f9a0c51e2d87b46`.
A link with `chain` turns chain mode on. A link with `chains=1` and a
`file` that names a part of a chain opens the chain's tab at that part
and line. A rotation after a link was made gives the name of its `part`
to another file, and changes the chain's fingerprint. A link whose `fp`
is not the chain's now never shows the line its `part` and `line` name
in the files as they are: it goes by its `time`, on the same line of its
part where several lines share that time, with a notice that the files
changed since the link was made (or that no line has its time now); a
link without a `time` (a line without a timestamp) opens at the chain's
start with a notice that the line could not be found again. Any other
link opens at `part` and `line` only while that line has the link's
`time`, when it names one, and otherwise goes by the time the same way:
an active file rewritten in place (by a program that truncates its log
when it starts) keeps the chain's fingerprint, so an equal `fp` does not
prove the line is the same. A link without `fp`, such as one written by
hand, names the files as they are when it is opened: without a `time`, a
notice says the view shows that line as the files are now. A `file`
link carries no fingerprint either: a
link with `chains=1` and a `file` that names a part is checked the same
way, so without a `time` it gets that notice too. A link whose `part` is
gone goes by its time too. Back and Forward check an entry the
same way; a time is not used when the chain is read in another zone
than when the entry was made.

## The API it calls

| Request               | What for                                                 |
| --------------------- | -------------------------------------------------------- |
| `GET /health`         | Connection status, backend version, contract version     |
| `GET /v1/tree`        | The file tree, and a file's size when a search opens it  |
| `GET /v1/samples`     | A window of a file's lines, by line range or byte offset |
| `GET /v1/time-range`  | A file's first and last time                             |
| `GET /v1/trace`       | Search                                                   |
| `GET /v1/index`       | A file's stored index: line count and anomalies          |
| `POST /v1/index`      | Build an index, or run the analysis                      |
| `GET /v1/tasks/{id}`  | Follow an index or analysis task                         |
| `GET /v1/detectors`   | Detector names, categories and severity levels           |
| `GET /v1/logs/*`      | Log chains: list, describe, samples and search           |
| `POST /v1/logs/index` | Build the line indexes of a chain's parts                |
| `GET /version.json`   | The viewer's own version, from its bundle                |

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
release outside it. Today rx-go (`internal/frontend/compat.go`) accepts
`0.2.0 <= v < 0.8.0`, and rx-python, which is paused, `0.2.0 <= v < 0.4.0`.
A minor version past that range needs a backend release that widens it
first; see the parity rules in `AGENTS.md`.

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
