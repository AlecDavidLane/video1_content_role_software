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

# 3. Wheel + pinned requirements, installed into a venv in postinst
#    (keeps the .deb architecture-independent of the build host's Python).
(cd "$REPO_ROOT/backend" && python3 -m pip wheel --no-deps -w "$APP_DIR/wheels" . >/dev/null)
python3 -m pip download -d "$APP_DIR/wheels" -r "$REPO_ROOT/packaging/requirements.lock" >/dev/null 2>&1 || \
  echo "!! Offline wheel download failed; postinst will fall back to PyPI"
cp "$REPO_ROOT/packaging/requirements.lock" "$APP_DIR/requirements.lock"

# 4. Control files.
cat > "$STAGE/DEBIAN/control" <<EOF
Package: $PKG_NAME
Version: $VERSION
Section: utils
Priority: optional
Architecture: $ARCH
Depends: python3 (>= 3.11), python3-venv, chromium-browser | chromium, xserver-xorg-core, x11-xserver-utils, pulseaudio-utils | pipewire-pulse
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
if [ ! -x "$APP/venv/bin/tl-source" ]; then
    python3 -m venv "$APP/venv"
fi
"$APP/venv/bin/pip" install --quiet --upgrade pip
if ls "$APP"/wheels/*.whl >/dev/null 2>&1; then
    "$APP/venv/bin/pip" install --quiet --no-index --find-links "$APP/wheels" \
        -r "$APP/requirements.lock" tl-commissioning-source || \
    "$APP/venv/bin/pip" install --quiet --find-links "$APP/wheels" \
        -r "$APP/requirements.lock" tl-commissioning-source
else
    "$APP/venv/bin/pip" install --quiet -r "$APP/requirements.lock" tl-commissioning-source
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
fi
exit 0
EOF
chmod 755 "$STAGE/DEBIAN/prerm"

# 5. Build.
mkdir -p "$OUT_DIR"
DEB="$OUT_DIR/${PKG_NAME}_${VERSION}_${ARCH}.deb"
dpkg-deb --build --root-owner-group "$STAGE" "$DEB"
echo "==> Built $DEB"
