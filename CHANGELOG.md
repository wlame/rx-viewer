# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- A log chain's tab: the files of one rotated log (`app.log`,
  `app.log.1`, `app.log.2.gz`, …) read as one text, on a backend that
  serves log chains (rx-go's `/v1/logs` routes). A link with
  `chain=<handle>` opens it and turns chain mode on (`chains=1`). A ready
  chain numbers its lines by the chain's global line numbers. While its
  parts are still being indexed, the tab shows each part's own lines,
  continues into the next or previous part at a part's edge, and follows
  the chain's index task; when the task ends, the tab stays on the same
  line and switches to global numbers. A page is 5,000 lines when it
  touches a gzip, bzip2, xz or zstd part, and 1,000 otherwise. The link
  keeps the line the tab is anchored on as `part=` (the part that holds
  it), `line=` (its line in that part) and `time=` (its timestamp); a
  link whose part is gone opens at that time. An invalid chain shows no
  lines.
- What a chain's tab shows. The gutter shows global numbers once the
  chain is ready; before that it shows each part's own numbers, muted.
  Every second part's numbers are in a second colour, in light and dark
  editor themes. A line of text between two parts, which is no line and
  moves no line number, mark or jump, names the part below it with its
  first and highest time and its lines. It also says "no lines from X to
  Y" before a part that follows a time gap, and "missing: NAME" where a
  missing numbered part would be. The tab's caption is `syslog [3/12]`,
  where 3 is the part of the top line on screen; its tooltip is
  `syslog.3.gz : 500`. A row under the header shows the chain's state, its lines
  (the frozen parts' lines and `…` while the active file is not
  counted), its time range, `idx` once every frozen part with lines is
  indexed, `indexing 5/12 parts · 40%` while the index task runs, its
  gaps and missing parts, and why it is invalid. A list of its parts
  gives each one's name, compression, global lines and index; a click
  goes to its first line, and Escape closes the list. The go-to box (`:`
  or Cmd/Ctrl+G) takes a global line (`123456`) or a part's line
  (`syslog.3.gz:500`), and says why it refuses any other text. The
  status bar's equivalent command is the `rx logs samples` command of
  the lines shown. "Per part" opens the recent commands, where the
  `rx samples PART --lines=A-B` of each part follows under the command.
- Chain mode in the files panel. A "Group rotated logs" switch in the
  panel's header, shown when the backend serves log chains, shows the
  files of each rotated log (`app.log`, `app.log.1`, `app.log.2.gz`, …)
  as one row. The link holds the mode as `chains=1`; a link that does not
  name it opens in the mode the viewer was last in. A chain's row
  shows its name, `chain · N` (its parts), its size, `idx` once every
  part but the active file is indexed, how many parts are missing (the
  tooltip names them), parts that cannot be read, a chain of more than
  10,000 parts, and `invalid` with the reasons once its tab found it
  so. A click or Enter opens the chain's tab, and its menu indexes or
  re-indexes every part. Turning the mode on lists the chains of the
  open folders on screen; a collapsed folder's chains are listed when it
  is opened. Only the files the backend names as parts of a chain give
  way to its row: every other file stays listed, another encoding of a
  part included. The parts themselves are not listed:
  turning the mode off shows them, and a chain's tab lists them. Turning
  the mode off or on keeps the folders open as they were.
- Switching chain mode keeps the line in view. Turning the mode off
  makes each log chain's tab the file tab of the part that holds its
  line, at that line of the part, and the files panel reveals and
  selects that part. Turning it on makes each file tab of a chain's part
  the chain's tab at the same line; the tabs of several parts of one
  chain become one tab, at the active tab's line when it is one of them,
  else at the first one's. A chain that is not valid keeps its parts as
  file tabs, with a notice. A tab that turns into another keeps its place
  in the tab row, its zone, the highlighting chosen for it, its filter,
  word wrap, invisible characters and search marks; the active tab stays
  active, and the switch rewrites the history entry rather than adding
  one. A link with `chains=1` and a `file=` that names a part of a valid
  chain opens the chain's tab at that part and line (at the link's time
  when it names a time and no line), and Back or Forward to an entry in
  the other mode turns the open tabs over the same way.
- Jumps by time on a log chain's tab. The timeline bar, the Go to time
  box and the timestamps stash move a ready chain's tab to the first
  line, in the chain's order, at or after a time, the line
  `rx logs samples --timestamps=` names: a time in a gap between two
  parts lands on the later part's first line, a time before the chain
  on line 1, and a time after it shows the chain's end with a notice.
  A jump sets the time cursor. A typed time is read in the format of
  the chain's first part with timestamps, and the chain's times are
  written that way. A time of day without a date is refused on a chain
  whose times span several days; the tab stays where it was and the box
  says why. A stash entry outside the chain's first and last time is
  disabled. Until the chain is ready nothing moves it by time, and the
  tooltip says why: its parts' line indexes are being built, the
  backend's reason it has no index task, or the checks it failed.
- The timeline bar of a log chain's tab spans the chain from its first
  to its last time. A tick marks where each part starts (its tooltip
  names the part and its first time), a shaded band covers each time
  gap, and a red dot marks where missing parts would be; marks that fall
  close together on a chain of many parts become one, whatever order the
  backend lists the parts in. The slider reads
  out the part that holds its time. Until the chain is ready the bar
  says why it does not jump. The zone button before the axis shows the
  zone the chain is read in and chooses one for the chain alone
  (`ftz=<zone>@chain:<handle>`, apart from the file at its handle): the
  chain is read again in it, its times follow, and the tab stays on its
  line. On a chain's tab the bar and the stash need the backend to serve
  log chains, not time queries on single files.
