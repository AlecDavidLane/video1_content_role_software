#!/usr/bin/env bash
# Build a versioned Debian package for Ubuntu 24.04 x86-64 (§12).
#
# The package ships the application into /opt/transition-layer/commissioning-source
# with its own virtualenv (pinned dependencies via requirements.lock), systemd
# units, config schema and a sample config. Installation is non-interactive
# and idempotent; postinst creates the tl-source user and data directories
# and enables the backend service.
#
# Usage: packaging/build-deb.sh [output-dir]
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${1:-$REPO_ROOT/dist}"
VERSION="$(python3 -c "import tomllib,pathlib;print(tomllib.loads(pathlib.Path('$REPO_ROOT/backend/pyproject.toml').read_text())['project']['version'])")"
PKG_NAME="tl-commissioning-source"
ARCH="amd64"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

echo "==> Building $PKG_NAME $VERSION"

# 1. Build the control UI into the backend package.
if command -v npm >/dev/null; then
  (cd "$REPO_ROOT/frontend" && npm ci && npm run build)
else
  echo "!! npm not found — reusing existing frontend build if present"
  test -f "$REPO_ROOT/backend/tl_commissioning_source/static/index.html" \
    || { echo "No frontend build found; install npm or build first"; exit 1; }
fi

# 2. Stage the filesystem layout (§13).
APP_DIR="$STAGE/opt/transition-layer/commissioning-source"
mkdir -p \
  "$APP_DIR" \
  "$STAGE/etc/tl-commissioning-source" \
  "$STAGE/usr/lib/systemd/system" \
  "$STAGE/usr/lib/systemd/user" \
  "$STAGE/DEBIAN"

cp "$REPO_ROOT/packaging/config.sample.yaml" "$STAGE/etc/tl-commissioning-source/config.yaml.sample"
cp "$REPO_ROOT/backend/tl_commissioning_source/config.schema.json" "$STAGE/etc/tl-commissioning-source/config.schema.json"
cp "$REPO_ROOT/packaging/systemd/tl-commissioning-backend.service" "$STAGE/usr/lib/systemd/system/"
cp "$REPO_ROOT/packaging/systemd/tl-commissioning-kiosk.service" "$STAGE/usr/lib/systemd/user/"

# 3. Wheel + pinned requirements, installed into a venv in postinst.
#    A throwaway build venv avoids PEP 668 "externally managed" refusals on
#    newer Ubuntu hosts; --only-binary ensures we bundle real wheels for the
#    host's Python (build host and appliance run the same OS image).
python3 -m venv "$STAGE/buildvenv"
"$STAGE/buildvenv/bin/pip" install --quiet --upgrade pip
(cd "$REPO_ROOT/backend" && "$STAGE/buildvenv/bin/pip" wheel --no-deps -w "$APP_DIR/wheels" . >/dev/null)

# The reference lock (packaging/requirements.lock) pins the Ubuntu 24.04 LTS
# / Python 3.12 target. On a host whose Python has no binary wheels for one
# of those pins, re-resolve within the pyproject constraints for THIS
# Python and bundle that lock in the package instead — the deb remains a
# fully pinned artifact either way, and the reference lock is not touched.
echo "==> Resolving pinned dependencies"
lock_ok=false
if "$STAGE/buildvenv/bin/pip" download --quiet --only-binary=:all: -d "$APP_DIR/wheels" \
      -r "$REPO_ROOT/packaging/requirements.lock" 2>/dev/null; then
  # Prove the bundle supports a fully OFFLINE install of the application —
  # a dry-run against only the bundled wheels catches any transitive
  # dependency missing from the lock before it can ship.
  if "$STAGE/buildvenv/bin/pip" install --quiet --dry-run --only-binary=:all: --no-index \
        --find-links "$APP_DIR/wheels" -r "$REPO_ROOT/packaging/requirements.lock" \
        tl-commissioning-source >/dev/null 2>&1; then
    cp "$REPO_ROOT/packaging/requirements.lock" "$APP_DIR/requirements.lock"
    lock_ok=true
  else
    echo "!! Reference lock is incomplete for an offline install on this Python."
  fi
