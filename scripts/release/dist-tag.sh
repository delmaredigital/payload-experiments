#!/usr/bin/env bash
set -euo pipefail

VER=${1:-}
if [ "$#" -ne 1 ] || ! [[ "$VER" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  echo "::error::Invalid version '$VER'; use X.Y.Z or X.Y.Z-next.0." >&2
  exit 1
fi

if [[ "$VER" != *-* ]]; then
  echo latest
  exit 0
fi

PRE=${VER#*-}
DIST_TAG=${PRE%%.*}
if ! [[ "$DIST_TAG" =~ ^[a-z][a-z0-9-]*$ ]] || [ "$DIST_TAG" = latest ]; then
  echo "::error::Prerelease '$VER' has no usable dist-tag identifier ('$DIST_TAG'); use X.Y.Z-next.0." >&2
  exit 1
fi

echo "$DIST_TAG"