- A log chain's tab waits rather than fails while the backend is busy.
  A request the backend answers 503 (no place for the chain's index
  task) is asked again after the wait its `Retry-After` names (5 s
  without one, from 1 s to a minute), up to three times, with a notice;
  the tab keeps its lines, and after the third says the backend is still
  busy. A pending chain with no index task shows "waiting for an index
  task" with the backend's reason (`index_build_refused`, from its
  description or from an answer about one part), which the timeline
  gives too, and is described again after 5 s, then 10, 20, 40 and 60 s,
  eight times at most. An index task that ends while the chain stays
  pending is followed by the next one after 1 s, then 2, 4, 8 and 16 s;
  after five the tab says so and stops. The tab stops reading a chain
  whose files changed three times within a minute, whatever it read
  between the changes.
- A rotation while a log chain's tab is open. When the tab's next
  request finds the chain's files changed on disk (the backend's 409), a
  notice says how, from the parts before and after compared by name,
  size, modification time and first timestamp: "Files of syslog changed
  on disk (renamed 2, new 1, removed 1); chain reloaded". The tab drops
  its lines and finds its line again: in a ready chain at the line's
  time, on the nearest line around it with the same text; while the
  chain is pending again (a numbered rotation renames every part, and
  each is indexed again), at the same line of the file that held it,
  under that file's new name, and at its time when that line reads
  otherwise. A chain that is invalid after the change, or no longer a
  chain, becomes the file tab of the file that held the line, at that
  line; when that file is gone, the tab closes with a notice. A jump by
  time that meets a change asks for the time once more in the chain as
  it is now, or says in the box why it cannot.
- A zone the backend refuses for a log chain is dropped with a notice,
  and the chain is read as its lines write times, as for a file.
  Choosing a zone while a jump by time on a chain runs cancels the jump
  and asks it once more in the new zone; cut short again, the Go to time
  box says so.
- Search in chain mode. With chain mode on, the search panel searches
  the same roots as log chains (rx-go's `/v1/logs/trace`), and "Only
  opened files" names each open chain's tab by its handle beside the
  open files. A match in a ready chain reads `app.log:123456`, its line
  in the chain, with `app.log.3.gz:500`, its part and its line there,
  beside it; a match in a chain whose parts are still being indexed
  reads `app.log.3.gz:500` alone, and its tooltip names the chain. The
  matches keep the order the backend sends. A click opens the chain's
  tab at the match's line in the chain, or at the part's line while the
  chain gives none, and the tab marks the search's matches in that
  chain on their lines, before and after the chain is ready. With chain
  mode off, or in a chain the search found invalid, a click opens the
  part as a file at its line. The summary counts the log chains found.
  With chain mode off a search is the same as before.
- A click on a search match in a log chain whose files changed since
  the search (a rotation renamed its parts, so the match's part and line
  now name other text) does not go there: a chain's new tab opens at its
  start, an open tab stays where it is, no line is marked, and a notice
  says "The chain app.log changed since the search; search again".
- The files a search skipped are listed under its summary, closed until
  opened ("N files skipped"), each once, by its path under the searched
  folder (the full path in its tooltip) with the backend's reason: a binary
  file, a file that cannot be read and, in chain mode, another encoding
  of a chain's part (`duplicate_part`). At most 100 are listed, followed
  by how many more there are.

- The file tree opens with every search root unfolded, so the first
  level of each root is in view at once; deeper folders stay closed
  until clicked.

- A large file without a line index opens at once on a backend that
  answers from the start of the file and builds the index in the
  background (rx-go names the build in the samples answer's
  `index_build`). The file's tab shows `indexing N%` while the build
  runs. Until it ends, the timeline does not scrub, the Go to time box
  is disabled and the stash entries do not jump, each with a tooltip
  that says the line index is being built (an entry's `×` still
  removes it); paging through the file works as before. When the build
  ends, the file gets its index as after an Index from the tree: `idx`
  in the tree and in the editor header, its line count and anomalies,
  and its time range asked again, and the time features turn on. A
  failed build is said in a quiet notice, and the file stays readable
  with the time features off. Closing the file stops following the
  build. A file opened again while its build runs keeps the time
  features off until it ends.
- The editor header shows `idx` for a file with a line index.

- A timestamps stash of up to 7 saved moments, in a row above the tabs.
  The `+` of the time cursor saves the cursor's instant; it is disabled,
  with a tooltip that says why, when the stash holds that instant or is
  full. Each entry shows its time the way the active file writes a
  timestamp (ISO 8601 in UTC for a file without timestamps), jumps the
  active file there on a click and sets the time cursor, and has a `×`
  that removes it. An entry outside the active file's range (its first
  and last times are inside), or on a file without timestamps or whose
  range is not known yet, is dimmed and does not jump; its tooltip says
  why. The row keeps one height, with the hint "+ on the cursor saves a
  moment here" while it is empty, so the editor does not move when a
  moment is saved or removed.
- The link keeps the stash as `stash=`, the instants in RFC 3339 with
  milliseconds and `Z`, separated by commas. A saved or removed moment
  rewrites the current history entry; Back and Forward keep the stash as
  it is. Invalid entries are dropped, and the rest are kept once each, in
  time order, the earliest 7.
- A time zone can be chosen for a file, on a backend that lists the
  `file_tz` feature: the file's timestamps are then read as wall clock in
  that zone, whatever zone its lines write. Every samples and time-range
  request for the file carries `file_tz`, so its range, its jumps by
  time, the times of its lines, the stash entries it enables and the
  status bar's equivalent command (`--file-tz=…`) follow the zone.
  Choosing or resetting a zone asks for the range again and loads the
  window around the anchor line again; the file stays on that line. A
  zone the backend refuses is dropped with a notice.