else
  echo "!! Reference lock has pins without binary wheels for $(python3 --version)."
fi
if [ "$lock_ok" != true ]; then
  echo "   Re-resolving dependencies for this Python (reference lock unchanged)."
  "$STAGE/buildvenv/bin/pip" install --quiet --only-binary=:all: "$REPO_ROOT/backend"
  "$STAGE/buildvenv/bin/pip" freeze --exclude tl-commissioning-source > "$APP_DIR/requirements.lock"
  "$STAGE/buildvenv/bin/pip" download --quiet --only-binary=:all: -d "$APP_DIR/wheels" \
      -r "$APP_DIR/requirements.lock"
  "$STAGE/buildvenv/bin/pip" install --quiet --dry-run --only-binary=:all: --no-index \
      --find-links "$APP_DIR/wheels" -r "$APP_DIR/requirements.lock" \
      tl-commissioning-source >/dev/null
  echo "   Bundled lock for this build:"
  sed 's/^/     /' "$APP_DIR/requirements.lock"
fi

# 4. Bundle chrome-headless-shell for PDF generation. Ubuntu's chromium is
#    a snap, which the tl-source system service cannot drive (confinement
#    denies its runtime dir, /var/lib and a shared /tmp), so the package
#    carries Google's standalone headless shell instead. The current Stable
#    version is resolved at build time and recorded; skip with
#    TL_NO_BUNDLED_CHROME=1 (PDF then needs report.chromium_path on the
#    appliance).
if [ "${TL_NO_BUNDLED_CHROME:-0}" != "1" ]; then
  CFT_JSON="$(curl -fsSL --max-time 30 \
    https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json 2>/dev/null || true)"
  SHELL_URL="$(printf '%s' "$CFT_JSON" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    downloads = data['channels']['Stable']['downloads']['chrome-headless-shell']
    print(next(d['url'] for d in downloads if d['platform'] == 'linux64'))
except Exception:
    pass" 2>/dev/null || true)"
  SHELL_VER="$(printf '%s' "$CFT_JSON" | python3 -c "
import json, sys
try:
    print(json.load(sys.stdin)['channels']['Stable']['version'])
except Exception:
    pass" 2>/dev/null || true)"
  if [ -n "$SHELL_URL" ] && [ -n "$SHELL_VER" ]; then
    CACHE_DIR="$REPO_ROOT/packaging/.cache"
    mkdir -p "$CACHE_DIR"
    SHELL_ZIP="$CACHE_DIR/chrome-headless-shell-$SHELL_VER-linux64.zip"
    if [ ! -f "$SHELL_ZIP" ]; then
      echo "==> Downloading chrome-headless-shell $SHELL_VER"
      curl -fsSL -o "$SHELL_ZIP.part" "$SHELL_URL" && mv "$SHELL_ZIP.part" "$SHELL_ZIP"
    fi
    unzip -q "$SHELL_ZIP" -d "$APP_DIR"
    mv "$APP_DIR/chrome-headless-shell-linux64" "$APP_DIR/chrome-headless-shell"
    chmod 755 "$APP_DIR/chrome-headless-shell/chrome-headless-shell"
    echo "$SHELL_VER" > "$APP_DIR/chrome-headless-shell/VERSION"
    echo "==> Bundled chrome-headless-shell $SHELL_VER"
  else
    echo "!! Could not resolve a chrome-headless-shell download (offline build?)."
    echo "   PDF generation on the appliance will need report.chromium_path"
    echo "   pointing at a non-snap Chrome/Chromium."
  fi
fi

# 5. Control files.
cat > "$STAGE/DEBIAN/control" <<EOF
Package: $PKG_NAME
Version: $VERSION
Section: utils
Priority: optional
Architecture: $ARCH
Depends: python3 (>= 3.11), python3-venv, chromium-browser | chromium, curl, xserver-xorg-core, x11-xserver-utils, wmctrl, pulseaudio-utils | pipewire-pulse, libnss3, libnspr4, libexpat1, libfontconfig1, libglib2.0-0t64 | libglib2.0-0
Maintainer: Transition Layer <ops@transitionlayer.invalid>
Description: Portable AV commissioning test source
 Turns a mini-PC into a guided HDMI test source with a phone control
 interface and client-ready commissioning reports. Proprietary; see
 /opt/transition-layer/commissioning-source/LICENSE.
