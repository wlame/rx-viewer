#!/usr/bin/env bash
set -euo pipefail

# Write the version.json both backends read to name a cached bundle: the
# version a build stamps ($BUILD_VERSION), the build's date and commit.
#
# Usage: BUILD_VERSION=v1.2.3 ./scripts/version-json.sh dist/version.json
#
# The version comes from a tag name (what `git describe` prints, or the
# tag a release was started for), and git allows a quote or a backslash
# in one, either of which would end or break the JSON string it is
# written into. So a version that holds any character but letters,
# digits, ".", "_", "+" and "-" is refused and nothing is written. Every
# version a build stamps is of those: v1.2.3, v1.2.3-4-gabc1234-dirty, a
# bare commit, dev.

# Ranges such as A-Z mean ASCII letters only in the C locale.
export LC_ALL=C

if [ "$#" -ne 1 ]; then
    echo "Usage: $0 <output path>" >&2
    exit 2
fi
output="$1"
version="${BUILD_VERSION-}"

if ! [[ "$version" =~ ^[A-Za-z0-9][A-Za-z0-9._+-]*$ ]]; then
    printf 'error: the version %q holds a character other than letters, digits, ".", "_", "+" and "-", or is empty; a build stamps a tag such as v1.2.3, and nothing is written\n' "$version" >&2
    exit 1
fi

commit="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
if ! [[ "$commit" =~ ^[0-9a-f]+$ ]]; then
    commit=unknown
fi

printf '{\n  "version": "%s",\n  "buildDate": "%s",\n  "commit": "%s"\n}\n' \
    "$version" \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "$commit" \
    > "$output"
cat "$output"
