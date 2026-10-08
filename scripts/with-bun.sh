#!/usr/bin/env bash
set -euo pipefail

# Run a command that needs bun: as it is where bun is on the PATH, else
# on a snapshot of this repo in the image $BUN_IMAGE names (the justfile
# exports it), through scripts/bun-on-snapshot.sh, with rx-go's OpenAPI
# document ($RX_GO_OPENAPI) in the snapshot and a dist/ the command
# builds copied back.
#
# Usage: ./scripts/with-bun.sh <command> [args...]
# Example: ./scripts/with-bun.sh ./scripts/gates.sh fmt-check typecheck
#          ./scripts/with-bun.sh bun run format
#
# Each argument reaches the command as one word.

if command -v bun >/dev/null 2>&1; then
    exec "$@"
fi

image="${BUN_IMAGE:?BUN_IMAGE names the bun image; run this through just, which sets it}"
openapi="${RX_GO_OPENAPI:-../rx-go/docs/api/openapi.json}"
exec "$(dirname "$0")/bun-on-snapshot.sh" \
    --include="$openapi" --env=RX_GO_OPENAPI --output=dist \
    "$image" "$@"