- The link keeps the chosen zones as repeated `ftz=<zone>@<path>`, split
  on the first `@`, also for files that are not open, so a file opened
  again reads its times in the same zone. At most 20 files keep a zone;
  invalid entries are dropped. A change rewrites the current history
  entry; Back and Forward keep the zones as they are.
- A small button before the timeline shows the active file's zone,
  marked when one was chosen. It opens a picker with the file's own zone
  (a reset), a field that filters every zone the browser knows and takes
  a typed offset `±HH:MM`, and the common zones while the field is
  empty. The arrow keys move through the list, Enter in the field
  chooses the first zone listed, and Escape or a press outside closes
  it. The button shows only on a backend that lists `file_tz`.

### Changed

- The timeline bar belongs to the active file: its axis runs from that
  file's first to its last time and changes with the tab shown. The
  lanes of the other open files and the axis over all of them are gone.
  The bar is hidden for a file without timestamps, and shows "Reading
  the time range…" while the file's range is being asked.
- The time cursor is the instant of the last jump by time (a click or a
  drag on the axis, Enter after the arrow keys, the Go to time box,
  where a typed value takes the time of the line it found, or a link's
  `time`), and it never moves another file. Tabs no longer move to it
  when shown, and a file opened while it is set opens at its start. It
  shows at the right edge of the tab row, the tab strip scrolling in the
  space left of it: its time written the way the active file writes a
  timestamp (ISO 8601 in UTC for a file without timestamps), a `+` to add
  it to the timestamps stash, and a `×` that clears it. The axis marks it
  when it is inside the active file's range. A refused value and a typed
  value with no line at or after it leave the cursor as it was.
- A link with both `line` and `time` opens the file at the line and
  sets no time cursor.
- A gzip, bzip2 or xz file, and a zstd file whose line index says it is
  not seekable, loads 5,000 lines a page instead of 1,000: it opens with
  `lines=1-5000` and pages 5,000 lines at a time, and holds up to 25,000
  lines (five pages), so fewer of its slow reads are needed and paging
  back through what was read asks nothing. A plain file and a seekable
  zstd file keep pages of 1,000. A zstd file pages by 1,000 until its
  index tells which kind it is, and a compressed file opened from a link
  before the tree lists it starts with 1,000 lines.

### Fixed

- After a switch to another tab the timeline bar kept the axis of all
  the open files, so most of it lay outside the shown file's times until
  a reload. A time picked with the arrow keys in one file no longer
  carries over to the next.
- The time cursor's chip no longer takes room from the timeline bar.
- With chain mode off, "Only opened files" searches the open files and
  leaves out the tabs of log chains, whose keys are no file path.
- A link whose `highlight` or `chains` is the name of a property every
  JavaScript object has, such as `constructor` or `__proto__`, is read
  as one that does not name it, rather than as switched on.
- A link whose `file=` is not an absolute path, or is the key of a log
  chain's tab (`chain:` and a path), opens no file; nor does a `chain=`
  that is not an absolute path.
- An update of a tab that changes nothing it shows (an index task's
  progress each second, the line kept after a scroll) no longer works
  its lines over again. The filtered text, the decorations, the search
  marks and, in a log chain's tab, the gutter labels, the part colours
  and the lines of text between the parts are worked out again only for
  new lines, a new filter, new matches or a new description, so the
  editor no longer removes and adds every one of them each time. A log
  chain's tab places the missing parts with one pass over the parts for
  each missing name, and sizes a page with one pass over its parts.
- A log chain's tab takes a line number from the backend only when it is
  a whole number, as the editor writes it into its gutter as markup, and
  a part's first line only from 1 up. For an answer that numbers a part's
  lines with anything else, the tab shows an error and no line from it,
  where it used to stay loading. A page that a scroll asks for and that
  numbers its lines so keeps the lines on screen: a notice says why, and
  the tab asks for no further page that way until a jump or a reload.
- The line of text above each part of a log chain, and the one over a
  time gap, write their times in the zone chosen for the chain
  (`ftz=<zone>@chain:<handle>`) for a part whose lines write a zone too;
  they used to write those in UTC.

### Security

- No tag name, version or recipe argument is pasted into a shell line of
  the release path any more, where a quote, `;` or `$(` in it would run
  as code. A pushed tag that is not exactly `vX.Y.Z` stops `release.yml`
  at its first step, the tag a release resolves is checked the same way
  before a later step reads it, and every workflow expression reaches a
  script through `env:`. The justfile recipes take their arguments as
  single words (`"$1"`, `"$@"`), read the version from `BUILD_VERSION`,
  and run bun through `scripts/bun.sh` and `scripts/with-bun.sh`;
  `just release-notes` takes only `X.Y.Z`, `just dev` only a number and
  `just release-remote` only `major`, `minor` or `patch`. A test fails
  when a recipe pastes anything but a variable set to a fixed string, or
  a workflow pastes an expression into a `run:` script.
- A log chain's tab whose files change twice before it shows its line
  again (a rotation that renames the files, then compresses one) looks
  for that line from the name the first change gave its file, so it no
  longer reads the file that took the old name; the line's time and text
  carry over to the second change. A line of another file never stays on
  screen while the tab looks for its line: when the renamed file's line
  reads otherwise, the tab drops it before it asks by time, and a backend
  that stays busy leaves the tab with no line and the reason. When the
  tab cannot find the line's text again, a notice says so and what the
  view shows instead: the first line at or after the line's time, or the
  chain's start.
