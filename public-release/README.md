# Transition Layer — Portable AV Commissioning Test Source

A local, offline-capable application that turns a standard mini-PC into a guided HDMI test source, lets an AV engineer verify each stage of a signal path from a phone, and generates a client-ready commissioning report.

This is the standalone software shown in the first Transition Layer commissioning video. It is provided for manual installation and use. The Transition Layer Ansible deployment role, production pipeline, orchestration, fleet-management tooling and customer-specific automation are intentionally **not included** in this public repository.

**Target platform:** Ubuntu 24.04 LTS x86-64 (Xorg session)  
**Reference hardware:** Intel NUC BXNUC10i5FNHN (i5-10210U, Intel UHD Graphics, HDMI 2.0a)

## What it does

- Provides a phone/tablet control UI for commissioning tests
- Generates HDMI test patterns and audio test signals
- Guides an engineer through signal-path verification
- Records observations and evidence
- Generates commissioning reports in PDF and JSON formats
- Runs locally with no cloud account required

## Architecture

| Component | Implementation | Where |
|---|---|---|
| Backend / API | Python 3.11+ · FastAPI · Uvicorn · SQLite | `backend/` |
| Control UI | React + TypeScript responsive PWA | `frontend/` |
| Test output | Chromium kiosk page, HTML Canvas + Web Audio | `backend/tl_commissioning_source/kiosk/` |
| Reports | Jinja2 HTML → headless Chromium PDF + JSON | `backend/tl_commissioning_source/reports.py` |
| OS control | `xrandr` and `pactl` | `display.py`, `audio.py` |
| Appliance runtime | systemd | `packaging/systemd/` |

The application is served on port `8808`:

- `/` — phone/tablet control UI
- `/kiosk/` — full-screen HDMI test output
- `/api/v1/…` — local API
- `/api/docs` — OpenAPI documentation
- `/health` — dependency health endpoint

## Quick start for development

```bash
# Backend
cd backend
pip install -e ".[dev]"
tl-source serve

# Frontend
cd frontend
npm install
npm run dev
```

## Appliance install

```bash
packaging/build-deb.sh
sudo apt install ./dist/tl-commissioning-source_*.deb
sudo -u tl-source /opt/transition-layer/commissioning-source/venv/bin/tl-source \
  init --appliance-id TL-TESTSOURCE-01 --company "Your Co" --pin 246810

tl-source healthcheck
```

For a fresh machine, follow `docs/install-and-test.md`. For on-site operation, see `docs/operator-guide.md`. Update, backup and recovery information is in `docs/runbook.md`.

## Important limitation

This application is a commissioning record-keeping and test-pattern tool. It is **not a calibrated signal analyser** and does not certify compliance with HDMI, audio, video or other technical standards.

## About the Transition Layer role

The video demonstrates this software as the payload of a complete automated machine role. The private role can take a clean compatible machine and automatically apply the required software, operating-system configuration, services, application configuration and acceptance tests.

That deployment automation is Transition Layer's commercial product and is deliberately separate from this software giveaway.

## Licence

Copyright © 2026 Transition Layer. See `LICENSE` for permitted use and restrictions.
