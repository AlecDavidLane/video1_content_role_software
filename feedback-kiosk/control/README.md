# Control machine setup (macOS)

The control plane: Node-RED receives Telegram messages (long polling -
no tunnel, no webhook, no inbound ports), OpenCode interprets them into
a restricted intent, `deploy-kiosk` runs the Ansible role, and the bot
replies with the result. Raw message text never reaches a shell
(base64 boundary + enum validation at every layer).

## 1. Install

```bash
brew install node-red
npm install -g opencode-ai        # optional at first: interpret-intent
                                  # has a keyword fallback
cd ~/.node-red && npm install node-red-contrib-telegrambot
```

## 2. Create the bot (once, free)

1. In Telegram, message **@BotFather** → `/newbot` → pick a display
   name (e.g. "TL Kiosk Control") and a unique username (e.g.
   `tl_kiosk_bot`). BotFather replies with the **bot token** - keep it.
2. Get your numeric Telegram id: message **@userinfobot** (it replies
   with your id) - or just message your new bot after setup; the flow
   replies to unauthorised senders with their id.

## 3. Environment

Create `~/.fk-control.env` (credentials never live in the flow):

```bash
export FK_CONTROL_DIR="$HOME/video1_content_role_software/feedback-kiosk/control"
export FK_AUDIT_LOG="$HOME/fk-audit.jsonl"
export AUTHORIZED_TELEGRAM_IDS="123456789"   # comma-separated numeric ids
```

Always start Node-RED from a shell that has them:

```bash
source ~/.fk-control.env && node-red
```

## 4. Import the flow

Editor (http://127.0.0.1:1880) → menu → Import → `node-red-flow.json`
→ Import. Double-click either Telegram node → pencil next to the bot
config → paste the **bot token** into Credentials → Update → **Deploy**.
(The token is stored in Node-RED's encrypted credentials file, not in
the flow export.)

## 5. The pieces

| File | Role |
|---|---|
| `node-red-flow.json` | Telegram in → allowlist → intent → CONFIRM → deploy → reply |
| `interpret-intent` | base64-safe bridge to OpenCode; enum validation; audit; keyword fallback |
| `deploy-kiosk` | the ONLY deployment entry point (approved profiles, fixed argv, NDJSON progress, audit) |
| `deploy-monitor` | branded terminal view; run `deploy-monitor --follow` for filming |
| `opencode/intent-prompt.md` + `intent.schema.json` | the interpretation contract |
| `node-red-flow-twilio.json.bak` | earlier WhatsApp/Twilio variant, kept for reference (needs a paid-tier webhook) |

## 6. Security model (brief addendum)

- Authorised senders only (numeric-id allowlist, checked first).
- Mandatory CONFIRM round-trip; a pending request expires after 5 min.
- OpenCode interprets only; its output is schema/enum-checked, then the
  profile token (one of three fixed strings) is the only thing that
  crosses to the command line.
- Bot token in Node-RED's encrypted credential store; everything else
  in the environment. Nothing secret in the repo or the flow export.
- Every message, intent and deployment lands in the audit log
  (`FK_AUDIT_LOG`); `deploy-monitor --follow` renders it live.
- Failed validation rolls back on-kiosk (role) and reports failure.
