# Local API & OpenAVC integration notes

The appliance exposes a versioned local HTTP/WebSocket API. OpenAVC (or
any orchestrator) integrates as an **adapter over this API** — nothing is
embedded in the application core, and the appliance is fully functional
without OpenAVC.

> **Ready-made OpenAVC driver:** `integrations/openavc/` contains a
> validated `.avcdriver` file for the OpenAVC platform plus a README
> covering installation, the static API token, and how to lay out a
> commissioning touch panel. The notes below describe the raw API that
> driver (and any other integration) sits on.

## Static API token for integrations

Panel platforms authenticate with a provisioned bearer token instead of
the phone UI's PIN exchange:

```bash
sudo -u tl-source /opt/transition-layer/commissioning-source/venv/bin/tl-source \
  init --generate-api-token     # prints the token once
```

The token is accepted by all state-changing endpoints, stored as a
secret, and excluded from config exports and diagnostic bundles. Rotate
by re-running the command.

- Base URL: `http://<appliance>:8808`
- OpenAPI: `GET /api/openapi.json`, interactive docs at `/api/docs`
- Live events: `WS /api/v1/events` (JSON frames `{type, at, payload}`)

## Authentication

Read endpoints are open on the local network. State-changing endpoints
require a bearer token once first-run setup is complete:

```
POST /api/v1/auth/token   {"pin": "<control-pin>"}
→ {"token": "...", "expires_at": "..."}
Authorization: Bearer <token>
```

Tokens expire after `security.token_ttl_seconds` (default 12 h).

## Endpoint summary (§10 of the brief)

| Method & path | Purpose |
|---|---|
| `GET /health` | Process + dependency health (200/503) |
| `GET /api/v1/status` | Pattern, output, audio, identity, session, soak |
| `GET /api/v1/patterns` | Pattern catalogue and parameters |
| `POST /api/v1/patterns/{key}/activate` | Activate pattern (optional `params`) |
| `POST /api/v1/output/mode` | `{connector, mode:"1920x1080@60"}` — advertised modes only |
| `POST /api/v1/audio/sink` | `{sink}` from the enumerated list |
| `POST /api/v1/sessions` | Create session |
| `GET /api/v1/sessions/{id}` | Session incl. attempts, evidence metadata, progress |
| `POST /api/v1/sessions/{id}/start` | Draft → in progress |
| `POST /api/v1/sessions/{id}/tests/{key}/attempts` | Record pass/fail (`note` required on fail) |
| `POST /api/v1/sessions/{id}/complete` | Validates and derives Passed/Failed |
| `POST /api/v1/sessions/{id}/report` | Generate/regenerate PDF+JSON revision |
| `GET /api/v1/current-session` | The in-progress session (falls back to last completed) |
| `POST /api/v1/current-session/tests/{key}/attempts` | Record on the active session — no ID plumbing (panel flows) |
| `POST /api/v1/current-session/complete` | Complete the active session |
| `POST /api/v1/current-session/report` | Report for the active / most recently completed session |
| `GET /api/v1/reports/latest/download` | Newest report PDF (`?kind=json` for the JSON) — open read, bookmarkable |
| `GET /api/v1/reports/latest/qr.svg` | QR code pointing at the newest report's PDF |
| `WS /api/v1/events` | `pattern`, `output`, `audio`, `session`, `attempt`, `fault`, `recovery`, `soak_step`, `soak_complete` |

`POST /api/v1/sessions` accepts `"autostart": true` to create and start a
session in one call. The `current-session` aliases resolve "the session
being worked on" server-side (most recent in-progress, falling back to
most recently completed where sensible) — designed for panel platforms
whose macros cannot capture and re-send IDs.

Only one session can be active at a time: starting (or reopening) a
session automatically retires any session still `in_progress`/`review`.
Retired sessions are soft-deleted with a `session_abandoned` audit event —
their attempts and evidence stay in the database, they just leave the
lists. An adapter therefore never has to clean up after an abandoned run;
pressing a "start path" button is always safe.

Generating a report also switches the connected display to a
"GET YOUR REPORT" screen: a QR code straight to that report's PDF plus
"select another signal path to continue". Engineers scan it with a phone
and get the PDF directly — no appliance UI involved. The screen clears as
soon as the next pattern is activated (e.g. the next path's Identify).

Rules an adapter can rely on (enforced server-side):

- A failed attempt without a note is rejected (409).
- `complete` returns 409 while any selected test is unanswered; the
  outcome (`completed_passed`/`completed_failed`) is derived from the
  latest attempts, never supplied by the caller.
- Attempts are append-only; retests increment `attempt_number`.
- `POST .../report` works only on completed sessions and returns
  `{pdf_path, json_path, json_sha256, revision}`.

## Example: drive a full session

```bash
B=http://tl-source.local:8808; T=$(curl -s $B/api/v1/auth/token -d '{"pin":"246810"}' -H 'Content-Type: application/json' | jq -r .token)
H="Authorization: Bearer $T"
S=$(curl -s -X POST $B/api/v1/sessions -H "$H" -H 'Content-Type: application/json' \
  -d '{"project_name":"Demo","room":"R1","selected_tests":["identify","colour"]}' | jq -r .id)
curl -s -X POST $B/api/v1/sessions/$S/start -H "$H" > /dev/null
for k in identify colour; do
  curl -s -X POST $B/api/v1/patterns/$k/activate -H "$H" -d '{}' -H 'Content-Type: application/json' > /dev/null
  curl -s -X POST $B/api/v1/sessions/$S/tests/$k/attempts -H "$H" \
    -H 'Content-Type: application/json' -d '{"result":"pass"}' > /dev/null
done
curl -s -X POST $B/api/v1/sessions/$S/complete -H "$H" | jq .status
curl -s -X POST $B/api/v1/sessions/$S/report -H "$H" | jq .
```

## Kiosk contract

The kiosk page connects as `WS /api/v1/events?role=kiosk`; the backend
uses that connection for the `output_browser` health check. An external
renderer could replace the built-in page by honouring the same contract:
render `payload.active_pattern` from the `hello`/`pattern` frames.
