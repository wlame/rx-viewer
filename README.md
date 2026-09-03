# RX Viewer

Web-based frontend for RX (Regex Tracer) - a high-performance file search and analysis tool.

## Overview

This is the unified web UI for RX, designed to work with either backend:

- [rx-go](https://github.com/wlame/rx-go) — Go backend
- [rx-python](https://github.com/wlame/rx-python) — Python backend, on PyPI as `rx-tool`

Both serve this bundle and both speak the same contract, so the viewer does not
know or care which one it is talking to.

## Intended use

The viewer is served by a backend that is built for **internal use on a trusted
network. It is not intended to be exposed to the internet.**

The backend has no authentication: anyone who can reach it can read any file
under its `--search-root`. The viewer inherits that exactly — it adds no
authentication of its own and cannot. Reach it over loopback, a VPN, an SSH
tunnel, or an authenticating reverse proxy.

What the viewer does do is stay self-contained: it fetches nothing from a third
party, and a `Content-Security-Policy` in `index.html` keeps it that way.

## Architecture

The RX Viewer is a **standalone frontend** that:

1. Gets built and published as GitHub Release artifacts
2. Is automatically downloaded by backend servers on first run
3. Cached locally at `~/.cache/rx/frontend/`
4. Automatically updates when new versions are released

## Technology Stack

- **Svelte 4** - Component framework
- **TypeScript** - Type safety
- **Tailwind CSS** - Utility-first styling
- **Vite** - Build tool & dev server
- **Bun** - Package manager

## Features

- 📁 Multi-file tab interface with drag-and-drop
- 🔍 In-file search with match highlighting (Cmd/Ctrl+F)
- 🎨 Syntax highlighting with 20+ languages
- 🔧 Regex filter with hide/show/highlight modes
- 👁️ Invisible characters mode (spaces, tabs, newlines)
- 📊 Virtual scrolling for large files
- 🌲 File tree navigation
- 🎯 Go to line (Cmd/Ctrl+G)
- 🌓 Dark/light/system themes
- ⚡ URL state persistence

## Development

### Prerequisites

- [Bun](https://bun.sh/) >= 1.0

### Setup

```bash
# Install dependencies
bun install

# Start dev server
bun run dev

# Build for production
bun run build
```

### Dev Server

The dev server runs on `http://localhost:5173` and proxies API requests to `http://localhost:8080`.

Start a backend server:

```bash
# Python backend
rx serve --port=8080

# Or Go backend
rx-go serve --port=8080
```

Then start the frontend dev server:

```bash
bun run dev
```

## Building

### Production Build

```bash
bun run build
```

Output: `dist/` directory with:

- `index.html` - Entry point
- `assets/*.js` - Bundled JavaScript
- `assets/*.css` - Compiled CSS
- `favicon.svg` - Icon

### Build for Release

The GitHub Actions workflow automatically builds and publishes releases:

1. Update version in `package.json`
2. Commit and push
3. Create a git tag: `git tag v1.0.0 && git push --tags`
4. GitHub Actions will:
   - Build the frontend
   - Assert `index.html` sits at the archive root
   - Upload `dist.tar.gz` and its `dist.tar.gz.sha256` sidecar as release
     assets

## Release Workflow

```
Cut (locally or on Actions) → Tag → Build → Create Release → dist.tar.gz
                                                             + .sha256
                                                                  ↓
Backend Serve → Check Latest Release → Verify sha256 → Cache → Serve
```

### Cutting a release

Two ways, same result. Neither needs you to edit a version anywhere:
`package.json` stays at `0.0.0` and the build stamps from `git describe`,
so **the tag is the source of truth**.

**On GitHub Actions** — nothing needed locally except `gh`:

```bash
just release-remote minor     # or: patch, major
gh run watch
```

Or from the GitHub UI: _Actions → Release → Run workflow_, and pick the
part to bump.

**Locally** — needs bun and just installed:

```bash
just release-dry minor        # preview, changes nothing
just release minor            # gates, changelog, commit, tag
git push origin main && git push origin v0.3.0
```

Either way the same thing happens: `just ci` runs first so a release
cannot be cut from a tree that does not pass, `[Unreleased]` in
`CHANGELOG.md` is promoted to the new version heading, and the commit and
tag are created. The build then packages `dist.tar.gz` with its sha256
sidecar and creates the GitHub Release with that version's changelog
section as the notes.

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

### Backends only install a compatible viewer

Each backend is built against a range of viewer versions
(`0.2.0 <= v < 0.3.0` today) and will not install a release outside it
from "latest". Bumping the minor version therefore needs a matching
backend release; see the parity rules in `AGENTS.md`.

## Version Format

Version is stored in `package.json`:

```json
{
  "version": "1.0.0"
}
```

Build also creates `dist/version.json`:

```json
{
  "version": "1.0.0",
  "buildDate": "2025-12-14T20:00:00Z",
  "commit": "abc1234"
}
```

## API Integration

The frontend expects these backend endpoints:

- `GET /health` - Health check
- `GET /v1/trace` - Search files
- `GET /v1/samples` - Get file content
- `GET /v1/analyse` - Analyze files
- `GET /v1/tree` - Browse directory tree
- `GET /v1/complexity` - Check regex complexity

See [API Documentation](API.md) for details.

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test with both Python and Go backends
5. Submit a pull request

## License

MIT

## Links

- [Python Backend (rx-tool)](https://github.com/wlame/rx-tool)
- [Documentation](https://github.com/wlame/rx-viewer/docs)
- [Issues](https://github.com/wlame/rx-viewer/issues)
