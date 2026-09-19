#!/usr/bin/env bash
set -euo pipefail

# Run a bun command in a Docker image on a snapshot of this repo, and copy
# back the files it changed.
#
# Usage: ./scripts/bun-on-snapshot.sh <image> <bun args...>
# Example: ./scripts/bun-on-snapshot.sh oven/bun:1 run format
#
# Why not a bind mount: where Docker runs in a VM that shares the host's
# files over sshfs (colima, lima), the VM caches each file's size for up
# to 20 seconds. A file made longer on the host in that time reads in the
# container as its old length, cut off at the old size. A formatter that
# writes back such a copy deletes the end of the file.
#
# So the container never reads or writes a source file through a mount:
#   1. The host tars every file git tracks or would track (untracked and
#      not ignored) and pipes the tar to the container's stdin.
#   2. The container runs bun on that copy, with node_modules mounted
#      read-only, and pipes the copy back on stdout.
#   3. The host writes each file the command changed, and only when the
#      host's file is still byte for byte the snapshot. A file edited on
#      the host meanwhile is left alone and the script fails.
#
# The exit status is bun's, or 1 when a changed file was left alone.

if [ "$#" -lt 2 ]; then
    echo "Usage: $0 <image> <bun args...>" >&2
    exit 1
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

# ── snapshot the host's files ────────────────────────────────────────────

# git lists a tracked file that was deleted from the working tree; keep
# only the files that exist.
git ls-files -z --cached --others --exclude-standard --deduplicate |
    while IFS= read -r -d '' file; do
        if [ -f "$file" ]; then printf '%s\0' "$file"; fi
    done > "$SNAPSHOT/files"

# COPYFILE_DISABLE and --no-xattrs keep macOS tar from adding ._ files
# and extended-attribute headers that GNU tar in the image does not know.
COPYFILE_DISABLE=1 tar --no-xattrs -cf "$SNAPSHOT/in.tar" --null -T "$SNAPSHOT/files"
tar -xf "$SNAPSHOT/in.tar" -C "$SNAPSHOT/in"

# ── run bun on the snapshot ──────────────────────────────────────────────

# bun's own output goes to stderr, because stdout carries the tar back.
# shellcheck disable=SC2016 # $@ and $? belong to the container's shell
container_script='
    tar -xf - || exit 1
    bun "$@" >&2
    status=$?
    tar -cf - --exclude=./node_modules .
    exit $status
'
status=0
docker run --rm -i \
    -v "$REPO_ROOT/node_modules:/snapshot/node_modules:ro" -w /snapshot \
    "$IMAGE" bash -c "$container_script" bun-on-snapshot "$@" \
    < "$SNAPSHOT/in.tar" > "$SNAPSHOT/out.tar" || status=$?

if [ ! -s "$SNAPSHOT/out.tar" ]; then
    echo "the container returned no files (docker exit status $status)" >&2
    exit "$(( status == 0 ? 1 : status ))"
fi
tar -xf "$SNAPSHOT/out.tar" -C "$SNAPSHOT/out"

# ── copy back what the command changed ───────────────────────────────────

kept_host_edit=0
while IFS= read -r -d '' file; do
    result="$SNAPSHOT/out/$file"
    snapshot="$SNAPSHOT/in/$file"
    if [ ! -f "$result" ] || cmp -s "$result" "$snapshot"; then
        continue
    fi
    if ! cmp -s "$file" "$snapshot"; then
        echo "not written: $file changed on the host while bun ran; run the recipe again" >&2
        kept_host_edit=1
        continue
    fi
    # cat keeps the file's inode and mode, as an in-place write does.
    cat "$result" > "$file"
done < "$SNAPSHOT/files"

if [ "$status" -ne 0 ]; then
    exit "$status"
fi
exit "$kept_host_edit"