- A change of a log chain's files drops the search marks of its tab,
  which name parts and lines of the files as they were, and a notice
  says to search again: a mark no longer lands on another file's line
  that took the old name.
- Switching chain mode after a rotation the tabs have not seen shows no
  other file's line in silence. Turning the mode off, each log chain's
  tab first describes its chain with the files it holds; when they
  changed, the tab finds its line again in the renamed file before it
  becomes that file's tab, and a file tab that then reads other text at
  the line says so (and drops the marks it carried). Turning the mode
  on, the chain's tab checks it shows the file tab's text at its line,
  and otherwise looks for the line by its time and text, with a notice
  when it is not found; only the marks of the file tab whose line it
  opens at are carried, and only when that line is where the file tab
  had it.
- An older chain mode switch still waiting for the backend no longer
  moves a log chain's tab back over a newer view, such as the entry Back
  pressed twice lands on: a switch to the mode already set ends with the
  switch that set it, so the newer view's tab opens after it.
- A click on a search match in a log chain marks the chain's matches only
  while that search is still the one the panel shows: a search started
  while the chain's tab opened no longer gets the older search's marks
  back.

## [0.6.0] - 2026-10-06

### Added

- Each open file keeps its time range: when it opens, a backend that
  lists `time_range` is asked `GET /v1/time-range` for it once, and asked
  again when a line index build for the file ends, or after the first
  window of a compressed file whose range waited for its index. A failed
  call never holds up the file. Nothing shows the range yet.
- A timeline bar under the tab strip, shown when the backend lists
  `samples_timestamps` and an open file has timestamps: one time axis
  from the earliest first time to the latest last time of the open
  files, a thin band for each file (the active one highlighted, its
  path on hover), and a thumb at the active file's position, the time of
  its anchor line. Hovering shows the time under the pointer, dragging a
  live time, both written the way the active file writes its
  timestamps; releasing or clicking moves the active file to the first
  line at or after that time. The focused bar takes ←/→ (1/200 of the
  axis), Shift+←/→ (1/20), Home/End and Enter, stepping to whole
  seconds. The Go to time box beside it sends what is typed (a full
  timestamp, a time of day, a timestamp pasted from a line) as it is,
  and shows the backend's message when it refuses the value, until the
  value changes or another file is shown.
- A link can name a time: `time=2025-12-10T07:30:00.000Z` (RFC 3339 in
  UTC with milliseconds) with no `line` opens the file at the first line
  at or after that instant, asked of a backend that lists
  `samples_timestamps` as `GET /v1/samples?timestamps=…`. A jump by time
  writes `time` in place of `line` as a new history entry, so Back
  returns to where the file was; moving by line afterwards writes `line`
  again. With both, `line` wins; an invalid `time` is ignored. A time
  after the file's last line shows the file's end with a notice.
