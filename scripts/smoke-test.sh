#!/usr/bin/env bash
# Scripted smoke test (§16): install-in-place, health, pattern activation,
# guided session, and sample report generation — all against a scratch
# config with mock hardware, so it runs anywhere (CI, dev laptop, appliance).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
PORT="${SMOKE_PORT:-8931}"
trap 'kill "$SERVER_PID" 2>/dev/null || true; rm -rf "$WORK"' EXIT

export TL_SOURCE_CONFIG="$WORK/config.yaml"
cat > "$TL_SOURCE_CONFIG" <<EOF
server:
  bind_host: 127.0.0.1
  port: $PORT
storage:
  data_dir: $WORK/data
  reports_dir: $WORK/reports
  evidence_dir: $WORK/evidence
hardware:
  display_backend: mock
  audio_backend: mock
report:
  chromium_path: "${SMOKE_CHROMIUM:-}"
EOF

step() { echo; echo "==> $*"; }

step "Install check: tl-source importable"
python3 -c "import tl_commissioning_source as m; print('version', m.__version__)"

step "Non-interactive init (AC-14)"
tl-source init --appliance-id TL-SMOKE-01 --company "Smoke Test Co" \
  --source-number 1 --pin 135790 --role-version smoke-0

step "Start backend"
tl-source serve &
SERVER_PID=$!
# /health returns 503 when degraded (no kiosk in the smoke env) — any HTTP
# response means the server is up.
for _ in $(seq 1 30); do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/health" || true)
  [ "$CODE" = "200" ] || [ "$CODE" = "503" ] && break
  sleep 1
done

step "Healthcheck CLI (AC-14)"
tl-source healthcheck || [ $? -eq 1 ]   # 1 = reachable but degraded (no kiosk in smoke env)

step "Auth: state-changing call fails without token (AC-13)"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  "http://127.0.0.1:$PORT/api/v1/patterns/identify/activate" \
  -H 'Content-Type: application/json' -d '{}')
[ "$CODE" = "401" ] || { echo "expected 401, got $CODE"; exit 1; }

step "Token with PIN, activate pattern (AC-04)"
TOKEN=$(curl -fsS -X POST "http://127.0.0.1:$PORT/api/v1/auth/token" \
  -H 'Content-Type: application/json' -d '{"pin":"135790"}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])')
AUTH="Authorization: Bearer $TOKEN"
curl -fsS -X POST "http://127.0.0.1:$PORT/api/v1/patterns/identify/activate" \
  -H "$AUTH" -H 'Content-Type: application/json' -d '{}' >/dev/null
ACTIVE=$(curl -fsS "http://127.0.0.1:$PORT/api/v1/status" | python3 -c 'import json,sys;print(json.load(sys.stdin)["pattern"]["active_pattern"])')
[ "$ACTIVE" = "identify" ] || { echo "pattern not active: $ACTIVE"; exit 1; }

step "Guided session: create, start, fail-requires-note, pass all, complete (AC-05/06)"
SESSION=$(curl -fsS -X POST "http://127.0.0.1:$PORT/api/v1/sessions" -H "$AUTH" \
  -H 'Content-Type: application/json' \
  -d '{"project_name":"Smoke","room":"Rig","engineer":"Smoke Bot","signal_path_text":"direct","selected_tests":["identify","colour"]}' \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
curl -fsS -X POST "http://127.0.0.1:$PORT/api/v1/sessions/$SESSION/start" -H "$AUTH" >/dev/null
# fail without note must be rejected
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  "http://127.0.0.1:$PORT/api/v1/sessions/$SESSION/tests/identify/attempts" \
  -H "$AUTH" -H 'Content-Type: application/json' -d '{"result":"fail","note":""}')
[ "$CODE" = "409" ] || { echo "fail-without-note not blocked ($CODE)"; exit 1; }
# incomplete completion must be rejected
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  "http://127.0.0.1:$PORT/api/v1/sessions/$SESSION/complete" -H "$AUTH")
[ "$CODE" = "409" ] || { echo "incomplete completion not blocked ($CODE)"; exit 1; }
for KEY in identify colour; do
  curl -fsS -X POST "http://127.0.0.1:$PORT/api/v1/sessions/$SESSION/tests/$KEY/attempts" \
    -H "$AUTH" -H 'Content-Type: application/json' -d '{"result":"pass"}' >/dev/null
done
STATUS=$(curl -fsS -X POST "http://127.0.0.1:$PORT/api/v1/sessions/$SESSION/complete" -H "$AUTH" \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["status"])')
[ "$STATUS" = "completed_passed" ] || { echo "unexpected status $STATUS"; exit 1; }

step "Report generation over API (AC-08)"
curl -fsS -X POST "http://127.0.0.1:$PORT/api/v1/sessions/$SESSION/report" -H "$AUTH" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("pdf:", d["pdf_path"]); print("sha256:", d["json_sha256"])'

step "Sample report CLI (§12)"
kill "$SERVER_PID"; wait "$SERVER_PID" 2>/dev/null || true
tl-source sample-report --outcome failed >/dev/null
ls "$WORK/reports" | grep -c pdf >/dev/null

echo
echo "SMOKE TEST PASSED"
