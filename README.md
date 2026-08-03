# Transition Layer — Portable AV Commissioning Test Source

A local, offline-capable application that turns a standard mini-PC into a
guided HDMI test source, lets an AV engineer verify each stage of a signal
path from a phone, and generates a client-ready commissioning report.

This is the operational payload of the first Transition Layer giveaway
role. It is **not** a calibrated signal analyser and does not certify
compliance with any standard — it produces defensible commissioning
*records* based on the engineer's confirmed observations.

**Target platform:** Ubuntu 24.04 LTS x86-64 (Xorg session) ·
**Reference hardware:** Intel NUC BXNUC10i5FNHN (i5-10210U, Intel UHD
Graphics, HDMI 2.0a)

## Architecture

One self-contained local web application (no cloud, no accounts):

| Component | Implementation | Where |
|---|---|---|
| Backend / API | Python 3.11+ · FastAPI · Uvicorn · SQLite (WAL) | `backend/` |
| Control UI | React + TypeScript responsive PWA | `frontend/` |
| Test output | Chromium kiosk page, HTML Canvas + Web Audio | `backend/tl_commissioning_source/kiosk/` |
| Reports | Jinja2 HTML → headless Chromium PDF + JSON w/ SHA-256 | `backend/tl_commissioning_source/reports.py` |
| OS control | `xrandr` (modes) and `pactl` (audio sinks), mockable | `display.py`, `audio.py` |
| Runtime | systemd (backend system unit, kiosk user unit) | `packaging/systemd/` |

All three surfaces are served by the same backend on port 8808:

- `/` — phone/tablet control UI
- `/kiosk/` — full-screen HDMI test output (holding screen until ready)
- `/api/v1/…` + `WS /api/v1/events` — versioned local API, OpenAPI docs at `/api/docs`
- `/health` — dependency health (200 healthy / 503 degraded)

## Quick start (development)

```bash
# Backend
cd backend
pip install -e ".[dev]"
export TL_SOURCE_CONFIG=/tmp/tl-dev/config.yaml   # optional; defaults to /etc/...
tl-source serve                                    # http://127.0.0.1:8808

# Frontend (hot reload, proxies /api to :8808)
cd frontend
npm install
npm run dev

# Tests and smoke test
cd backend && python -m pytest
bash scripts/smoke-test.sh          # full install→session→report flow, mock hardware
```

With no display server present the app falls back to mock display/audio
backends automatically, so every feature (including report generation, if
Chromium is installed) works on a dev machine.

## Appliance install

```bash
packaging/build-deb.sh              # builds dist/tl-commissioning-source_<ver>_amd64.deb
sudo apt install ./dist/tl-commissioning-source_*.deb
sudo -u tl-source /opt/transition-layer/commissioning-source/venv/bin/tl-source \
    init --appliance-id TL-TESTSOURCE-01 --company "Your Co" --pin 246810
tl-source healthcheck               # 0 = healthy
```

**Fresh machine?** Follow the step-by-step walkthrough in
[docs/install-and-test.md](docs/install-and-test.md) — it covers
prerequisites, the quick functional test, the full kiosk setup and the
on-hardware acceptance checks. See `docs/runbook.md` for update,
rollback, backup and restore procedures, and `docs/operator-guide.md`
for on-site use.

## Non-interactive configuration (Ansible interface)

Everything the starter Ansible role needs (§12 of the brief):

- Debian package with pinned dependencies (`packaging/requirements.lock`)
- Config file `/etc/tl-commissioning-source/config.yaml` with published
  schema (`packaging/../backend/tl_commissioning_source/config.schema.json`,
  installed to `/etc/tl-commissioning-source/config.schema.json`)
- systemd units for backend and kiosk
- `tl-source healthcheck` — exit 0 healthy / 1 degraded / 2 unreachable
- `tl-source init …` — identity, branding, PIN, role version, no UI needed
- `tl-source sample-report --outcome passed|failed` — acceptance testing
- `tl-source export-config` / `import-config` — non-secret JSON round-trip
- `tl-source diag-bundle` — diagnostics zip excluding secrets/photos

## Repository layout

```
backend/     Python package, migrations, kiosk page, report template, tests
frontend/    React control UI (builds into backend/tl_commissioning_source/static)
packaging/   deb build, systemd units, sample config, dependency lock
scripts/     smoke-test.sh
docs/        operator guide, runbook, API/OpenAVC notes, sample reports
```

## Licence

Proprietary — © 2026 Transition Layer. See [LICENSE](LICENSE). The giveaway
licence covers this application only; Transition Layer's production
deployment pipeline, orchestration and customer roles are out of scope and
not included.
