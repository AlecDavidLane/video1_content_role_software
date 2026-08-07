# Install & Test on a Fresh Ubuntu Machine

From clean Ubuntu to a tested appliance in two stages: a quick
functional test (~10 minutes), then the full kiosk appliance setup.

> **Port:** the appliance serves everything on **8808** (chosen so it
> coexists with an OpenAVC controller, whose default is 8080, on the same
> machine). Upgrading an install that was configured before this change?
> The installer never rewrites `/etc/tl-commissioning-source/config.yaml`,
> so update it manually: `sudo sed -i 's/port: 8080/port: 8808/'
> /etc/tl-commissioning-source/config.yaml && sudo systemctl restart
> tl-commissioning-backend`.

> **Supported OS:** the reference target is **Ubuntu 24.04 LTS**
> (Python 3.12) — use that for production appliances and the recorded
> role; `packaging/requirements.lock` is pinned against it. On a newer
> Ubuntu release, `build-deb.sh` detects when a reference pin has no
> binary wheel for that Python and automatically re-resolves a pin set
> for the build host (printed during the build and bundled in the deb),
> so the package still installs fully pinned. The appliance never
> compiles C extensions — a missing wheel fails fast with a clear
> message rather than a compiler error.
For ongoing operations (update, rollback, backup) see
[runbook.md](runbook.md); for on-site use see
[operator-guide.md](operator-guide.md).

## Stage 1 — Install and verify (~10 minutes)

### 1. Prerequisites (internet required for this part)

```bash
sudo apt update
sudo apt install -y git python3-pip python3-venv nodejs npm chromium-browser curl
```

> On Ubuntu 24.04, `chromium-browser` installs Chromium via snap — that is
> fine; the application autodetects it.

### 2. Clone and build the package

```bash
git clone https://github.com/AlecDavidLane/video1_content_role_software.git
cd video1_content_role_software
packaging/build-deb.sh
```

This builds the React control UI, bundles pinned Python wheels, downloads
and bundles Google's standalone `chrome-headless-shell` for PDF
generation (Ubuntu's snap chromium cannot be driven by a system service),
and produces `dist/tl-commissioning-source_<version>_amd64.deb`. The
build needs internet access; the shell download is cached under
`packaging/.cache/` for subsequent builds.

### 3. Install

```bash
sudo apt install ./dist/tl-commissioning-source_*_amd64.deb
```

The postinst creates the unprivileged `tl-source` user, builds the
application venv, installs the default configuration to
`/etc/tl-commissioning-source/config.yaml` (never overwritten on
upgrade) and enables + starts the backend service.

### 4. Initialise the appliance

This is exactly what the Ansible role does later — identity, branding
and PIN with no UI interaction:

```bash
sudo -u tl-source /opt/transition-layer/commissioning-source/venv/bin/tl-source \
  init --appliance-id TL-TESTSOURCE-01 --source-number 1 \
  --company "Transition Layer" --pin 246810
sudo systemctl restart tl-commissioning-backend
```

### 5. Verify

```bash
/opt/transition-layer/commissioning-source/venv/bin/tl-source healthcheck
```

Expect **exit code 1 with `UNHEALTHY: output_browser`** at this stage —
that is correct: everything is up except the kiosk browser, which is not
running yet. Exit code 0 comes after Stage 2.

Then:

- Open `http://localhost:8808` on the machine — the control UI loads.
- From a **phone on the same network**, scan the QR code on the Home
  screen (or browse to `http://<machine-ip>:8808`). Enter the PIN for
  any state-changing action.

### 6. Quick kiosk test (no appliance setup needed)

Open a second browser window at `http://localhost:8808/kiosk/` and press
F11 for fullscreen. Change patterns from the phone — the window should
update within one second. This proves the entire control path.

### 7. Generate a test report

Run a session end-to-end from the phone (New test → pass/fail steps →
Review → Complete → Generate report), or shortcut it:

```bash
sudo -u tl-source /opt/transition-layer/commissioning-source/venv/bin/tl-source \
  sample-report --outcome failed
ls /var/lib/tl-commissioning-source/reports/
```

### Optional: automated smoke test

From the repository (uses a scratch config and mock hardware; does not
touch the installed appliance state):

```bash
bash scripts/smoke-test.sh
```

## Stage 2 — Full appliance behaviour (kiosk on the HDMI output)

Makes the machine boot straight into the test pattern with no keyboard:

```bash
# 1. Create the kiosk user
sudo adduser --disabled-password --gecos "" kiosk

# 2. Auto-login: Settings → Users → kiosk → Automatic Login, or edit
#    /etc/gdm3/custom.conf:
#      AutomaticLoginEnable=true
#      AutomaticLogin=kiosk
#    IMPORTANT: select "Ubuntu on Xorg" at the login screen once —
#    Wayland is not supported in v1 (xrandr output control).

# 3. Enable the kiosk unit for every desktop session
sudo systemctl --global enable tl-commissioning-kiosk

# 4. Disable GNOME idle blanking / locking / sleep for the kiosk user
#    (X-level blanking is already disabled by the kiosk unit via xset):
sudo -u kiosk dbus-launch gsettings set org.gnome.desktop.session idle-delay 0
sudo -u kiosk dbus-launch gsettings set org.gnome.desktop.screensaver lock-enabled false
sudo -u kiosk dbus-launch gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-ac-type nothing
```

> Deploying a fleet? The Ansible role in `ansible/` does all of Stage 1
> and Stage 2 (install, configure, autologin, kiosk, validation) in one
> play — see `ansible/README.md`.

Reboot. The HDMI output comes up black (holding screen), then shows
**Identify** once the backend is ready — no cursor, no desktop chrome —
and `tl-source healthcheck` now returns 0.

## Acceptance checks to run on the reference hardware

Everything else is covered by the automated tests and smoke test; these
need a real display, cable and speakers:

| # | Check | Expectation |
|---|---|---|
| 1 | Patterns → Output mode → `3840x2160@60` on a 4K display | Display reports and holds the mode (AC-03, AC-09) |
| 2 | Patterns → Audio sink → HDMI sink, run Audio pattern | "Left" left only, "Right" right only (real `pactl` naming) |
| 3 | Pull the HDMI cable | Phone UI shows "HDMI output disconnected" within ~2 s; timestamped event logged (AC-11) |
| 4 | `sudo pkill -f "tl-source serve"` | systemd restarts the backend; phone reconnects; results intact (AC-10) |
| 5 | Cold power-cycle mid-session | Session and recorded results survive the reboot (AC-02, NFR-05) |

If anything misbehaves — the likely candidates on a NUC are snap-Chromium
kiosk flags and HDMI audio sink naming — capture a diagnostics bundle and
share it:

```bash
/opt/transition-layer/commissioning-source/venv/bin/tl-source diag-bundle
```
