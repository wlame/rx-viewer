# rx-viewer — the single dev entrypoint. CI runs these same recipes.
#
# Bun runs from the PATH where it is installed (the CI runner, a dev
# container) and from the oven/bun image where it is not, so a host that
# keeps no JavaScript runtime runs every recipe the same way.
# scripts/bun.sh runs bun for install, preview, test-watch, audit and
# bun; in the image it mounts the directory that holds this repo.
#
# The gates, fmt and gen-types do not read the sources through a mount:
# in a VM that shares the host's files over sshfs (colima), a file the host
# just made longer reads in the container cut off at its old size, so a
# check would judge text that is no longer there and a formatter would
# write that copy back. scripts/with-bun.sh runs them through
# scripts/bun-on-snapshot.sh, which hands the image a snapshot over stdin
# and writes back only what the command changed. scripts/gates.sh holds
# each gate's commands, so a gate runs the same commands with bun on the
# PATH and in the image.
#
# A recipe pastes into its shell lines only variables assigned a string
# literal here. Its arguments arrive as "$1" or "$@" ([positional-arguments])
# and a computed value as an exported variable read as "$NAME", so each
# reaches the shell as one word and never as code: a tag name, which the
# version comes from, may hold a quote, `;` or `$(`.
# src/lib/testing/releasePath.test.ts fails on any other paste.

set shell := ["bash", "-uc"]

# The image that runs bun where bun is not on the PATH. Exported, so the
# scripts read the same image.
export BUN_IMAGE := "oven/bun:1"

# The OpenAPI document the generated types come from. Exported, so the
# gates read the same path.
export RX_GO_OPENAPI := env("RX_GO_OPENAPI", "../rx-go/docs/api/openapi.json")

# The version a release stamps. Tags are the source of truth; package.json
# stays at 0.0.0. The recipes read it as "$BUILD_VERSION".
version := `git describe --tags --dirty --always 2>/dev/null || echo dev`
export BUILD_VERSION := version

# List all recipes
default:
    @just --list --unsorted

# ── setup ────────────────────────────────────────────────────────────────

# Install dependencies exactly as the lockfile pins them
install:
    ./scripts/bun.sh install --frozen-lockfile

# Remove build output and dependencies
clean:
    rm -rf dist/ node_modules/ dist.tar.gz dist.tar.gz.sha256

# ── develop ──────────────────────────────────────────────────────────────

# Dev server on the given port, proxying /v1 and /health to a backend on :8080
[positional-arguments]
dev port='5173':
    #!/usr/bin/env bash
    set -euo pipefail
    port="$1"
    if ! [[ "$port" =~ ^[0-9]+$ ]]; then
        printf 'error: the port must be a number, such as 5173 (got %q)\n' "$port" >&2
        exit 2
    fi
    if command -v bun >/dev/null 2>&1; then
        exec bun run dev --port="$port"
    fi
    # In the container the backend on the host is host.docker.internal,
    # and the server has to listen beyond the container's own loopback.
    # RX_DEV_PROXY_TARGET set on the host still wins.
    # A terminal gets -t as well, so Ctrl+C reaches the server; Docker
    # refuses -t when stdin is not a terminal (a script, an agent, CI).
    terminal_flags="-i"
    if [ -t 0 ]; then terminal_flags="-it"; fi
    exec docker run --rm $terminal_flags -p "$port:$port" \
        -e RX_DEV_PROXY_TARGET="${RX_DEV_PROXY_TARGET:-http://host.docker.internal:8080}" \
        -v "$(dirname "$PWD"):/work" -w "/work/$(basename "$PWD")" \
        "$BUN_IMAGE" bun run dev --host=0.0.0.0 --port="$port"

# Serve the production build locally
preview:
    ./scripts/bun.sh run preview

# Run any bun command the way the other recipes run bun (e.g. just bun outdated)
[positional-arguments]
bun *args:
    ./scripts/bun.sh "$@"

# Open a shell in the bun image with this repo mounted
shell:
    docker run --rm -it -v "$(dirname "$PWD"):/work" -w "/work/$(basename "$PWD")" "$BUN_IMAGE" bash

# ── quality gates ────────────────────────────────────────────────────────

# Format every source file
fmt:
    ./scripts/with-bun.sh bun run format

# Fail when a file is not prettier-clean (CI gate)
fmt-check:
    ./scripts/with-bun.sh ./scripts/gates.sh fmt-check

# svelte-check: TypeScript and Svelte diagnostics
typecheck:
    ./scripts/with-bun.sh ./scripts/gates.sh typecheck

# ESLint
lint:
    ./scripts/with-bun.sh ./scripts/gates.sh lint

