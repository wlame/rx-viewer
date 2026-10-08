#!/usr/bin/env bash
set -euo pipefail

# Run bun with the arguments given: from the PATH where bun is installed,
# else in the image $BUN_IMAGE names (the justfile exports it), with the
# directory that holds this repo mounted so ../rx-go resolves as it does
# on the host.
#
# Usage: ./scripts/bun.sh <bun arguments>...
# Example: ./scripts/bun.sh install --frozen-lockfile
#
# Each argument reaches bun as one word. The recipes that read the
# sources (the gates, fmt, gen-types) use scripts/with-bun.sh instead,
# which hands the image a snapshot rather than a mount.

if command -v bun >/dev/null 2>&1; then
    exec bun "$@"
fi

image="${BUN_IMAGE:?BUN_IMAGE names the bun image; run this through just, which sets it}"
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
exec docker run --rm -i \
    -v "$(dirname "$repo_root"):/work" -w "/work/$(basename "$repo_root")" \
    "$image" bun "$@"
