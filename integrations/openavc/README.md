# OpenAVC Integration

`tl_commissioning_source.avcdriver` is an OpenAVC device driver for the
Transition Layer commissioning test source. It is a pure adapter over the
appliance's public REST API (`/api/v1`) — nothing OpenAVC-specific lives
in the application, and the appliance works fully without OpenAVC
(brief §3/§10).

## 1. Provision an API token on the appliance

OpenAVC authenticates with a static bearer token (its YAML HTTP drivers
cannot perform the phone UI's PIN → short-lived-token exchange):

```bash
sudo -u tl-source /opt/transition-layer/commissioning-source/venv/bin/tl-source \
  init --generate-api-token
# → API token (store it now; it is not shown again): <token>
sudo systemctl restart tl-commissioning-backend
```

The token is stored in the appliance config as a secret (never included
in config exports or diagnostic bundles) and is accepted by every
state-changing endpoint alongside PIN-issued tokens. Rotate it any time
by running the command again; `--api-token <value>` sets a specific one.

## 2. Install the driver in OpenAVC

Programmer IDE → **Devices** → **Drivers** tab → **Import**, and select
`tl_commissioning_source.avcdriver`. (Or copy the file into your OpenAVC
user drivers directory and reload.)

## 3. Add the device

**Devices → Add Device → TL Commissioning Test Source**, then:

| Field | Value |
|---|---|
| IP Address / Hostname | the appliance's address |
| Port | `8808` |
| Authentication | `bearer` |
| API Token | the token from step 1 |

The driver polls `/api/v1/status` every 3 seconds and keeps these state
variables live: `active_pattern`, `output_connector`, `output_mode`,
`soak_running`, `soak_remaining`, `health_ok`, `session_id`,
`app_version`.

## 4. Build the control panel

In the Programmer IDE's **UI Builder**, a sensible commissioning panel:

- **Pattern row** — seven buttons bound to the driver commands
  `show_identify`, `show_alignment`, `show_colour`, `show_motion`,
  `show_audio`, `show_mode`, `show_holding`. Use each button's active /
  feedback state bound to `active_pattern` equalling that pattern key, so
  the current pattern lights up (the same live behaviour as the
  appliance's own phone UI).
- **Output block** — a text/status element showing `output_connector` +
  `output_mode`, plus buttons that call `set_output_mode` with fixed
  params for your house standards (e.g. one button per
  `1920x1080@60` / `3840x2160@60`). Only modes advertised by the display
  are accepted; a rejected mode returns an error the panel surfaces.
- **Soak block** — a button for `start_soak` (parameter prompt or a fixed
  duration), a `stop_soak` button shown while `soak_running` is true, and
  a label bound to `soak_remaining`.
- **Health tile** — bind a status indicator to `health_ok`, and a small
  label to `session_id` so the operator can see when a guided test is in
  progress on the phone.

Macros/triggers compose naturally: e.g. a "Line-check" macro that steps
Identify → Colour → Motion with 10-second delays, or a trigger that
flags the room when `health_ok` goes false.

## 5. Full room workflow: guided testing from the panel

The driver also exposes the guided-session workflow, so a room panel can
run the whole commissioning sequence — the appliance stays the system of
record (a FAIL without a note is rejected, and the Passed/Failed outcome
is derived server-side, so a mis-programmed panel cannot fake a pass).

Session commands (all use the appliance's `current-session` aliases — no
session-ID plumbing needed in macros):

| Command | Purpose |
|---|---|
| `begin_session` | Create **and start** a session (project, room, signal-path description) |
| `record_pass` / `record_fail` | Answer the current step (`record_fail` requires a note) |
| `complete_session` | Validate and complete; outcome is derived |
| `generate_report` | PDF + JSON for the completed session |

Model **one session per signal path** — that is what a session is in the
appliance's data model. For a room with three displays, three sessions →
three crisp reports.

`room_commissioning_example.py` in this directory is a ready-to-adapt
OpenAVC script for a three-display room (left monitor, right monitor,
projector, one switcher). Each "Test <display>" button powers the
display, routes the test source through the switcher, starts a TL session
for that path and steps through the checklist; PASS/FAIL buttons and a
failure-note input drive the attempts; Complete generates the report.
Copy it into your project's `scripts/` folder, register it in the `.avc`
file, set the device IDs / switcher I/O at the top, and create the panel
elements listed in its docstring.

Two bindings matter for a smooth panel:

- **Labels** (`lbl_step` / `lbl_session` / `lbl_result`): bind each one's
  Shows → Text to `var.tl_step_text` / `var.tl_session_text` /
  `var.tl_result_text`.
- **Fail-note input** (`input_fail_note`): bind its Shows → Value to
  `var.input_fail_note` (create the variable from the picker's
  "+ New Variable…" if it isn't listed yet). The box then always shows
  the note the next FAIL will attach: it is reused across consecutive
  fails (one fault, several failing steps — type it once) and cleared
  automatically when a new path starts. The script must NOT clear it
  after each fail: OpenAVC won't overwrite a focused text input from a
  binding, so the box would keep displaying a note the script no longer
  holds and the next FAIL press would look dead.

Photo evidence remains a phone thing (panels have no camera) — both
interfaces drive the *same session*, so an engineer can attach photos
from the phone mid-sequence while pass/fail comes from the panel.

## 6. Auto-saving reports to a share

Solve this on the appliance, not in the panel: mount your network share
and point the reports directory at it — every report (panel- or
phone-driven) then lands on the share the moment it is generated.

```bash
# Example: SMB share via /etc/fstab (credentials in a root-only file)
//fileserver/commissioning /mnt/commissioning cifs \
  credentials=/etc/tl-commissioning-source/.smbcred,uid=tl-source,gid=tl-source,_netdev 0 0
```

Then in `/etc/tl-commissioning-source/config.yaml`:

```yaml
storage:
  reports_dir: /mnt/commissioning/reports
```

and `sudo systemctl restart tl-commissioning-backend`. If the share is
down, report generation fails visibly (nothing is silently lost — the
session data stays on the appliance and the report can be regenerated).
Keep `data_dir` and `evidence_dir` local so the appliance works fully
offline; the share is only the report drop.

Alternative: an OpenAVC script can pull the PDF itself via
`GET /api/v1/reports/{id}/download` with the same bearer token.

## Scope

This driver covers live source control **and** the guided-session
workflow via the current-session aliases. Deeper session data (attempt
history, evidence metadata) is available to scripts via
`GET /api/v1/sessions/{id}` with the same bearer token — the full API is
self-documented at `http://<appliance>:8808/api/docs`.
