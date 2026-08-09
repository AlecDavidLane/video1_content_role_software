# Manual Setup Guide — From Scratch to a Working Commissioning Rig

Every step to build the complete system by hand: the Transition Layer
test source appliance, the full-screen kiosk boot, the OpenAVC room
control panel, and the end-to-end guided workflow. This is the manual
equivalent of what the Ansible deployment (`ansible/`) does in one
command — use it to understand the system, to build the first reference
machine, or to recover any piece of it.

Hardware assumed: a mini-PC (reference: Intel NUC BXNUC10i5FNHN) with
its HDMI/DP output feeding the display under test, on a LAN shared with
your phone. Everything runs on the one machine.

---

## Stage 1 — The test source appliance

### 1.1 Install the operating system

- Ubuntu **24.04 LTS Desktop** (24.04.x point releases are fine; newer
  releases are not supported — the package pins Python 3.12 wheels).
- Create a normal user during install (e.g. `tl-demo-1`), connect to
  the network, apply updates when prompted.

### 1.2 Build the package

```bash
sudo apt install -y git nodejs npm
git clone <this repo> && cd video1_content_role_software
./packaging/build-deb.sh
```

Produces `dist/tl-commissioning-source_<version>_amd64.deb` (~99 MB —
it bundles a pinned chrome-headless-shell for PDF rendering, because
Ubuntu's snap-packaged Chromium cannot be driven from a system
service).

### 1.3 Install it

```bash
sudo apt install ./dist/tl-commissioning-source_*_amd64.deb
```

