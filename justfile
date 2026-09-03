# rx-viewer — the single dev entrypoint. CI runs these same recipes.
#
# Bun is used directly rather than through Docker: the repo already ships a
# Dockerfile for a hermetic build, and the CI runner installs Bun itself.

set shell := ["bash", "-uc"]

# The version a release stamps. Tags are the source of truth; package.json
# stays at 0.0.0.
version := `git describe --tags --dirty --always 2>/dev/null || echo dev`

# List all recipes
default:
    @just --list --unsorted

# ── setup ────────────────────────────────────────────────────────────────

# Install dependencies exactly as the lockfile pins them
install:
    bun install --frozen-lockfile

# Remove build output and dependencies
clean:
    rm -rf dist/ node_modules/ dist.tar.gz dist.tar.gz.sha256

# ── develop ──────────────────────────────────────────────────────────────

# Dev server on :5173, proxying /v1 to a backend on :8080
dev:
    bun run dev

# Serve the production build locally
preview:
    bun run preview

# ── quality gates ────────────────────────────────────────────────────────

# Format every source file
fmt:
    bun run format

# Fail when a file is not prettier-clean (CI gate)
fmt-check:
    bun run format-check

# svelte-check: TypeScript and Svelte diagnostics
typecheck:
    bun run check

# ESLint
lint:
    bun run lint

# Regenerate src/lib/types.generated.ts from rx-go's OpenAPI document.
# RX_GO_OPENAPI overrides the location (default: ../rx-go/docs/api/openapi.json).
gen-types:
    #!/usr/bin/env bash
    set -euo pipefail
    spec="${RX_GO_OPENAPI:-../rx-go/docs/api/openapi.json}"
    if [ ! -f "$spec" ]; then
        echo "OpenAPI document not found at $spec — check out rx-go beside this repo" >&2
        echo "or set RX_GO_OPENAPI to its docs/api/openapi.json" >&2
        exit 1
    fi
    bun x openapi-typescript "$spec" -o src/lib/types.generated.ts

# Fail when the generated types are stale (CI gate). Skips with a notice
# when rx-go is not checked out, so the viewer stays buildable alone.
types-check:
    #!/usr/bin/env bash
    set -euo pipefail
    spec="${RX_GO_OPENAPI:-../rx-go/docs/api/openapi.json}"
    if [ ! -f "$spec" ]; then
        echo "notice: rx-go not found at $spec — skipping the generated-types check"
        exit 0
    fi
    before=$(cat src/lib/types.generated.ts)
    just gen-types >/dev/null
    if [ "$before" != "$(cat src/lib/types.generated.ts)" ]; then
        echo "src/lib/types.generated.ts is stale — run \`just gen-types\` and commit the result" >&2
        # Write the diff to a file before trimming it: piping into head
        # under pipefail kills the recipe with SIGPIPE.
        diff <(echo "$before") src/lib/types.generated.ts > /tmp/rx-types.diff || true
        head -40 /tmp/rx-types.diff >&2
        exit 1
    fi

# Report outdated and vulnerable dependencies
audit:
    bun outdated

# ── tests ────────────────────────────────────────────────────────────────

# Run the unit tests
test *args:
    bun run test {{args}}

# Re-run the tests on change
test-watch:
    bun run test-watch

# ── build ────────────────────────────────────────────────────────────────

# Production build into dist/, including the version.json both backends read
build:
    #!/usr/bin/env bash
    set -euo pipefail
    RX_VIEWER_VERSION={{version}} bun run build
    # Backends read dist/version.json to name the cached bundle, so it is
    # part of the build rather than of the release workflow.
    printf '{\n  "version": "%s",\n  "buildDate": "%s",\n  "commit": "%s"\n}\n' \
        "{{version}}" \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        "$(git rev-parse HEAD 2>/dev/null || echo unknown)" \
        > dist/version.json
    cat dist/version.json

# Package dist/ the way a release does, with the checksum sidecar
package: build
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

# Exactly what GitHub CI enforces, in the same order
ci: fmt-check types-check typecheck lint test build

# The full pre-push battery
check: ci package audit

# ── release ──────────────────────────────────────────────────────────────

# Print the version a build would stamp
version:
    @echo {{version}}

# Cut a release (major|minor|patch): gates, changelog, commit, tag. Never pushes.
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