EOF

cp "$REPO_ROOT/LICENSE" "$APP_DIR/LICENSE"

cat > "$STAGE/DEBIAN/postinst" <<'EOF'
#!/bin/sh
set -e
APP=/opt/transition-layer/commissioning-source

# Dedicated unprivileged user (NFR-09). Idempotent.
if ! getent passwd tl-source >/dev/null; then
    adduser --system --group --no-create-home --home /var/lib/tl-commissioning-source tl-source
fi
adduser tl-source video >/dev/null 2>&1 || true
adduser tl-source audio >/dev/null 2>&1 || true

# Virtualenv with pinned wheels (idempotent: reuse if version matches).
# --only-binary for locked deps: an appliance must never compile C
# extensions. If no binary wheel exists for this Python, fail with a clear
# message instead of a 300-line compiler error.
if [ ! -x "$APP/venv/bin/pip" ]; then
    python3 -m venv "$APP/venv"
fi
"$APP/venv/bin/pip" install --quiet --upgrade pip
PIPFLAGS="--only-binary=:all:"
# Install the app wheel by explicit path: naming the bare package would let
# pip treat an older installed version as "satisfied" and skip the upgrade.
APP_WHEEL="$(ls "$APP"/wheels/tl_commissioning_source-*.whl 2>/dev/null | head -1)"
if [ -n "$APP_WHEEL" ]; then
    if ! "$APP/venv/bin/pip" install --quiet $PIPFLAGS --no-index --find-links "$APP/wheels" \
            -r "$APP/requirements.lock" "$APP_WHEEL" >/dev/null 2>&1; then
        echo "Offline wheel bundle incomplete; retrying with PyPI..."
        "$APP/venv/bin/pip" install --quiet $PIPFLAGS --find-links "$APP/wheels" \
            -r "$APP/requirements.lock" "$APP_WHEEL" || {
            echo "ERROR: no binary wheels available for python3 ($(python3 --version))." >&2
            echo "Supported reference OS is Ubuntu 24.04 LTS (Python 3.12); newer" >&2
            echo "releases work when packaging/requirements.lock pins versions that" >&2
            echo "publish wheels for that Python. See docs/install-and-test.md." >&2
            exit 1
        }
    fi
else
    echo "ERROR: application wheel missing from $APP/wheels" >&2
    exit 1
fi

# Config: install sample on first install only; never overwrite (idempotent).
if [ ! -f /etc/tl-commissioning-source/config.yaml ]; then
    cp /etc/tl-commissioning-source/config.yaml.sample /etc/tl-commissioning-source/config.yaml
fi

# Data/log directories (§13).
install -d -o tl-source -g tl-source \
    /var/lib/tl-commissioning-source \
    /var/lib/tl-commissioning-source/reports \
    /var/lib/tl-commissioning-source/evidence \
    /var/log/tl-commissioning-source
chown -R tl-source:tl-source /etc/tl-commissioning-source

# CLI on the system PATH (works under sudo too, which resets PATH).
ln -sf "$APP/venv/bin/tl-source" /usr/local/bin/tl-source

systemctl daemon-reload || true
systemctl enable tl-commissioning-backend.service >/dev/null 2>&1 || true
systemctl restart tl-commissioning-backend.service || true
exit 0
EOF
chmod 755 "$STAGE/DEBIAN/postinst"

cat > "$STAGE/DEBIAN/prerm" <<'EOF'
#!/bin/sh
set -e
if [ "$1" = "remove" ]; then
    systemctl stop tl-commissioning-backend.service || true
    systemctl disable tl-commissioning-backend.service || true
    rm -f /usr/local/bin/tl-source
fi
exit 0
EOF
chmod 755 "$STAGE/DEBIAN/prerm"

# 6. Build.
mkdir -p "$OUT_DIR"
DEB="$OUT_DIR/${PKG_NAME}_${VERSION}_${ARCH}.deb"
dpkg-deb --build --root-owner-group "$STAGE" "$DEB"
echo "==> Built $DEB"