- One time cursor for all open tabs. A jump from the timeline bar, its
  Go to time box or a link's `time` sets it; the bar draws it as a
  marker apart from the thumb (dashed at the axis end when it is outside
  the open files' times) and shows its time with a × that clears it.
  Every other tab moves to the cursor when it is next shown, once, unless
  the user moved it by line after the cursor was set; a file opened
  while the cursor is set opens at it once its time range is known, and
  one opened at a line stays at the line. A typed value is read by each
  file on its own: a tab that refuses it (a time of day in a file of
  several days) shows its message and stays where it was, and the others
  are not affected. A value the active file refuses sets no cursor. A
  file whose last line is before the cursor shows its end with the
  notice. Clearing the cursor leaves every file
  where it is and the link names its line in place of the time.

### Changed

- The viewer reads which optional features a backend serves from the
  `features` list of `GET /health`, in place of a table of contract
  minor versions. The search's match options and the samples index build
  (`Prefer: respond-async`) are used when the backend lists
  `trace_matching_flags` and `samples_index_build`; a backend that lists
  no features gets neither, as a backend on an older contract did. The
  contract major check is unchanged.

### Fixed

- A jump to a line (the go-to box, a link's `line`, a search match, an
  anomaly) and a jump to the end of the file ask for 100 lines of
  context on each side, the most rx-go serves. They asked for 500, which
  rx-go 0.4.0 and later refuse with 422, and the file showed "Failed to
  load file".

## [0.5.0] - 2026-10-05

### Added

- The viewer knows contract 1.4: its wire types carry the `context`,
  `before_context`, `after_context`, `no_cache`, `no_index` and
  `no_recursive` parameters of `GET /v1/trace`, and
  `contractSupports(…, 'traceContextAndSwitches')` tells whether a
  backend has them. No part of the interface sends them yet; a 1.3
  backend ignores them.

- `contractSupports(…, 'samplesIndexBuild')` tells whether a backend
  answers `GET /v1/samples` with `202` and the task building the file's
  line index, and reports that task's `progress` (contract 1.4).

- Opening a file, jumping to a line, paging and resolving a search
  match's line wait for the file's line index when a 1.4 backend
  answers `GET /v1/samples` with `202`: the file's view says "Building
  the line index…" with the build's progress, the task is followed
  through the same cancellable poll the Analyze and Index menus use,
  and the window loads when the build ends. A build that fails still
  loads the window, read without an index. Closing the file or moving
  on stops the wait, not the build. Samples requests carry
  `Prefer: respond-async` only to a backend whose contract has the build
  (1.4); without the header a backend waits for the build and answers
  the lines. When the build ends, the tree marks the file indexed and the
  open file takes its line count and anomalies from the new index, as
  after an Index from the tree's menu.

## [0.4.0] - 2026-10-03

### Changed

- The editor filter's pattern box is a plain text input over a
  Prism-coloured copy of the pattern, instead of an editable element
  whose markup was rewritten on every keystroke. The browser now keeps
  the caret, selection, undo and redo, Cmd/Ctrl+A and input-method
  composition; Enter and Escape wait for a composition to end. A
  pattern such as `&lt;` shows as typed. A paste of several lines keeps
  the first one, at the caret. Group parentheses are no longer bold, so
  no glyph is wider than the caret expects. The help dialog lists Enter
  and Escape of the filter field.

- Every click on the header's theme button changes the look. It
  switches between System and the fixed theme the system does not
  show (Dark on a light system, Light on a dark one); from System
  (light) the next step was Light, which looked the same. A stored
  Light or Dark setting still loads, and its next click goes to the
  other look.

- The analysis report writes a file's size and decompressed size the
  way the tree does (`1.5 MB`, one decimal, up to TB) with the shared
  formatter, instead of its own copy with two decimals that stopped at
  GB.

- An anomaly category takes the palette color at its position in the
  backend's `/v1/detectors` category list, so the listed categories never
  share a color (up to the palette's thirteen) and keep it from session
  to session. Hashing the name alone put two categories on one color
  whenever the hash met; a category the list does not name still gets a
  color by its name, among those no listed category has.

- Every anomaly category takes its color from the palette by its name.
  Seven of rx-python's category names (`error`, `warning`, `traceback`,
  `format`, `security`, `timing`, `multiline`) had hand-picked colors,
  labels and symbols written into the viewer, against the rule that
  category names come only from `/v1/detectors`; rx-go's `format` was
  one of them. A chip shows a bullet and its count, and its tooltip
  names the category as the backend does.

- The wire types of `/health`, `/v1/tree`, `/v1/samples`,
  `/v1/tasks/{id}`, `POST /v1/index` and `/v1/detectors` are aliases of
  the generated contract types, like the trace types already were; ten
  were written by hand and claimed lists the contract allows to be null
  were never null. The tree and the detector list now read a null list
  as empty. `src/lib/types.test.ts` checks each alias at type-check
  time.

- The index answers are typed by the contract's named schemas instead
  of hand-written types: `IndexResponse` for `GET /v1/index` (it was
  `IndexData`, which missed `cli_command`), `IndexTaskResult` and
  `CompressTaskResult` for a task's `result`, `LineIndexEntry` (a pair,
  or a triple with the frame number in a seekable-zstd index),
  `LineLengthStats`, `LongestLine` (was `LongestLineInfo`),
  `AnomalyRangeResult` (was `Anomaly`) and `TaskConflictError` for the
  409 body whose `task_id` the viewer joins. `line_count`,
  `empty_line_count` and five of the six line-length statistics are now
  typed as possibly null, as the contract says.

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

- The status bar shows the equivalent command: the `rx` command line
  the backend sends as `cli_command` for the last answer to something
  the user did (a search, a file opened, a jump, the end of a file, an
  index, an analysis), with a Copy button. "Recent" opens a panel above
  the status bar with the last 20 commands, each with what the user did,
  the time and its own Copy button; Escape or Hide closes it. The viewer
  shows only what the backend sends: an answer without a command adds
  nothing, and the pages loaded while scrolling are not listed. Copy
  works on a plain-http origin too, where the browser has no Clipboard
  API.

- Back and Forward step through the view. Opening a file or switching
  to another, running a search and switching the sidebar tab each add a
  history entry; a scroll, a jump inside the file, the highlighting, the
  filter, the anomaly category and the Offsets switch rewrite the
  current one, and typing in a field writes nothing until the search
  runs. Back restores the entry's file at its line, its search (the
  running one is cancelled and the entry's search runs again) and its
  tab; Back to the entry before the first file closes the open files.
  The viewer used `replaceState` only, so Back left the app.

- The URL carries the whole view a link should restore: besides the
  file, its line, its highlighting and the search, it now names the
  sidebar tab (`tab=files` or `tab=search`, left out when it is the tab
  the link would open anyway), the editor filter (`filter` and
  `filter_mode`), the highlighted anomaly category (`category`) and the
  Offsets switch of the search results (`offsets=1`). One module,
  `src/lib/utils/urlState.ts`, reads and writes every key from one
  table, and the URL is written from the app's stores
  (`src/lib/viewState.ts`) instead of from the editor pane.

- The URL carries the search, under the names `/v1/trace` uses: each
  pattern as `regexp`, and `max_results`, `ignore_case`, `word_regexp`,
  `fixed_strings` and `only_opened` when they differ from the default.
  Opening such a link opens the Search tab, fills the form and runs the
  search once the backend's health is known. The panel also refills its
  form from the URL when its tab is opened again, which kept nothing
  before: switching to Files and back emptied the patterns.

- The search panel has the three toggles of an editor search box,
  beside Options: match case (`Aa`), match whole word (`ab`) and use
  regular expression (`.*`), also on Alt+C, Alt+W and Alt+R from a
  pattern field. They start at ripgrep's defaults — case-sensitive,
  regular expressions, matching anywhere — and a toggle moved away from
  its default sends `ignore_case`, `word_regexp` or `fixed_strings` to
  `/v1/trace`; each tooltip names the ripgrep flag. A backend older than
  API contract 1.3 ignores those parameters, so there the toggles are
  disabled and say why. The trace request no longer sends
  `case_sensitive`, `context_before` or `context_after`: no backend reads
  them.

