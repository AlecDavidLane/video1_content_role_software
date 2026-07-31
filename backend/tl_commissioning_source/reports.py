"""Commissioning report generation (§7.8).

HTML (Jinja2) -> PDF via headless Chromium, fully offline (FR-32,
NFR-01). A machine-readable JSON export with a SHA-256 checksum is written
beside the PDF (FR-34). Regeneration creates a new report revision without
touching historical test data (FR-36).
"""

from __future__ import annotations

import base64
import hashlib
import json
import re
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

from . import __version__
from .config import Config
from .db import Database
from .sessions import SessionStore
from .state import AppState, latest_soak

TEMPLATE_DIR = Path(__file__).parent / "report_templates"

# Bundled by the Debian package (see packaging/build-deb.sh): a standalone
# chrome-headless-shell. Ubuntu's chromium is a snap, and snap confinement
# makes it unusable from a system service (no XDG_RUNTIME_DIR, private /tmp,
# no access to /var/lib) — so snap wrappers are explicitly rejected here.
BUNDLED_SHELL = Path(
    "/opt/transition-layer/commissioning-source/chrome-headless-shell/chrome-headless-shell"
)
CHROMIUM_CANDIDATES = [
    "google-chrome", "chrome", "chromium", "chromium-browser",
    "/usr/bin/chromium", "/usr/bin/chromium-browser",
]


class ReportError(Exception):
    pass


def _is_snap_wrapper(path: str) -> bool:
    try:
        real = Path(path).resolve()
        if any(part == "snap" for part in real.parts):
            return True
        head = real.read_bytes()[:1024]
        return head.startswith(b"#!") and b"snap" in head
    except OSError:
        return True


def find_chromium(config: Config) -> str | None:
    configured = config.get("report", "chromium_path") or ""
    if configured:
        # Explicit configuration always wins, snap or not.
        return configured if Path(configured).exists() else None
    if BUNDLED_SHELL.exists():
        return str(BUNDLED_SHELL)
    for candidate in CHROMIUM_CANDIDATES:
        found = shutil.which(candidate) or (
            candidate if Path(candidate).exists() else None
        )
        if found and not _is_snap_wrapper(found):
            return found
    return None


def safe_filename(value: str, fallback: str = "untitled") -> str:
    """Normalise unsafe characters (FR-33)."""
    value = value.strip() or fallback
    value = re.sub(r"[^A-Za-z0-9._-]+", "-", value)
    return value.strip("-.")[:60] or fallback


def _b64_image(path: str) -> str | None:
    p = Path(path)
    if not p.exists():
        return None
    suffix = p.suffix.lower().lstrip(".")
    mime = {"jpg": "jpeg", "jpeg": "jpeg", "png": "png", "svg": "svg+xml"}.get(suffix)
    if not mime:
        return None
    return f"data:image/{mime};base64," + base64.b64encode(p.read_bytes()).decode()


def build_report_data(state: AppState, session_id: str) -> dict:
    """Assemble the full report payload from stored session data."""
    store = state.store
    session = store.get_session(session_id)
    if session["status"] not in ("completed_passed", "completed_failed"):
        raise ReportError(
            "Reports can only be generated for completed sessions"
            f" (current state: {session['status']})"
        )
    definitions = {d["key"]: d for d in store.test_definitions()}
    attempts = session["attempts"]

    results = []
    for key in session["selected_tests"]:
        test_attempts = [a for a in attempts if a["test_key"] == key]
        latest = test_attempts[-1] if test_attempts else None
        definition = definitions.get(key, {})
        results.append(
            {
                "test_key": key,
                "name": definition.get("name", key),
                "expected_result": definition.get("expected_result", ""),
                "attempts": test_attempts,
                "latest": latest,
                "retested": len(test_attempts) > 1,
            }
        )

    unresolved_failures = [
        r for r in results if r["latest"] and r["latest"]["result"] == "fail"
    ]
    soak = latest_soak(state.db, session_id)
    identity = state.identity()
    output = state.output_state()
    active = output.get("active") or {}
    mode = active.get("active_mode") or {}
    events = store.events(session_id=session_id, limit=100)

    return {
        "session": {
            k: session[k]
            for k in (
                "id", "status", "room", "engineer", "signal_path_text",
                "endpoints", "selected_tests", "soak_minutes",
                "started_at", "completed_at", "reopened_at", "created_at",
            )
        },
        "project": session["project"],
        "overall_passed": session["status"] == "completed_passed",
        "results": results,
        "unresolved_failures": unresolved_failures,
        "soak": soak,
        "events": events,
        "test_source": {
            **identity,
            "os_version": _os_version(),
            "connector": active.get("connector"),
            "mode": mode.get("key"),
        },
        "app_version": __version__,
    }


def _os_version() -> str:
    try:
        for line in Path("/etc/os-release").read_text().splitlines():
            if line.startswith("PRETTY_NAME="):
                return line.split("=", 1)[1].strip('"')
    except OSError:
        pass
    return "unknown"


