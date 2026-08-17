# Control machine setup (macOS)

The control plane: Node-RED receives WhatsApp messages via a Twilio
webhook, OpenCode interprets them into a restricted intent,
`deploy-kiosk` runs the Ansible role, and Twilio replies with the
result. Raw message text never reaches a shell (base64 boundary +
enum validation at every layer).

## 1. Install

```bash
brew install node-red cloudflared
npm install -g opencode-ai        # the OpenCode CLI (optional at first:
                                  # interpret-intent has a keyword fallback)
```

## 2. Environment

Node-RED and the helpers read everything from environment variables -
credentials never live in the flow. Create `~/.fk-control.env`:

```bash
export FK_CONTROL_DIR="$HOME/video1_content_role_software/feedback-kiosk/control"
export FK_AUDIT_LOG="$HOME/fk-audit.jsonl"
export AUTHORIZED_NUMBERS="+447700900000"          # comma-separated, no whatsapp: prefix
export TWILIO_ACCOUNT_SID="ACxxxxxxxx"
export TWILIO_AUTH_TOKEN="..."
export TWILIO_WHATSAPP_FROM="whatsapp:+14155238886" # the Twilio sandbox number
export DEFAULT_NOTIFY="+447700900000"
```

Then always start Node-RED from a shell that has them:

```bash
source ~/.fk-control.env && node-red
```

## 3. Import the flow

Node-RED editor (http://127.0.0.1:1880) → menu → Import →
`node-red-flow.json` → Deploy. The flow listens on
`POST /whatsapp`.

## 4. Twilio WhatsApp sandbox

1. Twilio Console → Messaging → Try it out → WhatsApp sandbox.
2. Join the sandbox from your phone (send the join code it shows).
3. Start a tunnel so Twilio can reach the Mac:
   `cloudflared tunnel --url http://127.0.0.1:1880`
   and copy the https URL it prints.
4. Set the sandbox's "when a message comes in" webhook to
   `https://<tunnel-host>/whatsapp` (method POST).

## 5. The pieces

| File | Role |
|---|---|
| `node-red-flow.json` | webhook → allowlist → intent → CONFIRM → deploy → reply |
| `interpret-intent` | base64-safe bridge to OpenCode; enum validation; audit; keyword fallback |
| `deploy-kiosk` | the ONLY deployment entry point (approved profiles, fixed argv, NDJSON progress, audit) |
| `deploy-monitor` | branded terminal view; run `deploy-monitor --follow` for filming |
| `opencode/intent-prompt.md` + `intent.schema.json` | the interpretation contract |

## 6. Security model (brief addendum)

- Authorised senders only (env allowlist, checked first).
- Mandatory CONFIRM round-trip, pending request expires after 5 minutes.
- OpenCode interprets only; its output is schema/enum-checked, then the
  profile token (one of three fixed strings) is the only thing that
  crosses to the command line.
- Credentials in the environment, never in the flow or repo.
- Every message, intent and deployment lands in the audit log
  (`FK_AUDIT_LOG`); `deploy-monitor --follow` renders it live.
- Failed validation rolls back on-kiosk (role) and reports failure.