- The viewer works with a backend started with `RX_API_TOKEN`. A link of
  the form `http://host:7777/#token=…` hands the token over: it is kept
  for the browser tab in `sessionStorage`, removed from the address bar,
  and sent as `Authorization: Bearer …` on every request. When a request
  is refused with 401, a dialog asks for the token and says when the one
  the tab held was refused. 12 tests cover the fragment parsing, the
  storage fallback, the header and the 401. Needs contract 1.2 (rx-go
  `9b28ab5`); against a backend without a token nothing changes.

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

- `EditorPane.svelte` is split by responsibility, from 1,402 lines to
  498, each part checked in a browser against rx-go:
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
  - `LineRangeNav.svelte` is the header's position readout: the loaded
    window's first and last lines and the file's length as jump
    buttons, and the go-to-line box the `:` shortcut opens.

### Removed

- The `client` query parameter on every `/health` request. No backend
  reads it, and making it kept an identifier in `localStorage`.

### Fixed

- A search result whose line the search left unknown says why when the
  viewer cannot find the line: the row reads "line unknown: " and the
  backend's reason (an older backend refuses byte offsets in a
  compressed file), or that the file has no line at that byte any more.
  A click on such a row shows the reason in a notification instead of
  doing nothing. With rx-go's offsets for compressed files, a capped
  search of a `.gz` or `.zst` file now shows the line of every such
  match and jumps to it.

- When the backend cannot analyse a file, the Analyze dialog says
  "Analysis not available for this file", with the backend's reason
  when it gives one (a `400` from `POST /v1/index`), instead of showing
  an empty report. It used to start a second analysis task first, and
  then show the report of the index with nothing in it. A second task is
  still asked for once when the first request joined a running plain
  index build, which ends without an analysis by design. The tree still
  shows the file as indexed.

- The recent commands panel, the analysis dialog and the shortcut list
  stay open on an Escape that only cancels an input method's
  composition, for instance in the search field. The help dialog lists
  Escape for the recent commands and the analysis dialog, and Enter or
  Space on a row of the file tree. Cmd/Ctrl+Enter on a tree row no
  longer opens it; Enter and Space do.

- Enter in a search pattern field and in the go-to-line box no longer
  runs the search or the jump while an input method is composing text:
  Enter confirms the composition, and the next Enter acts. Escape in the
  go-to-line box cancels a composition before it closes the box. No
  shortcut acts on a key an input method takes, including the one
  Safari sends with key code 229, and the editor filter box follows the
  same rule. The help dialog lists Enter and Escape of the go-to-line
  box.

- `just fmt` no longer cuts off the end of a file that was made longer
  just before it ran. Where bun runs in Docker, the VM's file sharing
  can give the container a copy cut at the file's old size for up to
  20 seconds, and prettier wrote that copy back. `just fmt` and
  `just fmt-check` now hand the container a snapshot of the repo over
  stdin, and `just fmt` writes back only the files prettier changed
  that the host did not change meanwhile.

- `just ci`, `just typecheck`, `just lint`, `just test`, `just build`
  and `just gen-types` read the files as they are on the host. Where
  bun runs in Docker, they read through the VM's file sharing, which
  can give a file cut at its old size for up to 20 seconds after an
  edit, so a gate could pass on text it never read. They now run on
  the same snapshot as `just fmt`, which also holds rx-go's OpenAPI
  document, and `just ci` runs every gate in one container. `build`
  copies `dist/` back to the host. The gates' commands are in
  `scripts/gates.sh`, and the recipes run that script directly where
  bun is on the `PATH`.

- `just dev` runs where stdin is not a terminal (a script, an agent).
  It always passed `-it` to Docker, which refuses `-t` without a
  terminal; `-t` is now added only when there is one.

- Cmd/Ctrl+G in the open file opens the viewer's go-to box, the same
  as `:`. It opened Monaco's own go-to-line, which counts the lines
  loaded in the editor rather than the file's lines. The shortcut list
  shows both keys.

- While the blocking message for an unsupported contract is up, the app
  behind it takes no focus and no input, and the window-wide shortcuts
  do nothing; focus starts on the message's button.

- Files whose extension mapped to a language Monaco does not have
  (Erlang, Haskell, Groovy, LaTeX, Makefile, CMake, diff, ignore files)
  rendered as plain text; they now get the log grammar, like any file of
  unknown type, and `.env` reads as INI. A test checks every mapped ID
  against the languages the bundled Monaco registers.

- A link whose `#token=` value holds a bare `%` left a blank page: the
  value failed to decode before the app started. Such a value is now
  taken as written.

- The viewer loads where the browser refuses `localStorage` (blocked
  site data). Reading the settings threw while the modules loaded, which
  left a blank page; the settings now take their defaults and last for
  the page.

- A file opened from a search result gets the size-based highlighting
  default (off from 1 MB). Its size was unknown, so it always opened
  with highlighting; the viewer now takes the size from the file tree,
  or from one listing of the file's directory when the tree has not
  loaded it.

- The analysis report's "Indexed At" reads the backend's time by its
  zone. rx-go's UTC time shows in the browser's zone as before; a time
  without a zone, which rx-python writes in the server's local time, is
  shown as written and marked "(server time)" instead of being read as
  the browser's local time.

- The editor filter puts a captured group where it matched. It searched
  for the group's text from the start of the match, so in `a.(a)` on
  `aba` it hid or highlighted the first `a` instead of the last. Whether
  a pattern has groups is read from its matches, replacing two copies of
  a pattern check that took an escaped paren or a paren in a class for
  a group.

- The header's theme button steps through System, Light and Dark, so
  the system theme can be chosen again; its tooltip names the setting
  and the next one. It used to switch between light and dark only.

