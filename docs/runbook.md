# Runbook — build, package, deploy, operate

For developers and the Transition Layer role maintainer.

## Build & package

```bash
# 1. Frontend bundle (embeds into the backend package)
cd frontend && npm ci && npm run build

# 2. Backend tests
cd ../backend && python -m pytest

# 3. Smoke test (mock hardware; set SMOKE_CHROMIUM if chromium is not on PATH)
cd .. && bash scripts/smoke-test.sh

# 4. Debian package
packaging/build-deb.sh            # → dist/tl-commissioning-source_<version>_amd64.deb
```

Versioning: bump `project.version` in `backend/pyproject.toml` and
`__version__` in `backend/tl_commissioning_source/__init__.py` together.
`packaging/requirements.lock` pins every runtime dependency for the
recorded role version; regenerate it deliberately, never implicitly.

## Install / upgrade / rollback (non-interactive)

```bash
sudo apt install ./tl-commissioning-source_0.1.0_amd64.deb     # install or upgrade
sudo apt install ./tl-commissioning-source_0.0.9_amd64.deb     # rollback = install older
```

`postinst` is idempotent: creates the `tl-source` system user, builds the
venv from bundled wheels, installs the sample config only when none
exists, creates data dirs, enables + restarts the backend service. It
never overwrites `/etc/tl-commissioning-source/config.yaml`.

Configure without the UI (Ansible does exactly this):

```bash
VENV=/opt/transition-layer/commissioning-source/venv/bin
sudo -u tl-source $VENV/tl-source init \
  --appliance-id TL-TESTSOURCE-01 --friendly-name "TL Test Source" \
  --source-number 1 --company "Transition Layer" \
  --accent-colour "#0E7C66" --logo /path/logo.png \
  --pin 246810 --role-version tl-testsource-role-1.0.0
$VENV/tl-source healthcheck && echo OK
$VENV/tl-source sample-report --outcome passed    # acceptance artefact
```

## Kiosk session (appliance image)

The appliance runs an auto-logged-in minimal Xorg session for a `kiosk`
user. The package installs a **user** unit; enable it for that user:

```bash
sudo loginctl enable-linger kiosk
sudo -u kiosk systemctl --user enable tl-commissioning-kiosk
```

Screen blanking must be disabled in the session (`xset s off -dpms`) —
the Ansible role or the session autostart owns this, and FR-10 depends
on it. The unit already passes `--autoplay-policy=no-user-gesture-required`
so the audio pattern plays without input.

## Services

| Unit | Scope | Purpose |
|---|---|---|
| `tl-commissioning-backend.service` | system | API/UI server as `tl-source` user, `Restart=always` |
| `tl-commissioning-kiosk.service` | user (kiosk session) | Chromium kiosk on the HDMI output, `Restart=always` |

Logs: `journalctl -u tl-commissioning-backend` (and `--user -u
tl-commissioning-kiosk` inside the kiosk session). Application events are
also in the DB (`system_event`) and surfaced in the UI.

## Backup & restore

State lives in exactly three places (§13):

```
/etc/tl-commissioning-source/      config (PIN hash included — protect it)
/var/lib/tl-commissioning-source/  app.db + evidence/ + reports/
/var/log/tl-commissioning-source/  optional file logs
```

Backup = stop backend, copy those directories, start backend (SQLite is
WAL; a live copy is *usually* fine but a stopped copy is guaranteed).
Restore = install the same package version, restore the directories,
`chown -R tl-source:tl-source`, start.

`tl-source diag-bundle [--include-reports]` produces a support zip that
excludes secrets and photos by default.

## Storage & retention

`storage.low_disk_warn_mb` drives the disk health check;
`storage.max_photo_mb` caps uploads; `storage.report_retention_days = 0`
keeps reports forever (set a positive value to let operators prune old
PDFs manually — the app never deletes silently).

## Known-good acceptance sequence (AC-01…AC-14)

1. Clean Ubuntu 24.04 → install deb → services enabled (AC-01)
2. Reboot → holding/Identify on HDMI, phone control works (AC-02, AC-40)
3. Seven patterns at 1080p60/720p/2160p (AC-03) — see kiosk screenshots
4. Phone pattern change < 1 s (AC-04)
5. `scripts/smoke-test.sh` covers AC-05, AC-06, AC-08, AC-13, AC-14
6. Photo upload + captioned evidence in PDF (AC-07)
7. Attempt records connector/mode (AC-09, unit-tested)
8. `kill` backend/kiosk → systemd restarts, data intact (AC-10)
9. Unplug HDMI → fault banner + timestamped event (AC-11)
10. Soak interrupt cannot yield a false Passed (AC-12; soak completion is
    recorded separately and interruption is logged)
