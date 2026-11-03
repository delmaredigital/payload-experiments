#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
ROOT=$SCRIPT_DIR/../..
TAG=${1:-}
if [ "$#" -eq 3 ] && [ "$2" = --root ] && [ -n "$3" ]; then
  ROOT=$3
elif [ "$#" -ne 1 ]; then
  echo '::error::Usage: validate-release.sh <tag> [--root <dir>]' >&2
  exit 1
fi
cd -- "$ROOT"

case "$TAG" in
  stats-v*) PKG=packages/stats; VER=${TAG#stats-v} ;;
  plugin-v*) PKG=packages/plugin; VER=${TAG#plugin-v} ;;
  *) echo "::error::Unknown release tag '$TAG'." >&2; exit 1 ;;
esac

PACKAGE_VER=$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).version' "$PKG/package.json")
if [ "$VER" != "$PACKAGE_VER" ]; then
  echo "::error::Tag version '$VER' ($TAG) does not match $PKG/package.json version '$PACKAGE_VER'." >&2
  exit 1
fi
NPM_TAG=$("$SCRIPT_DIR/dist-tag.sh" "$VER")
# Minors at or above this belong to the Payload 4 line, which may publish only under `next`.
# Lift when the Payload 4 line becomes latest.
PAYLOAD4_MIN_MINOR=20
MINOR=${VER#*.}; MINOR=${MINOR%%.*}
if [ "$((10#$MINOR))" -ge "$PAYLOAD4_MIN_MINOR" ] && [ "$NPM_TAG" != next ]; then
  echo "::error::Version '$VER' is on the Payload 4 line (minor >= $PAYLOAD4_MIN_MINOR) and must publish under 'next', not '$NPM_TAG'." >&2
  exit 1
fi
PRERELEASE_ARG=
if [[ "$VER" == *-* ]]; then
  PRERELEASE_ARG=--prerelease
fi

# Compare the heading literally: dots in a version are not regex wildcards.
awk -v ver="$VER" '
  index($0, "## [" ver "]") == 1 {flag=1; next}
  flag && /^## \[/ {exit}
  flag {print}
' CHANGELOG.md > release-notes.md
if ! grep -q '[^[:space:]]' release-notes.md; then
  echo "::error::No non-empty CHANGELOG section found for [$VER]. Add one before tagging." >&2
  exit 1
fi
# The CHANGELOG is shared: this package's own subsection must be present and non-empty.
if ! awk -v want="### ${PKG#packages/}" '$0 == want {flag=1; next} flag && /^### / {flag=0} flag && /[^[:space:]]/ {found=1} END {exit !found}' release-notes.md; then
  echo "::error::CHANGELOG section [$VER] has no non-empty '### ${PKG#packages/}' subsection." >&2
  exit 1
fi

if [ -n "${GITHUB_ENV:-}" ]; then
  printf 'PKG=%s\nVER=%s\nNPM_TAG=%s\nPRERELEASE_ARG=%s\n' \
    "$PKG" "$VER" "$NPM_TAG" "$PRERELEASE_ARG" >> "$GITHUB_ENV"
else
  printf 'PKG=%s\nVER=%s\nNPM_TAG=%s\nPRERELEASE_ARG=%s\n' \
    "$PKG" "$VER" "$NPM_TAG" "$PRERELEASE_ARG"
fi