def generate_report(state: AppState, session_id: str) -> dict:
    """Render the PDF and JSON export and record the report row."""
    config = state.config
    data = build_report_data(state, session_id)
    db = state.db

    revision_row = db.query_one(
        "SELECT COALESCE(MAX(revision), 0) AS r FROM report WHERE session_id = ?",
        (session_id,),
    )
    revision = int(revision_row["r"]) + 1
    generated_at = datetime.now(timezone.utc)

    project = data["project"] or {}
    filename_base = "_".join(
        [
            safe_filename(project.get("name", ""), "project"),
            safe_filename(data["session"]["room"], "room"),
            safe_filename(
                data["session"]["signal_path_text"].split("\n")[0][:40], "path"
            ),
            generated_at.strftime("%Y%m%d"),
            safe_filename(session_id),
        ]
    )
    config.reports_dir.mkdir(parents=True, exist_ok=True)
    pdf_path = config.reports_dir / f"{filename_base}.pdf"
    json_path = config.reports_dir / f"{filename_base}.json"

    # JSON export first: same session data plus generation metadata (FR-34).
    export = {
        "format": "tl-commissioning-source/session-report",
        "format_version": 1,
        "report": {
            "revision": revision,
            "generated_at": generated_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
        },
        **data,
    }
    json_bytes = json.dumps(export, indent=2, sort_keys=True, default=str).encode()
    json_sha256 = hashlib.sha256(json_bytes).hexdigest()
    json_path.write_bytes(json_bytes)
    checksum_path = json_path.with_suffix(".json.sha256")
    checksum_path.write_text(f"{json_sha256}  {json_path.name}\n")

    html = render_html(
        state, data, revision=revision,
        generated_at=generated_at, json_sha256=json_sha256,
        report_reference=f"{session_id}-R{revision}",
    )
    html_to_pdf(html, pdf_path, config)

    db.execute(
        "INSERT INTO report (session_id, revision, pdf_path, json_path, json_sha256)"
        " VALUES (?,?,?,?,?)",
        (session_id, revision, str(pdf_path), str(json_path), json_sha256),
    )
    state.store.record_event(
        "report_generated",
        f"Report revision {revision} generated for {session_id}",
        session_id=session_id,
        state={"pdf": str(pdf_path), "revision": revision},
    )
    return {
        "session_id": session_id,
        "revision": revision,
        "pdf_path": str(pdf_path),
        "json_path": str(json_path),
        "json_sha256": json_sha256,
        "generated_at": generated_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


def render_html(
    state: AppState,
    data: dict,
    revision: int,
    generated_at: datetime,
    json_sha256: str,
    report_reference: str,
) -> str:
    env = Environment(
        loader=FileSystemLoader(TEMPLATE_DIR),
        autoescape=select_autoescape(["html"]),
    )
    template = env.get_template("report.html")
    # Fall back to the bundled Transition Layer lockup when no custom logo
    # has been configured (replaceable via Maintenance or `tl-source init --logo`).
    logo_path = state.config.get("branding", "logo_path") or str(
        TEMPLATE_DIR / "tl-logo-lockup.png"
    )
    branding = {
        "company_name": state.config.get("branding", "company_name"),
        "accent_colour": state.config.get("branding", "accent_colour"),
        "report_footer": state.config.get("branding", "report_footer"),
        "logo_data_uri": _b64_image(logo_path),
    }
    # Embed evidence derivatives as data URIs so the PDF is self-contained.
    for result in data["results"]:
        for attempt in result["attempts"]:
            for item in attempt.get("evidence", []):
                item["data_uri"] = _b64_image(
                    item.get("derivative_path") or item.get("original_path") or ""
                )
    return template.render(
        **data,
        branding=branding,
        revision=revision,
        report_reference=report_reference,
        generated_at=generated_at.strftime("%Y-%m-%d %H:%M UTC"),
        json_sha256=json_sha256,
    )


def html_to_pdf(html: str, pdf_path: Path, config: Config) -> None:
    chromium = find_chromium(config)
    if chromium is None:
        raise ReportError(
            "No usable Chromium found for PDF generation. Ubuntu's snap"
            " chromium cannot be used by the backend service; install the"
            " package built with the bundled chrome-headless-shell, or set"
            " report.chromium_path to a non-snap Chrome/Chromium binary."
        )
    with tempfile.TemporaryDirectory(prefix="tl-report-") as tmp:
        html_file = Path(tmp) / "report.html"
        html_file.write_text(html, encoding="utf-8")
        result = subprocess.run(
            [
                chromium,
                "--headless=new",
                "--no-sandbox",
                "--disable-gpu",
                "--no-first-run",
                f"--user-data-dir={tmp}/profile",
                "--no-pdf-header-footer",
                f"--print-to-pdf={pdf_path}",
                html_file.as_uri(),
            ],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if result.returncode != 0 or not pdf_path.exists():
            raise ReportError(
                f"Chromium PDF generation failed: {result.stderr.strip()[:500]}"
            )
