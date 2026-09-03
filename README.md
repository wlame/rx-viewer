# RX Viewer

Web-based frontend for RX (Regex Tracer) - a high-performance file search and analysis tool.

## Overview

This is the unified web UI for RX, designed to work with multiple backend implementations:
- [rx-tool](https://github.com/wlame/rx-tool) - Python backend
- rx-tool-go - Go backend (coming soon)

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
rx serve --port 8080

# Or Go backend
rx-go serve --port 8080
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
Developer Push → GitHub Actions → Build → Create Release → Upload dist.tar.gz
                                                                  + .sha256
                                                                    ↓
Backend Serve → Check Latest Release → Verify sha256 → Cache → Serve
```

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