- The editor theme picker listed "Dark (VS)", which looked exactly like
  "Light (VS)": both followed the app theme. One entry, "VS (follows the
  app theme)", replaces the two; a stored "Dark (VS)" reads as it. Stored
  settings are now read key by key: a value of the wrong kind takes its
  default, and keys of settings that no longer exist are dropped.

- A file the tree marks as not text opens no tab; a notification says
  it is binary. rx-go answers a binary file's bytes as lines, so the
  viewer showed noise; only rx-python's refusal was recognised before.

- The analysis report takes its detector names, categories, descriptions
  and severity colours from the backend's `/v1/detectors` answer. A
  detector tab shows the detector's name with its category beside it and
  its description as the tooltip; a name the answer lacks shows as
  itself, where a hard-coded list once renamed only rx-python's
  detectors. The summary line is labelled by detector, with each
  detector's category beside it; a key that names no detector shows as
  itself. Severity colours follow the levels of `severity_scale` (a
  value on a shared bound belongs to the higher level) instead of fixed
  cut-offs at 0.3, 0.5 and 0.8, and the severity's level and its
  description are the cell's tooltip. The editor's anomaly chips add the
  category's description to their tooltip.

- Paging no longer starts in the middle of a jump. Timers kept it off
  for a second after a load and half a second after a reveal, which a
  throttled background tab outlasts. Now only a scroll the user made,
  after the jump revealed its target and with no window loading, loads
  a page. A jump's target is shown at once rather than with a smooth
  scroll, so a page that arrives right after it cannot stop the view
  halfway. The viewer now hears a wheel scroll before the editor stops
  the event; until now a wheel scroll never moved `line` in the URL.

- Switching the sidebar from Search back to Files keeps the tree as it
  was. The tree was destroyed with the tab and loaded its roots again
  when it came back, which collapsed every folder and closed an open
  Analyze dialog. It is now hidden instead, the roots load once, and a
  hidden Analyze dialog leaves Escape to what is on screen.

- Each file tab keeps its own editor state. One editor pane served
  every tab, so the filter bar of one file showed on the next, where
  Apply did nothing, and a tab could open at another tab's scroll
  offset. The pane is now built for each tab: switching back restores
  that tab's filter bar (pattern, mode, open or closed) and its exact
  scroll, or shows its line when its lines were reloaded meanwhile.
  Apply also works on a file that had no filter yet.

- An open file holds at most five pages of lines (5,000 by default).
  Every page it loaded stayed in memory, and each new page passed all of
  them through the filter and into the editor again, so scrolling far
  enough loaded the whole file. Paging one way now drops the lines at
  the other end, and paging back loads them again with their own line
  numbers. The screen does not move when lines are dropped or added
  above the view, with wrapped lines too.

- `line` in the URL names the line the user went to: the line a file
  was opened at, a go-to-line target, a search match, an anomaly. It
  named the line in the middle of the screen, so a file opened at
  line 1 wrote `line=15` and a jump to line 169 wrote `line=168`. Once
  the user scrolls that line out of view, `line` becomes the line in the
  middle of the screen, where a link reopens the file. A line past the
  end of the file becomes its last line, as the backend's answer shows.

- A `line` that is not a whole number from 1 up (`-5`, `abc`, `0`) is
  ignored and the file opens at its start. A negative line used to reach
  `/v1/samples`, which reads it as counting from the end.

- A link without `highlight` opens the file with the size-based
  default (on below 1 MB, off from 1 MB up). It turned highlighting off.

- A completed index task without an index result fails the analysis
  with "Task … completed without an index result". The viewer used to
  read it as an empty index.

- The analysis report shows "—" for a line-length statistic the backend
  left null (average, median, 95th and 99th percentile, standard
  deviation) instead of failing to render. The contract allows each of
  them to be null.

- A backend on a different API contract major is refused, as the docs
  said it was. The viewer covers itself with a message that names the
  backend's contract and the major this viewer reads, and sends no `/v1`
  request: those requests wait, and the first ones also wait for the
  first `/health` answer instead of racing it. `/health` is asked every
  10 seconds while the message is up, and the viewer continues by
  itself once the backend reports a supported contract. Before, only a
  status-bar label said so, while the data kept flowing.

- `just dev` forwards `/health` to the backend as well as `/v1`. The dev
  server answered `/health` itself, so the viewer showed the backend as
  disconnected and kept the search toggles disabled. The forwarded paths
  are listed once, in `src/lib/backendRoutes.ts`, which `vite.config.ts`
  and the API client both read.

- Keyboard shortcuts come from one table that both the key handlers and
  the help dialog read. Cmd/Ctrl+K goes to the search pattern field,
  opening the Search tab and a hidden sidebar if needed; it looked for a
  field that does not exist and did nothing. Cmd/Ctrl+B shows or hides
  the sidebar instead of swallowing the key, and a header button does
  the same. The help dialog (Cmd/Ctrl+/) lists every shortcut: Enter and
  Alt+C, Alt+W and Alt+R in a search field, `:` in the open file,
  Cmd/Ctrl+F, and Cmd- or Alt-click on an anomaly chip. A shortcut keeps
  the key from the browser only when it acts. The README no longer
  offers Cmd/Ctrl+G, which is the editor's own go-to-line and counts the
  lines loaded in the editor, not the lines of the file.

- A new search clears the previous search's match highlights in every
  open file; they stayed marked until a result in that file was clicked.
  The line lookups for matches whose line the backend left unknown are
  aborted when a new search, or a second click, replaces them, instead
  of finishing and being dropped.