This creates the `tl-source` service user, a virtualenv under
`/opt/transition-layer/commissioning-source`, the backend system
service (port **8808** — deliberately clear of OpenAVC's 8080), the
kiosk user unit, and the `tl-source` CLI on the PATH.

### 1.4 Configure the appliance

```bash
sudo -u tl-source tl-source init \
  --appliance-id TL-TESTSOURCE-01 \
  --source-number 1 \
  --company "Transition Layer" \
  --generate-api-token \
  --panel-url "http://{ip}:8080/panel" \
  --pin 246810
```

- **Save the printed API token now** — it is shown once and OpenAVC
  will need it in Stage 3.
- `{ip}` is typed literally: the appliance substitutes its current LAN
  address whenever the panel QR is generated, so DHCP lease changes
  never leave a stale QR.
- To run without the control PIN on a trusted bench network, use
  `--disable-pin` instead of `--pin ...` (state-changing API calls are
  then open to the LAN; the shipped default keeps protection on, per
  the brief's NFR-09/AC-13).
- Optional branding: `--logo /path/to/logo.png`,
  `--accent-colour "#00d4aa"`, `--report-footer "..."`.

```bash
sudo systemctl restart tl-commissioning-backend
tl-source healthcheck
```

Healthcheck at this point reports `UNHEALTHY: output_browser` — correct
until the kiosk starts in Stage 2. Everything else should be `ok`
(display/audio show `(SIMULATED)` until the desktop session is up).

### 1.5 First look at the phone UI

From a phone on the same LAN: `http://<machine-ip>:8808`. If you set a
PIN, state-changing actions ask for it. Home → pattern buttons should
respond (the display itself is still black until Stage 2).

---

## Stage 2 — Full-screen kiosk boot

Goal: power on → no keyboard → fullscreen test output.

### 2.1 Auto-login on Xorg

Edit `/etc/gdm3/custom.conf`:

```ini
[daemon]
AutomaticLoginEnable=true
AutomaticLogin=tl-demo-1        # your desktop user
WaylandEnable=false             # Xorg required: output-mode control is xrandr
```

### 2.2 Enable the kiosk for every desktop session

```bash
sudo systemctl --global enable tl-commissioning-kiosk
```

The unit waits for the backend and the window manager, kills any
leftover kiosk browser (prevents a restart loop of forwarded windows),
launches Chromium in kiosk mode, and force-fullscreens the window via
`wmctrl` as a belt-and-braces against the boot race.

### 2.3 Never blank the output

```bash
gsettings set org.gnome.desktop.session idle-delay 0
gsettings set org.gnome.desktop.screensaver lock-enabled false
gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-ac-type nothing
```

(X-level blanking/DPMS is already disabled by the kiosk unit itself.)

### 2.4 Reboot and verify

```bash
sudo reboot
```

Expected: auto-login → fullscreen **Identify** screen — source number,
control URL, clock, frame counter, and (because `--panel-url` was set)
a **SCAN FOR ROOM CONTROL** QR bottom-right. `tl-source healthcheck`
now exits 0.

Useful to know:

- Close the kiosk temporarily: `Ctrl+Alt+F3`, log in,
  `systemctl --user stop tl-commissioning-kiosk`, `Ctrl+Alt+F1` — the
  normal desktop is intact underneath. `start` (or reboot) brings it
  back.
- If someone presses Ctrl+minus in the kiosk (browser zoom out — it
  persists), click the pattern and press **Ctrl+0**.

---

## Stage 3 — Room control with OpenAVC

Goal: a phone/tablet panel that preps the room and drives the whole
guided test, with the appliance as the system of record.

### 3.1 Install OpenAVC

```bash
curl -sSL https://get.openavc.com | bash
```

Serves on port 8080 (the TL appliance runs on 8808 so they coexist).
First visit to `http://<machine-ip>:8080` claims the install — set the
Programmer password and store it somewhere safe (recovery: it is
readable in `/var/lib/openavc/system.json`).

### 3.2 Import the TL driver and add the device

- Programmer → Drivers → import
  `integrations/openavc/tl_commissioning_source.avcdriver` from this
  repo.
- Add a device from it (note the **device id** it gets, e.g.
  `video_1`).
- Connection: host **`127.0.0.1`**, port **8808**. Always 127.0.0.1 —
  the appliance is on the same machine, and a hardcoded LAN IP breaks
  the moment the config is replicated to another machine (or DHCP
  moves).
- Bearer token: paste the **API token from Stage 1.4**.
- The device should come online; its polled state (active_pattern,
  session_status, next_test, health_ok…) appears under the device.
  `health_ok` is false until the kiosk is running.

### 3.3 Add the room devices

Add your switcher and displays (e.g. Atlona AT-OME-PS62 + two displays
+ projector) and note their device ids. No real hardware? Start the
device simulator (Programmer login required, so run it from the
browser console on the dashboard, F12 →):

```javascript
fetch('/api/simulation/start', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({device_ids: ['switcher_1', 'display_l', 'display_r', 'projector_1']})
}).then(r => r.json()).then(console.log)
```

Two simulator rules: never include the TL device id (simulation would
hijack the real appliance), and the simulator dies on every OpenAVC
restart/reboot — re-run the fetch. (The panel script tolerates offline
room devices: room prep is skipped, the test still runs.)

### 3.4 Install the room script

Copy `integrations/openavc/room_commissioning_example.py` into the
project (Code view), and set the constants at the top to YOUR ids:
`TL`, `SWITCHER`, `TL_INPUT`, `ROOM_PATHS` (display id + switcher
output + human path description per path), `PROJECT`, `ROOM`.

The script is deliberately thin: the current step always comes from the
appliance (`next_test`), never a local counter, so a double-fired
button can never drift the panel out of sync. The appliance enforces
the rules regardless (FAIL requires a note, outcome is derived
server-side) — a mis-programmed panel cannot fake a pass.

### 3.5 Build the panel

UI Builder page with these element ids (the script listens for them):

| Element | id | Notes |
|---|---|---|
| 3 path buttons | `btn_test_left` / `btn_test_right` / `btn_test_proj` | one per signal path |
| PASS button | `btn_pass` | |
| FAIL button | `btn_fail` | |
| Note text input | `input_fail_note` | bind Shows→Value to `var.input_fail_note` (create the variable via the picker's "+ New Variable…") |
| Step label | `lbl_step` | bind Shows→Text to `var.tl_step_text` |
| Session label | `lbl_session` | bind Shows→Text to `var.tl_session_text` |
| Result label | `lbl_result` | bind Shows→Text to `var.tl_result_text` |

The fail-note binding matters: the box then always shows the note the
next FAIL will attach — reused across consecutive fails (one fault,
several failing steps: type it once), cleared automatically when a new
path starts. A COMPLETE button is optional — sessions finish
automatically when the last step is answered.

### 3.6 Wire the phone to the panel

Nothing to do — Stage 1.4's `--panel-url` already put the panel QR on
the Identify screen. Scan it: the OpenAVC panel opens in the phone
browser.

---

## Stage 4 — Run a commissioning session (and prove the whole loop)

### 4.1 The happy path

1. Scan the room-control QR on the display → panel opens.
2. Press **Test Left Monitor**: display powers on (real or simulated),
   switcher routes the test source, a TL session starts, the display
   shows **Identify — Step 1/6**.
3. **PASS** through the steps; each press advances the pattern
   (Identify → Alignment → Colour → Motion → Audio → Mode).
4. On the final PASS the session completes itself, the PDF report is
   generated, and the display switches to **GET YOUR REPORT** — a QR
   straight to the PDF plus "select another signal path to continue".
5. Scan the report QR with the phone → PDF downloads (open URL, no
   login; the newest report is also always at
   `http://<machine-ip>:8808/api/v1/reports/latest/download`).
6. Press the next path button — the finished session gives way to the
   new one (only one session can ever be active; starting a new one
   retires anything left behind, with an audit event).

### 4.2 Failing a step properly

Type the fault into the note box, press **FAIL** — the step records
with the note and the panel advances. Consecutive fails reuse the note
in the box; edit it when the fault changes. A FAIL with an empty box is
refused (the appliance rejects note-less failures — FR-22). A session
with any failed step completes as **Failed** and its report says so —
that is a valid, deliverable outcome.

### 4.3 Both interfaces, same session

The phone UI (`http://<machine-ip>:8808`) drives the *same* session as
the panel: use it mid-sequence to attach photo evidence, review
progress, or rescue anything (Review → Complete). Reports live under
Home → Recent reports.

### 4.4 Recovery cheat-sheet

| Symptom | Fix |
|---|---|
| Panel buttons do nothing | TL device offline in OpenAVC? Check host is 127.0.0.1 + token correct. Simulated room devices offline? Re-run the simulation fetch (§3.3) — the session still starts regardless. |
| Kiosk shows a stale/odd page | `systemctl --user restart tl-commissioning-kiosk` (files are served no-store, a restart always gets the current version) |
| Output zoomed/small | Click the pattern, **Ctrl+0** |
| Forgotten control PIN | `sudo -u tl-source tl-source init --pin <new>` (or `--disable-pin`) |
| Forgotten Programmer password | `sudo grep -o '"programmer_password": "[^"]*"' /var/lib/openavc/system.json` |
| Session debris from experiments | Stop backend, `sudo rm /var/lib/tl-commissioning-source/app.db*`, start backend (config/PIN/token survive; sessions and reports index reset) |
| Anything else | `tl-source healthcheck`, `sudo journalctl -u tl-commissioning-backend -n 50`, or `tl-source diag-bundle` |

### 4.5 Freeze it for replication

Once the rig is exactly right, capture it so the Ansible deployment
(`ansible/README.md`) can clone it to any number of machines:

```bash
# the OpenAVC side (devices, driver+token, panel, script, credentials):
sudo systemctl stop openavc
sudo tar czf openavc-state.tgz -C /var/lib openavc
sudo systemctl start openavc
# the appliance side is the .deb you built plus the same API token
```

Double-check the TL device host is **127.0.0.1** before capturing —
that single setting is what makes the snapshot machine-independent.