# RX_GO_OPENAPI overrides the location (default: ../rx-go/docs/api/openapi.json).
# Regenerate src/lib/types.generated.ts from rx-go's OpenAPI document
gen-types:
    #!/usr/bin/env bash
    set -euo pipefail
    if [ ! -f "$RX_GO_OPENAPI" ]; then
        echo "OpenAPI document not found at $RX_GO_OPENAPI — check out rx-go beside this repo" >&2
        echo "or set RX_GO_OPENAPI to its docs/api/openapi.json" >&2
        exit 1
    fi
    ./scripts/with-bun.sh bun x openapi-typescript "$RX_GO_OPENAPI" -o src/lib/types.generated.ts

# Skips with a notice when rx-go is not checked out, so the viewer stays
# buildable alone.
# Fail when the generated types are stale (CI gate)
types-check:
    ./scripts/with-bun.sh ./scripts/gates.sh types-check

# Report outdated and vulnerable dependencies
audit:
    ./scripts/bun.sh outdated

# ── tests ────────────────────────────────────────────────────────────────

# Run the unit tests (e.g. just test src/lib/utils/urlState.test.ts)
[positional-arguments]
test *args:
    ./scripts/with-bun.sh ./scripts/gates.sh test -- "$@"

# Re-run the tests on change
test-watch:
    ./scripts/bun.sh run test-watch

# ── build ────────────────────────────────────────────────────────────────

# Production build into dist/, including the version.json both backends read
build: && _version-json
    ./scripts/with-bun.sh ./scripts/gates.sh build

# Backends read dist/version.json to name the cached bundle, so it is part
# of the build rather than of the release workflow. It runs on the host,
# where git is.
_version-json:
    #!/usr/bin/env bash
    set -euo pipefail
    printf '{\n  "version": "%s",\n  "buildDate": "%s",\n  "commit": "%s"\n}\n' \
        "$BUILD_VERSION" \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        "$(git rev-parse HEAD 2>/dev/null || echo unknown)" \
        > dist/version.json
    cat dist/version.json

# Package dist/ the way a release does, with the checksum sidecar
package: build && _tarball

# Package an existing dist/ into dist.tar.gz and its checksum sidecar
_tarball:
    #!/usr/bin/env bash
    set -euo pipefail
    tar -czf dist.tar.gz -C dist .
    # List the archive once into a file: piping tar into head or grep kills
    # the job under pipefail when the reader exits early.
    tar -tzf dist.tar.gz > archive-list.txt
    grep -qx './index.html' archive-list.txt \
        || { echo "ERROR: index.html is not at the archive root"; exit 1; }
    rm -f archive-list.txt
    sha256sum dist.tar.gz > dist.tar.gz.sha256
    cat dist.tar.gz.sha256

# ── aggregates ───────────────────────────────────────────────────────────

# One run of the gates, so in Docker they share one container and one
# snapshot. Each gate is also a recipe of its own above.
# Exactly what GitHub CI enforces, in the same order
ci: && _version-json
    ./scripts/with-bun.sh ./scripts/gates.sh fmt-check types-check typecheck lint test build

# The full pre-push battery
check: ci _tarball audit

# ── release ──────────────────────────────────────────────────────────────

# Print the version a build would stamp
version:
    @printf '%s\n' "$BUILD_VERSION"

# Cut a release on GitHub Actions — no local bun or just toolchain needed
[positional-arguments]
release-remote part='patch':
    #!/usr/bin/env bash
    set -euo pipefail
    part="$1"
    if ! [[ "$part" =~ ^(major|minor|patch)$ ]]; then
        printf 'error: the part must be major, minor or patch (got %q)\n' "$part" >&2
        exit 2
    fi
    command -v gh >/dev/null || { echo "gh is not installed: https://cli.github.com"; exit 1; }
    echo "Dispatching a $part release to GitHub Actions..."
    gh workflow run release.yml --field="part=$part"
    # `gh workflow run` returns before the run is registered, so give the
    # API a moment rather than racing it for the run id.
    sleep 4
    gh run list --workflow=release.yml --limit=1
    echo
    echo "Follow it with:  gh run watch"

# Cut a release locally (major|minor|patch): gates, changelog, commit, tag. Never pushes.
[positional-arguments]
release part='patch':
    #!/usr/bin/env bash
    set -euo pipefail
    just ci
    ./scripts/release.sh "$1"

# Show what a release would do, changing nothing
[positional-arguments]
release-dry part='patch':
    @./scripts/release.sh "$1" --dry-run

# Print one version's changelog section (e.g. just release-notes 0.3.0)
[positional-arguments]
release-notes version:
    #!/usr/bin/env bash
    set -euo pipefail
    # release.yml passes the pushed tag's version here. Only X.Y.Z gets
    # through, and awk compares it as text, never as a pattern.
    if ! [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        printf 'error: the version must be X.Y.Z, such as 0.3.0 (got %q)\n' "$1" >&2
        exit 2
    fi
    awk -v v="$1" 'index($0, "## [" v "]") == 1 {f=1; next} /^## \[/ {f=0} f' CHANGELOG.md
