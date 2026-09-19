#!/usr/bin/env bash
set -euo pipefail

# Run the quality gates named on the command line, in order, with bun from
# the PATH. The first gate that fails stops the run with its status.
#
# Usage: ./scripts/gates.sh <gate>... [-- <args for the last gate>]
# Example: ./scripts/gates.sh fmt-check typecheck lint
#          ./scripts/gates.sh test -- src/lib/utils/urlState.test.ts
#
# Each gate is a function named gate_<name>, with dashes as underscores;
# adding a function adds a gate. The justfile calls this script directly
# where bun is on the PATH, and through scripts/bun-on-snapshot.sh where
# bun runs in Docker, so a gate runs the same commands either way.
#
# RX_GO_OPENAPI is the OpenAPI document types-check compares against
# (default: ../rx-go/docs/api/openapi.json).

# Fail when a file is not prettier-clean
gate_fmt_check() {
    bun run format-check "$@"
}

# Fail when src/lib/types.generated.ts differs from what rx-go's OpenAPI
# document generates. Skips with a notice when rx-go is not checked out,
# so the viewer stays buildable alone.
gate_types_check() {
    local spec="${RX_GO_OPENAPI:-../rx-go/docs/api/openapi.json}"
    if [ ! -f "$spec" ]; then
        echo "notice: rx-go not found at $spec — skipping the generated-types check"
        return 0
    fi
    # Generate to a scratch file: a check must not modify what it checks.
    # It lives in the repo (and *.tmp is ignored) so that it is writable
    # wherever bun runs.
    local fresh=.types-check.tmp
    bun x openapi-typescript "$spec" -o "$fresh" >/dev/null
    if cmp -s src/lib/types.generated.ts "$fresh"; then
        rm -f "$fresh"
        return 0
    fi
    echo "src/lib/types.generated.ts is stale — run \`just gen-types\` and commit the result" >&2
    # Write the diff to a file before trimming it: piping into head under
    # pipefail kills the script with SIGPIPE.
    local diff_file
    diff_file="$(mktemp)"
    diff src/lib/types.generated.ts "$fresh" > "$diff_file" || true
    head -40 "$diff_file" >&2
    rm -f "$fresh" "$diff_file"
    return 1
}

# svelte-check: TypeScript and Svelte diagnostics
gate_typecheck() {
    bun run check "$@"
}

# ESLint
gate_lint() {
    bun run lint "$@"
}

# vitest
gate_test() {
    bun run test "$@"
}

# Production build into dist/
gate_build() {
    bun run build "$@"
}

gates=()
while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do
    gates+=("$1")
    shift
done
if [ "$#" -gt 0 ]; then shift; fi
if [ "${#gates[@]}" -eq 0 ]; then
    echo "Usage: $0 <gate>... [-- <args for the last gate>]" >&2
    exit 1
fi

# Check every name before running any gate, so a typo does not surface
# after minutes of work.
for gate in "${gates[@]}"; do
    if ! declare -F "gate_${gate//-/_}" >/dev/null; then
        echo "unknown gate: $gate" >&2
        exit 1
    fi
done

last=$(( ${#gates[@]} - 1 ))
for i in "${!gates[@]}"; do
    gate="${gates[$i]}"
    echo "==> $gate" >&2
    if [ "$i" -eq "$last" ]; then
        "gate_${gate//-/_}" "$@"
    else
        "gate_${gate//-/_}"
    fi
done
