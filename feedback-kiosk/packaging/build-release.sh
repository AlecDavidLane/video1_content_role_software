#!/usr/bin/env bash
# Build a versioned, checksummed, fully offline kiosk release (brief §8).
# Run on Ubuntu 24.04 with Node 20 and internet (the ONLY step needing it).
# Output: dist/feedback-kiosk-<version>.tar.gz + .sha256
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
APP="$HERE/../app"
OUT="$HERE/../dist"
VERSION="$(node -p "require('$APP/package.json').version")"

echo "==> Building feedback-kiosk $VERSION"
cd "$APP"
# npm ci once a lockfile exists (deterministic); first ever build
# generates it - commit package-lock.json after that build.
if [ -f package-lock.json ]; then npm ci; else npm install; fi
npm run fetch-models          # bundle emotion models into public/models
rm -rf .next
npm run build                 # output: 'standalone'

STAGE="$(mktemp -d)/feedback-kiosk-$VERSION"
mkdir -p "$STAGE"
# Standalone server + the assets Next leaves out of it.
cp -r .next/standalone/. "$STAGE/"
mkdir -p "$STAGE/.next/static" "$STAGE/public"
cp -r .next/static/. "$STAGE/.next/static/"
cp -r public/. "$STAGE/public/"
cp -r locales "$STAGE/locales"        # read at runtime by lib/config.js
echo "$VERSION" > "$STAGE/RELEASE"

mkdir -p "$OUT"
TAR="$OUT/feedback-kiosk-$VERSION.tar.gz"
tar czf "$TAR" -C "$(dirname "$STAGE")" "feedback-kiosk-$VERSION"
(cd "$OUT" && sha256sum "$(basename "$TAR")" > "$(basename "$TAR").sha256")
echo "==> Built $TAR"
cat "$TAR.sha256"
