# Feedback Artist Event Kiosk — Design Decisions

Working design for video 2 (branch `video2-ansible-role`), implementing
`Feedback_Artist_Event_Kiosk_Design_and_Ansible_Brief.docx`. One kiosk
application + one reusable `feedback_kiosk` Ansible role; V1 → branded →
Spanish are configuration profiles over the same immutable release.

## Locked decisions (owner-confirmed)

| Decision | Choice |
|---|---|
| Offline | **Fully offline.** Emotion model, Transformers.js runtime and fonts packaged in the release. Typed journey must pass with the network cable pulled. |
| Voice | **Typed only for this video.** No microphone, no speech recognition, no voice UI in any profile. (Config keeps a `voice.enabled` flag, always false for now.) |
| Privacy default | **Full responses**: anonymous response text + emotion + metadata in SQLite; per-profile `privacy.store_text` can switch a profile to totals-only. |
| Baseline | Ubuntu 24.04 LTS, Xorg, NUC-class hardware, 1920×1080 reference layout (touch targets ≥56 px). |

## What is ported from the supplied repo

From `pages/feedbackartist.js` (kept verbatim at
`reference/feedbackartist-upstream.js`): the five-face identity table
(`FACES`), label→face mapping (`LABEL_TO_FACE`), stroke geometry +
`FACE_STROKES`, the robot think/walk/paint animation, and the English
keyword fallback. From `public/`: the five `art/*.webp` states and the
TL logo. Everything else (site nav/header/footer, 900px layout, CDN
runtime, hosted model download, Google Fonts, error/diagnostic UI) is
discarded per brief §2/§4.

## Application architecture (`feedback-kiosk/app`)

- **Next.js, `output: 'standalone'`** — one Node process serves the UI
  and the local API. Pinned Node 20 LTS at deploy time.
- **State machine**: idle → input → processing → result → reset
  (timeouts from config). Any failure path lands back in typed input,
  never an error screen (brief §3).
- **Emotion engine, per-locale strategy** (config-driven):
  - `en-GB`: bundled ONNX text-classification model via
    `@huggingface/transformers` (npm dependency, `allowRemoteModels:
    false`, models under `public/models/` fetched at **build** time) +
    the upstream English keyword lexicon as fallback.
  - `es-ES`: bundled multilingual model + a Spanish emotion lexicon
    covering all five faces (brief accepts model+lexicon). Test phrases
    for all five states in both locales live with the translations and
    drive the acceptance tests.
- **Config**: `/etc/feedback-kiosk/config.json`, validated against
  `config.schema.json` at startup; refuses to start on invalid config.
  Fields per brief §4 (identity, locale, branding, copy, timeouts,
  privacy, versions). Copy comes from translation files
  (`locales/en-GB.json`, `locales/es-ES.json`) with per-profile
  overrides for event-specific strings.
- **Persistence**: better-sqlite3, `/var/lib/feedback-kiosk/feedback.db`
  (outside the release dir). Row fields per brief §6. CSV/JSON export +
  clear via PIN-protected operator API.
- **Operator access**: 5 taps in the top-left corner within 3 s → PIN
  pad → status screen (app version, profile, storage, last response,
  model readiness) with export/clear/restart. PIN hash lives in config
  (deployed from vaulted Ansible var).
- **Health**: `GET /api/health` — config valid, DB writable, model
  loaded, disk space; the Ansible role gates deployment success on it.
- **Kiosk lockdown**: full-screen Chromium (systemd user session,
  reusing every video-1 lesson: wmctrl fullscreen enforcement, POSIX-sh
  waits, curl dependency, no-store headers, pkill guard); CSS/JS blocks
  selection, context menu, pinch zoom, drag navigation.
- **On-screen keyboard**: integrated React keyboard (per-locale layout,
  incl. ñ/accents for es-ES) — no OS virtual keyboard dependency.

## Release + deployment

- `packaging/build-release.sh` → `feedback-kiosk-<version>.tar.gz` +
  `.sha256` (standalone server + static + public incl. models/fonts).
- Ansible role `feedback_kiosk` (in `feedback-kiosk/ansible/`):
  preflight → pinned packages → release to
  `/opt/feedback-kiosk/releases/<version>` → config/translations/assets
  → services → health-gated atomic `current` symlink flip → deployment
  record (`/var/log/feedback-kiosk/deploy-<ts>.json`). Rollback = keep
  previous release dir; failed health = symlink untouched + play fails.
- Profiles: `profiles/v1.yml`, `profiles/branded-event.yml`,
  `profiles/spanish.yml` — same role, different variables. Feedback DB
  and browser profile are never touched by updates.

## Repo layout

```
feedback-kiosk/
  DESIGN.md                  this file
  reference/                 upstream page kept for provenance
  app/                       Next.js kiosk application
  packaging/                 release build script
  ansible/                   feedback_kiosk role + profiles + playbooks
  docs/                      manual install notes, acceptance checklist
```
