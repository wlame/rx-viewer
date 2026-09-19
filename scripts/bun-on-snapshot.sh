#!/usr/bin/env bash
set -euo pipefail

# Run a command in a Docker image on a snapshot of this repo, and copy back
# what it changed.
#
# Usage: ./scripts/bun-on-snapshot.sh [option]... <image> <command> [args...]
#
#   --include=PATH  also put PATH, a file outside the repo (relative to the
#                   repo or absolute), into the snapshot at the same path;
#                   skipped when it does not exist
#   --env=NAME      pass the host's NAME into the container, when it is set
#   --output=DIR    when the command succeeds and made DIR (relative to the
#                   repo), replace the host's DIR with it
#
# Example: ./scripts/bun-on-snapshot.sh oven/bun:1 bun run format
#          ./scripts/bun-on-snapshot.sh --output=dist oven/bun:1 \
#              ./scripts/gates.sh typecheck build
#
# Why not a bind mount: where Docker runs in a VM that shares the host's
# files over sshfs (colima, lima), the VM caches each file's size for up
# to 20 seconds. A file made longer on the host in that time reads in the
# container as its old length, cut off at the old size. A check then
# passes or fails on text that is no longer there, and a formatter that
# writes back such a copy deletes the end of the file.
#
# So the container never reads or writes a source file through a mount:
#   1. The host tars every file git tracks or would track (untracked and
#      not ignored), plus the --include files, and pipes the tar to the
#      container's stdin.
#   2. The container unpacks it at the same absolute path as on the host,
#      so ../rx-go and absolute paths resolve as they do there, and runs
#      the command on that copy, with node_modules mounted read-only and
#      the caches the tools write in a scratch directory. It pipes the
#      copy back on stdout.
#   3. The host writes each file the command changed, and only when the
#      host's file is still byte for byte the snapshot. A file edited on
#      the host meanwhile is left alone and the script fails. Each
#      --output directory is replaced as a whole.
#
# The exit status is the command's, or 1 when a changed file was left
# alone.

usage() {
    echo "Usage: $0 [--include=PATH]... [--env=NAME]... [--output=DIR]... <image> <command> [args...]" >&2
    exit 1
}

includes=()
env_flags=()
outputs=()
while [ "$#" -gt 0 ]; do
    case "$1" in
        --include=*) includes+=("${1#--include=}") ;;
        --env=*) env_flags+=(-e "${1#--env=}") ;;
        --output=*) outputs+=("${1#--output=}") ;;
        --*) echo "unknown option: $1" >&2; usage ;;
        *) break ;;
    esac
    shift
done
if [ "$#" -lt 2 ]; then
    usage
fi
IMAGE="$1"
shift

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

if [ ! -d node_modules ]; then
    echo "node_modules is missing: run \`just install\` first" >&2
    exit 1
fi

SNAPSHOT="$(mktemp -d)"
trap 'rm -rf "$SNAPSHOT"' EXIT
mkdir "$SNAPSHOT/in" "$SNAPSHOT/out"
# The snapshot of the repo, as the host extracts it to compare with later.
IN="$SNAPSHOT/in/${REPO_ROOT#/}"
OUT="$SNAPSHOT/out"

# ── snapshot the host's files ────────────────────────────────────────────

# git lists a tracked file that was deleted from the working tree; keep
# only the files that exist.
git ls-files -z --cached --others --exclude-standard --deduplicate |
    while IFS= read -r -d '' file; do
        if [ -f "$file" ]; then printf '%s\0' "$file"; fi
    done > "$SNAPSHOT/files"

# The tar holds absolute paths without the leading slash, so the container
# unpacks it at /.
while IFS= read -r -d '' file; do
    printf '%s\0' "${REPO_ROOT#/}/$file"
done < "$SNAPSHOT/files" > "$SNAPSHOT/members"
for include in ${includes[@]+"${includes[@]}"}; do
    if [ ! -f "$include" ]; then continue; fi
    absolute="$(cd "$(dirname "$include")" && pwd)/$(basename "$include")"
    printf '%s\0' "${absolute#/}" >> "$SNAPSHOT/members"
done

# COPYFILE_DISABLE and --no-xattrs keep macOS tar from adding ._ files
# and extended-attribute headers that GNU tar in the image does not know.
COPYFILE_DISABLE=1 tar --no-xattrs -cf "$SNAPSHOT/in.tar" -C / --null -T "$SNAPSHOT/members"
tar -xf "$SNAPSHOT/in.tar" -C "$SNAPSHOT/in"

# ── run the command on the snapshot ──────────────────────────────────────

# The command's output goes to stderr, because stdout carries the tar back.
# node_modules is read-only, so the caches vite and vitest keep there
# (node_modules/.vite, node_modules/.vite-temp) are scratch directories
# over it; the mount points must exist in the read-only directory.
mkdir -p node_modules/.vite node_modules/.vite-temp
# shellcheck disable=SC2016 # $@ and $? belong to the container's shell
container_script='
    tar -xf - -C / || exit 1
    "$@" >&2
    status=$?
    tar -cf - --exclude=./node_modules .
    exit $status
'
status=0
docker run --rm -i \
    -v "$REPO_ROOT/node_modules:$REPO_ROOT/node_modules:ro" \
    --tmpfs "$REPO_ROOT/node_modules/.vite" \
    --tmpfs "$REPO_ROOT/node_modules/.vite-temp" \
    ${env_flags[@]+"${env_flags[@]}"} \
    -w "$REPO_ROOT" \
    "$IMAGE" bash -c "$container_script" bun-on-snapshot "$@" \
    < "$SNAPSHOT/in.tar" > "$SNAPSHOT/out.tar" || status=$?

if [ ! -s "$SNAPSHOT/out.tar" ]; then
    echo "the container returned no files (docker exit status $status)" >&2
    exit "$(( status == 0 ? 1 : status ))"
fi
tar -xf "$SNAPSHOT/out.tar" -C "$OUT"

# ── copy back what the command changed ───────────────────────────────────

kept_host_edit=0
while IFS= read -r -d '' file; do
    result="$OUT/$file"
    snapshot="$IN/$file"
    if [ ! -f "$result" ] || cmp -s "$result" "$snapshot"; then
        continue
    fi
    if ! cmp -s "$file" "$snapshot"; then
        echo "not written: $file changed on the host while the command ran; run the recipe again" >&2
        kept_host_edit=1
        continue
    fi
    # cat keeps the file's inode and mode, as an in-place write does.
    cat "$result" > "$file"
done < "$SNAPSHOT/files"

if [ "$status" -ne 0 ]; then
    exit "$status"
fi

for dir in ${outputs[@]+"${outputs[@]}"}; do
    if [ -d "$OUT/$dir" ]; then
        rm -rf "$dir"
        mv "$OUT/$dir" "$dir"
    fi
done

exit "$kept_host_edit"