- Analyze runs an analysis when the cached index has none. Opening or
  searching a large or compressed file writes an index without an
  analysis, and Analyze showed that index as a clean file. It now shows
  a cached index only when `analysis_performed` is true, and otherwise
  starts an analysis task. A task already running for the file is
  joined; when that task was a plain index build, the analysis is asked
  for after it ends. An analysis that found nothing says "No anomalies
  found." instead of an empty "Found:" line.

- Index and Re-index do what they say. Both send `threshold: 0`, so a
  compressed file under the backend's size threshold is indexed instead
  of refused with a 400, and Re-index sends `force: true`, so it
  rebuilds instead of returning the cached index. Re-index keeps the
  analysis when the cached index has one. Both follow their task to the
  end.

- After an Analyze, Index or Re-index, the tree marks the file indexed
  with its line count, and an open copy of the file takes the new line
  count and anomalies. Before, both stayed as they were until a reload.

- The tree's context menu offers Analyze only on text files. A
  directory and a binary file have no menu of their own, and keep the
  browser's; the backend answers both with a 400.

- Joining an index task that is already running reads the task ID from
  a `task_id` member of the 409 body, and falls back to the ID in the
  error sentence for a backend that only names it there. The fallback
  takes any ID up to the closing parenthesis rather than only hex
  digits.

- Analyze stops following its task when its dialog closes or its tree
  row goes away. The poll used to run on for up to ten minutes after
  the dialog closed, a second Analyze started a second loop, and an
  analysis that ran longer than ten minutes was reported as a timeout.
  Polling now lives in `src/lib/utils/taskPolling.ts`: one poll per
  file, shared by every caller waiting on that file's task, stopped when
  the last caller leaves, with no attempt cap while the task reports
  `queued` or `running`. It gives up after three failed status requests
  in a row, or at once when the backend no longer knows the task.

- The editor filter's hide and show modes no longer freeze the tab on a
  pattern that can match the empty string, such as `^`, `\d*` or `x?`.
  Their match loop never stepped past an empty match, so it matched at
  the same place forever while its list of markers grew. All three modes
  now iterate matches through one helper (`src/lib/utils/regexMatches.ts`)
  built on `String.prototype.matchAll`. An empty match or an empty
  captured group no longer leaves a marker that hides nothing; such a
  marker also landed at the start of the match instead of where the
  group was. In show mode a line whose only matches are empty collapses
  to one marker, like a line without a match. 10 tests.

- The file window reads samples answers the way rx-go sends them.
  A sample past the end of the file, and any sample of an empty file,
  is null; every loader threw on it, and the end of the file was
  detected from error strings no backend sends, so scrolling at the
  bottom asked again forever. A null or short answer now ends paging and
  gives the file's line count. Jump to end numbered its window from the
  last line minus the context it asked for, which rx-go echoes even when
  the file is shorter: a 7-line file showed nothing and a 300-line file
  labelled lines 202–300 as 1–99. Every loader now numbers a window with
  one function (`src/lib/utils/sampleWindow.ts`), from line
  `max(1, N - before_context)` for a line and from its first line for a
  range. A window that replaces the loaded lines sets both ends afresh,
  so paging down works again after a jump from the end into the middle,
  and a line too far past the end shows the end of the file instead of
  an error. 15 tests.

- A pattern field keeps its focus through a search, so a pattern can
  be changed and run again from the keyboard. The fields were disabled
  while a search ran, and a disabled field drops its focus; they stay
  usable now, and Enter during a search replaces it.

- The result line of a search counts the files it covered. It read
  `scanned_files`, which lists only what a directory expanded to, so a
  search of named files — every "Only opened files" search — said
  "in 0 files". A count of one reads "1 match" and "1 file".

- The search panel's pattern fields had only a placeholder, which a
  screen reader does not announce; each now has a label ("Regex pattern
  1"). Six lists — search results, the theme picker, and the analysis
  dialog's summary, detector tabs and anomaly rows — are keyed by what
  makes each entry unique, so an update moves the right row; `just lint`
  is down from 10 warnings to 4.

- Every anomaly category rx-go reports showed as the same gray chip,
  and a selected one marked its lines with an invisible gutter glyph:
  colors came from a table of rx-python's category names only.
  `src/lib/utils/categoryStyle.ts` keeps the hand-picked styles and gives
  any other category one of ten palette colors, chosen by hashing its
  name so it is the same everywhere; the matching decoration classes are
  generated from the same palette, so chip and highlight cannot
  disagree. The detectors store's own copy of the table is gone. 5 tests.

- Closing the last open file left it named in the URL, so a reload
  reopened the file just closed. The URL now drops `file`, `line` and
  `highlight` when no file is left open; 2 tests cover it.

- The `:` go-to-line shortcut did nothing while the file's text had
  focus — which is most of the time, since a click in the text puts it
  there. The pane skipped any focused text area, and the read-only
  editor's own is one. It now opens the go-to box from the editor text
  too, and still leaves typing alone in real fields such as the editor's
  find box (`src/lib/utils/keyTargets.ts`, 4 tests).

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

## [0.3.0] - 2026-09-03

### Added

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
  which is always absolute, and the result list shows "resolving line…"
  while the lookup is in flight.
- `TraceResponse` was missing `file_chunks`, `context_lines`,
  `before_context`, `after_context` and `cli_command`, and `TraceMatch` was
  missing `submatches`. All are declared now, matching the golden OpenAPI
  document.
- The committed `bun.lock` did not contain `monaco-editor`, which
  `package.json` declares, so `bun install --frozen-lockfile` failed and a
  fresh checkout could not run `bun run check`.
