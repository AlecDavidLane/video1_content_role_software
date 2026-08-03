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

## Scope

This driver covers **live source control** — the piece an AV control
processor legitimately owns. The guided commissioning workflow (sessions,
pass/fail evidence, photos, reports) intentionally stays on the
appliance's own phone UI and API: those records are the appliance's audit
trail. If you later want session data on a panel (e.g. showing overall
progress), read it via `GET /api/v1/sessions/{id}` with the same bearer
token — the full API is self-documented at `http://<appliance>:8808/api/docs`.
