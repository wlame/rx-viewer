# rx-viewer — the single dev entrypoint. CI runs these same recipes.
#
# Bun runs from the PATH where it is installed (the CI runner, a dev
# container) and from the oven/bun image where it is not, so a host that
# keeps no JavaScript runtime runs every recipe the same way. For install,
# dev, preview, test-watch and bun the image mounts the directory that
# holds this repo.
#
# The gates, fmt and gen-types do not read the sources through a mount:
# in a VM that shares the host's files over sshfs (colima), a file the host
# just made longer reads in the container cut off at its old size, so a
# check would judge text that is no longer there and a formatter would
# write that copy back. scripts/bun-on-snapshot.sh hands the image a
# snapshot over stdin and writes back only what the command changed.
# scripts/gates.sh holds each gate's commands, so a gate runs the same
# commands with bun on the PATH and in the image.

set shell := ["bash", "-uc"]

bun_image := "oven/bun:1"
bun_on_path := `command -v bun >/dev/null 2>&1 && echo found || echo missing`
docker_bun := 'docker run --rm -i -v "$(dirname "$PWD"):/work" -w "/work/$(basename "$PWD")" ' + bun_image + ' bun'
bun := if bun_on_path == "found" { "bun" } else { docker_bun }

# The OpenAPI document the generated types come from. Exported, so the
# gates read the same path.
export RX_GO_OPENAPI := env("RX_GO_OPENAPI", "../rx-go/docs/api/openapi.json")

# Prefix that runs a command on a snapshot of the repo in the bun image,
# with rx-go's OpenAPI document in it and dist/ copied back from a build.
# Empty where bun is on the PATH.
snapshot := if bun_on_path == "found" { "" } else { "./scripts/bun-on-snapshot.sh --include=\"$RX_GO_OPENAPI\" --env=RX_GO_OPENAPI --output=dist " + bun_image }
gates := snapshot + " ./scripts/gates.sh"

# The version a release stamps. Tags are the source of truth; package.json
# stays at 0.0.0.
version := `git describe --tags --dirty --always 2>/dev/null || echo dev`

# List all recipes
default:
    @just --list --unsorted

# ── setup ────────────────────────────────────────────────────────────────

# Install dependencies exactly as the lockfile pins them
install:
    {{bun}} install --frozen-lockfile

# Remove build output and dependencies
clean:
    rm -rf dist/ node_modules/ dist.tar.gz dist.tar.gz.sha256

# ── develop ──────────────────────────────────────────────────────────────

# Dev server on the given port, proxying /v1 and /health to a backend on :8080
dev port='5173':
    #!/usr/bin/env bash
    set -euo pipefail
    if command -v bun >/dev/null 2>&1; then
        exec bun run dev --port={{port}}
    fi
    # In the container the backend on the host is host.docker.internal,
    # and the server has to listen beyond the container's own loopback.
    # RX_DEV_PROXY_TARGET set on the host still wins.
    # A terminal gets -t as well, so Ctrl+C reaches the server; Docker
    # refuses -t when stdin is not a terminal (a script, an agent, CI).
    terminal_flags="-i"
    if [ -t 0 ]; then terminal_flags="-it"; fi
    exec docker run --rm $terminal_flags -p "{{port}}:{{port}}" \
        -e RX_DEV_PROXY_TARGET="${RX_DEV_PROXY_TARGET:-http://host.docker.internal:8080}" \
        -v "$(dirname "$PWD"):/work" -w "/work/$(basename "$PWD")" \
        {{bun_image}} bun run dev --host=0.0.0.0 --port={{port}}

# Serve the production build locally
preview:
    {{bun}} run preview

# Run any bun command the way the other recipes run bun (e.g. just bun outdated)
bun *args:
    {{bun}} {{args}}

# Open a shell in the bun image with this repo mounted
shell:
    docker run --rm -it -v "$(dirname "$PWD"):/work" -w "/work/$(basename "$PWD")" {{bun_image}} bash

# ── quality gates ────────────────────────────────────────────────────────

# Format every source file
fmt:
    {{snapshot}} bun run format

# Fail when a file is not prettier-clean (CI gate)
fmt-check:
    {{gates}} fmt-check

# svelte-check: TypeScript and Svelte diagnostics
typecheck:
    {{gates}} typecheck

# ESLint
lint:
    {{gates}} lint

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
    {{snapshot}} bun x openapi-typescript "$RX_GO_OPENAPI" -o src/lib/types.generated.ts

# Skips with a notice when rx-go is not checked out, so the viewer stays
# buildable alone.
# Fail when the generated types are stale (CI gate)
types-check:
    {{gates}} types-check

# Report outdated and vulnerable dependencies
audit:
    {{bun}} outdated

# ── tests ────────────────────────────────────────────────────────────────

# Run the unit tests (e.g. just test src/lib/utils/urlState.test.ts)
test *args:
    {{gates}} test -- {{args}}

# Re-run the tests on change
test-watch:
    {{bun}} run test-watch

# ── build ────────────────────────────────────────────────────────────────

# Production build into dist/, including the version.json both backends read
build: && _version-json
    {{gates}} build

# Backends read dist/version.json to name the cached bundle, so it is part
# of the build rather than of the release workflow. It runs on the host,
# where git is.
_version-json:
    #!/usr/bin/env bash
    set -euo pipefail
    printf '{\n  "version": "%s",\n  "buildDate": "%s",\n  "commit": "%s"\n}\n' \
        "{{version}}" \
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
    {{gates}} fmt-check types-check typecheck lint test build

# The full pre-push battery
check: ci _tarball audit

# ── release ──────────────────────────────────────────────────────────────

# Print the version a build would stamp
version:
    @echo {{version}}

# Cut a release on GitHub Actions — no local bun or just toolchain needed
release-remote part='patch':
    #!/usr/bin/env bash
    set -euo pipefail
    command -v gh >/dev/null || { echo "gh is not installed: https://cli.github.com"; exit 1; }
    echo "Dispatching a {{part}} release to GitHub Actions..."
    gh workflow run release.yml --field part={{part}}
    # `gh workflow run` returns before the run is registered, so give the
    # API a moment rather than racing it for the run id.
    sleep 4
    gh run list --workflow=release.yml --limit=1
    echo
    echo "Follow it with:  gh run watch"

# Cut a release locally (major|minor|patch): gates, changelog, commit, tag. Never pushes.
release part='patch':
    #!/usr/bin/env bash
    set -euo pipefail
    just ci
    ./scripts/release.sh {{part}}

# Show what a release would do, changing nothing
release-dry part='patch':
    @./scripts/release.sh {{part}} --dry-run

# Print one version's changelog section (e.g. just release-notes 0.3.0)
release-notes version:
    @awk '/^## \[{{version}}\]/{f=1;next} /^## \[/{f=0} f' CHANGELOG.md
