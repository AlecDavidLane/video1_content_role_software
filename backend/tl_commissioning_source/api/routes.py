"""/api/v1 routes (§10) plus /health.

State-changing calls are protected by the control PIN/token once
first-run setup is complete (AC-13). OpenAPI documentation is generated
by FastAPI at /api/docs.
"""

from __future__ import annotations

import asyncio
import io
import json

import qrcode
import qrcode.image.svg
from fastapi import (
    APIRouter, File, Form, HTTPException, Request, Response, UploadFile,
    WebSocket, WebSocketDisconnect,
)
from fastapi.responses import FileResponse, JSONResponse

from .. import __version__
from ..auth import ControlRequired, issue_token
from ..evidence import EvidenceError, store_photo
from ..patterns import HOLDING, PATTERNS
from ..reports import ReportError, generate_report
from ..sessions import SessionError
from ..state import latest_soak
from . import schemas

router = APIRouter()
api = APIRouter(prefix="/api/v1")


def _state(request: Request):
    return request.app.state.appstate


# -- health -----------------------------------------------------------------
@router.get("/health", tags=["health"])
def health(request: Request):
    state = _state(request)
    payload = state.health()
    return JSONResponse(payload, status_code=200 if payload["ok"] else 503)


# -- auth ---------------------------------------------------------------------
@api.post("/auth/token", tags=["auth"])
def create_token(body: schemas.TokenRequest, request: Request):
    state = _state(request)
    if not state.config.setup_complete:
        raise HTTPException(409, "First-run setup is not complete; no PIN is configured yet")
    if not state.config.check_pin(body.pin):
        raise HTTPException(401, "Incorrect PIN")
    ttl = int(state.config.get("security", "token_ttl_seconds") or 43200)
    return issue_token(state.db, ttl)


# -- status / identity ---------------------------------------------------------
@api.get("/status", tags=["status"])
def status(request: Request):
    state = _state(request)
    current = state.current_session_id()
    # Server-truth guided progress, so panel integrations can follow the
    # appliance instead of counting steps client-side (which drifts the
    # moment a press double-fires or a call is dropped). When nothing is in
    # progress, report the most recently completed session so a panel keeps
    # showing "completed_passed/failed" after Complete instead of going
    # blank (or latching onto an unrelated stale session).
    session_status = ""
    next_test = ""
    unanswered_count = 0
    if not current:
        row = state.db.query_one(
            "SELECT id FROM session WHERE status IN"
            " ('completed_passed','completed_failed') AND deleted = 0"
            " ORDER BY completed_at DESC LIMIT 1"
        )
        if row:
            current = row["id"]
    if current:
        session = state.store.get_session(current)
        progress = session["progress"]
        session_status = session["status"]
        if session["status"] in ("in_progress", "review"):
            unanswered_count = len(progress["unanswered"])
            next_test = progress["unanswered"][0] if progress["unanswered"] else ""
    return {
        "identity": state.identity(),
        "pattern": {"active_pattern": state.active_pattern, "params": state.active_params},
        "output": state.output_state(),
        "audio": state.audio_state(),
        "soak": state.soak.state(),
        "health_ok": state.health()["ok"],
        "current_session_id": current,
        "current_session_status": session_status,
        "next_test": next_test,
        "unanswered_count": unanswered_count,
        "setup_complete": state.config.setup_complete,
        "app_version": __version__,
    }


@api.get("/identity/qr.svg", tags=["status"])
def identity_qr(request: Request):
    state = _state(request)
    url = state.identity()["control_url"]
    image = qrcode.make(url, image_factory=qrcode.image.svg.SvgPathImage, box_size=12)
    buf = io.BytesIO()
    image.save(buf)
    return Response(buf.getvalue(), media_type="image/svg+xml")


@api.get("/integration/panel-qr.svg", tags=["status"])
def panel_qr(request: Request):
    """QR for the configured room-control panel (integration.panel_url);
    shown on the Identify screen so a phone reaches the panel directly.
    An {ip} placeholder resolves to the current LAN address per request,
    so the QR follows DHCP lease changes."""
    state = _state(request)
    url = state.identity()["panel_url"]
    if not url:
        raise HTTPException(404, "No panel URL configured (integration.panel_url)")
    image = qrcode.make(url, image_factory=qrcode.image.svg.SvgPathImage, box_size=12)
    buf = io.BytesIO()
    image.save(buf)
    return Response(buf.getvalue(), media_type="image/svg+xml")


# -- first-run setup and configuration -------------------------------------------
@api.get("/setup", tags=["setup"])
def setup_status(request: Request):
    state = _state(request)
    return {
        "setup_complete": state.config.setup_complete,
        "branding": {
            "company_name": state.config.get("branding", "company_name"),
            "accent_colour": state.config.get("branding", "accent_colour"),
            "report_footer": state.config.get("branding", "report_footer"),
            "has_logo": bool(state.config.get("branding", "logo_path")),
        },
        "appliance": {
            "id": state.config.get("appliance", "id"),
            "friendly_name": state.config.get("appliance", "friendly_name"),
            "source_number": state.config.get("appliance", "source_number"),
        },
        "default_engineer": state.config.get("engineer", "default_name"),
    }


@api.post("/setup", tags=["setup"], dependencies=[ControlRequired])
def run_setup(body: schemas.SetupRequest, request: Request):
    """First-run setup (FR-02). Also usable later to rotate the PIN."""
    state = _state(request)
    cfg = state.config
    cfg.set(("branding", "company_name"), body.company_name)
    cfg.set(("branding", "accent_colour"), body.accent_colour)
    if body.report_footer:
        cfg.set(("branding", "report_footer"), body.report_footer)
    cfg.set(("engineer", "default_name"), body.default_engineer)
    if body.appliance_id:
        cfg.set(("appliance", "id"), body.appliance_id)
    elif not cfg.get("appliance", "id"):
        cfg.set(("appliance", "id"), f"TL-TESTSOURCE-{body.source_number:02d}")
    if body.friendly_name:
        cfg.set(("appliance", "friendly_name"), body.friendly_name)
    cfg.set(("appliance", "source_number"), body.source_number)
    cfg.set_pin(body.pin)
    cfg.set(("security", "setup_complete"), True)
    cfg.save()
    _sync_appliance_row(state)
    state.store.record_event("setup_completed", "First-run setup completed")
    return {"ok": True, "appliance_id": cfg.get("appliance", "id")}


def _sync_appliance_row(state) -> None:
    identity = state.identity()
    branding = json.dumps(
        {
            "company_name": state.config.get("branding", "company_name"),
            "accent_colour": state.config.get("branding", "accent_colour"),
        }
    )
    existing = state.db.query_one("SELECT id FROM appliance LIMIT 1")
    if existing:
        state.db.execute(
            "UPDATE appliance SET id=?, friendly_name=?, source_number=?, hostname=?, branding_json=?",
            (
                identity["appliance_id"], identity["friendly_name"],
                identity["source_number"], identity["hostname"], branding,
            ),
        )
    else:
        state.db.execute(
            "INSERT INTO appliance (id, friendly_name, source_number, hostname, branding_json)"
            " VALUES (?,?,?,?,?)",
            (
                identity["appliance_id"], identity["friendly_name"],
                identity["source_number"], identity["hostname"], branding,
            ),
        )


@api.post("/setup/logo", tags=["setup"], dependencies=[ControlRequired])
async def upload_logo(request: Request, file: UploadFile = File(...)):
    state = _state(request)
    data = await file.read()
    if len(data) > 2 * 1024 * 1024:
        raise HTTPException(422, "Logo must be under 2 MB")
    suffix = {"image/png": ".png", "image/jpeg": ".jpg", "image/svg+xml": ".svg"}.get(
        file.content_type or ""
    )
    if suffix is None:
        raise HTTPException(422, "Logo must be PNG, JPEG or SVG")
    if suffix != ".svg":
        from ..evidence import sniff_type

        try:
            sniff_type(data, file.content_type or "")
        except EvidenceError as exc:
            raise HTTPException(422, str(exc)) from exc
    target = state.config.data_dir / f"logo{suffix}"
    target.write_bytes(data)
    state.config.set(("branding", "logo_path"), str(target))
    state.config.save()
    return {"ok": True, "logo_path": str(target)}


@api.put("/config/branding", tags=["setup"], dependencies=[ControlRequired])
def update_branding(body: schemas.BrandingUpdate, request: Request):
    state = _state(request)
    for keys, value in [
        (("branding", "company_name"), body.company_name),
        (("branding", "accent_colour"), body.accent_colour),
        (("branding", "report_footer"), body.report_footer),
    ]:
        if value is not None:
            state.config.set(keys, value)
    state.config.save()
    return {"ok": True}


@api.get("/config/export", tags=["setup"])
def export_config(request: Request):
    """Non-secret configuration export (FR-05)."""
    return _state(request).config.export_public()


@api.post("/config/import", tags=["setup"], dependencies=[ControlRequired])
async def import_config(request: Request):
    state = _state(request)
    try:
        incoming = await request.json()
    except json.JSONDecodeError as exc:
        raise HTTPException(422, f"Invalid JSON: {exc}") from exc
    if not isinstance(incoming, dict):
        raise HTTPException(422, "Configuration import must be a JSON object")
    state.config.import_public(incoming)
    state.config.save()
    state.store.record_event("config_imported", "Configuration imported")
    return {"ok": True}


# -- patterns -------------------------------------------------------------------
@api.get("/patterns", tags=["patterns"])
def list_patterns():
    return {
        "patterns": [
            {
                "key": p.key,
                "name": p.name,
                "description": p.description,
                "parameters": p.parameters,
            }
            for p in PATTERNS.values()
        ]
    }


@api.post("/patterns/{key}/activate", tags=["patterns"], dependencies=[ControlRequired])
async def activate_pattern(key: str, request: Request, body: schemas.PatternActivate | None = None):
    state = _state(request)
    try:
        return await state.activate_pattern(key, (body.params if body else {}))
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@api.post("/patterns/holding", tags=["patterns"], dependencies=[ControlRequired])
async def activate_holding(request: Request):
    return await _state(request).activate_pattern(HOLDING)


@api.post("/soak/stop", tags=["patterns"], dependencies=[ControlRequired])
async def stop_soak(request: Request):
    state = _state(request)
    await state.soak.stop(interrupted=True)
    state.store.record_event(
        "soak_stopped", "Soak stopped by operator",
        session_id=state.current_session_id(),
    )
    return await state.activate_pattern("identify")


# -- output / audio -----------------------------------------------------------
@api.post("/output/mode", tags=["output"], dependencies=[ControlRequired])
async def set_output_mode(body: schemas.OutputModeRequest, request: Request):
    try:
        return await _state(request).set_mode(body.connector, body.mode)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 - xrandr failure
        raise HTTPException(502, f"Mode change failed: {exc}") from exc


@api.post("/audio/sink", tags=["output"], dependencies=[ControlRequired])
async def set_audio_sink(body: schemas.AudioSinkRequest, request: Request):
    try:
        return await _state(request).set_audio_sink(body.sink)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"Audio sink change failed: {exc}") from exc


# -- projects and test definitions -----------------------------------------------
@api.get("/projects", tags=["sessions"])
def list_projects(request: Request):
    return {"projects": _state(request).store.list_projects()}


@api.get("/tests", tags=["sessions"])
def list_tests(request: Request):
    return {"tests": _state(request).store.test_definitions()}


# -- sessions -------------------------------------------------------------------
@api.post("/sessions", tags=["sessions"], dependencies=[ControlRequired])
def create_session(body: schemas.SessionCreate, request: Request):
    state = _state(request)
    store = state.store
    try:
        project_id = store.upsert_project(
            body.project_name, body.client, body.site,
            body.engineer or state.config.get("engineer", "default_name") or "",
        )
        session = store.create_session(
            project_id=project_id,
            room=body.room,
            engineer=body.engineer or state.config.get("engineer", "default_name") or "",
            signal_path_text=body.signal_path_text,
            endpoints=body.endpoints.model_dump(),
            selected_tests=body.selected_tests,
            soak_minutes=body.soak_minutes,
        )
        if body.autostart:
            session = store.start(session["id"])
    except SessionError as exc:
        raise HTTPException(422, str(exc)) from exc
    return session


@api.get("/sessions", tags=["sessions"])
def list_sessions(request: Request, status: str | None = None):
    return {"sessions": _state(request).store.list_sessions(status)}


@api.get("/sessions/{session_id}", tags=["sessions"])
def get_session(session_id: str, request: Request):
    try:
        return _state(request).store.get_session(session_id)
    except SessionError as exc:
        raise HTTPException(404, str(exc)) from exc


@api.patch("/sessions/{session_id}", tags=["sessions"], dependencies=[ControlRequired])
def update_session(session_id: str, body: schemas.SessionUpdate, request: Request):
    fields = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    if "endpoints" in fields:
        fields["endpoints"] = body.endpoints.model_dump()
    try:
        return _state(request).store.update_draft(session_id, fields)
    except SessionError as exc:
        raise HTTPException(409, str(exc)) from exc


@api.delete("/sessions/{session_id}", tags=["sessions"], dependencies=[ControlRequired])
def delete_session(session_id: str, request: Request):
    try:
        _state(request).store.delete_draft(session_id)
    except SessionError as exc:
        raise HTTPException(409, str(exc)) from exc
    return {"ok": True}


@api.post("/sessions/{session_id}/start", tags=["sessions"], dependencies=[ControlRequired])
async def start_session(session_id: str, request: Request):
    state = _state(request)
    try:
        session = state.store.start(session_id)
    except SessionError as exc:
        raise HTTPException(409, str(exc)) from exc
    await state.hub.publish("session", {"session_id": session_id, "status": session["status"]})
    return session


@api.post(
    "/sessions/{session_id}/tests/{test_key}/attempts",
    tags=["sessions"],
    dependencies=[ControlRequired],
)
async def record_attempt(
    session_id: str, test_key: str, body: schemas.AttemptCreate, request: Request
):
    state = _state(request)
    try:
        attempt = state.store.record_attempt(
            session_id=session_id,
            test_key=test_key,
            result=body.result,
            note=body.note,
            engineer=body.engineer,
            fault_category=body.fault_category,
            system_state=state.captured_state(),
            started_at=body.started_at,
        )
    except SessionError as exc:
        raise HTTPException(409, str(exc)) from exc
    await state.hub.publish(
        "attempt",
        {"session_id": session_id, "test_key": test_key, "result": body.result},
    )
    return attempt


@api.post("/sessions/{session_id}/review", tags=["sessions"], dependencies=[ControlRequired])
def enter_review(session_id: str, request: Request):
    try:
        return _state(request).store.enter_review(session_id)
    except SessionError as exc:
        raise HTTPException(409, str(exc)) from exc


@api.post("/sessions/{session_id}/complete", tags=["sessions"], dependencies=[ControlRequired])
async def complete_session(session_id: str, request: Request):
    state = _state(request)
    try:
        session = state.store.complete(session_id)
    except SessionError as exc:
        raise HTTPException(409, str(exc)) from exc
    await state.hub.publish(
        "session", {"session_id": session_id, "status": session["status"]}
    )
    # Return the output to its idle identity so the display visibly leaves
    # the last test pattern when the session ends (mirrors the cold-boot
    # holding/identify behaviour, FR-40).
    await state.activate_pattern("identify")
    return session


@api.post("/sessions/{session_id}/reopen", tags=["sessions"], dependencies=[ControlRequired])
def reopen_session(session_id: str, body: schemas.ReopenRequest, request: Request):
    try:
        return _state(request).store.reopen(session_id, body.reason)
    except SessionError as exc:
        raise HTTPException(409, str(exc)) from exc


# -- current-session aliases (panel/automation workflows) --------------------
# Panel platforms (OpenAVC macros, YAML drivers) can't capture and re-send
# session IDs between calls. These aliases resolve "the session being worked
# on" server-side: the most recent in-progress/review session, falling back
# to the most recently completed one where that makes sense. They assume the
# appliance's normal single-active-session usage; concurrent sessions should
# use the explicit /sessions/{id} endpoints.


def _resolve_current(state, include_completed: bool = False) -> str:
    row = state.db.query_one(
        "SELECT id FROM session WHERE status IN ('in_progress','review')"
        " AND deleted = 0 ORDER BY started_at DESC LIMIT 1"
    )
    if row is None and include_completed:
        row = state.db.query_one(
            "SELECT id FROM session WHERE status IN ('completed_passed','completed_failed')"
            " AND deleted = 0 ORDER BY completed_at DESC LIMIT 1"
        )
    if row is None:
        raise HTTPException(
            404,
            "No active session. Create one with POST /api/v1/sessions"
            ' (use "autostart": true to skip the draft stage).',
        )
    return row["id"]


@api.get("/current-session", tags=["current-session"])
def get_current_session(request: Request):
    state = _state(request)
    return state.store.get_session(_resolve_current(state, include_completed=True))


@api.post(
    "/current-session/tests/{test_key}/attempts",
    tags=["current-session"],
    dependencies=[ControlRequired],
)
async def current_record_attempt(
    test_key: str, body: schemas.AttemptCreate, request: Request
):
    state = _state(request)
    return await record_attempt(
        _resolve_current(state), test_key, body, request
    )


@api.post(
    "/current-session/complete", tags=["current-session"], dependencies=[ControlRequired]
)
async def current_complete(request: Request):
    state = _state(request)
    return await complete_session(_resolve_current(state), request)


@api.post(
    "/current-session/report", tags=["current-session"], dependencies=[ControlRequired]
)
async def current_report(request: Request):
    """Generate a report for the active session — or, since completion
    clears the active session, for the most recently completed one."""
    state = _state(request)
    return await create_report(_resolve_current(state, include_completed=True), request)


# -- evidence -------------------------------------------------------------------
@api.post(
    "/sessions/{session_id}/attempts/{attempt_id}/evidence",
    tags=["evidence"],
    dependencies=[ControlRequired],
)
async def upload_evidence(
    session_id: str,
    attempt_id: int,
    request: Request,
    file: UploadFile = File(...),
    caption: str = Form(""),
):
    state = _state(request)
    attempt = state.db.query_one(
        "SELECT id FROM test_attempt WHERE id = ? AND session_id = ?",
        (attempt_id, session_id),
    )
    if attempt is None:
        raise HTTPException(404, "Attempt not found in this session")
    max_bytes = int(state.config.get("storage", "max_photo_mb") or 25) * 1024 * 1024
    data = await file.read()
    try:
        stored = store_photo(
            data, file.content_type or "", state.config.evidence_dir,
            session_id, attempt_id, max_bytes,
        )
    except EvidenceError as exc:
        raise HTTPException(422, str(exc)) from exc
    cursor = state.db.execute(
        "INSERT INTO evidence (attempt_id, original_path, derivative_path, caption,"
        " mime_type, sha256) VALUES (?,?,?,?,?,?)",
        (
            attempt_id, stored["original_path"], stored["derivative_path"],
            caption[:500], stored["mime_type"], stored["sha256"],
        ),
    )
    return {"id": cursor.lastrowid, **stored, "caption": caption[:500]}


@api.put(
    "/evidence/{evidence_id}/caption", tags=["evidence"], dependencies=[ControlRequired]
)
def update_caption(evidence_id: int, body: schemas.CaptionUpdate, request: Request):
    state = _state(request)
    row = state.db.query_one("SELECT id FROM evidence WHERE id = ?", (evidence_id,))
    if row is None:
        raise HTTPException(404, "Evidence not found")
    state.db.execute(
        "UPDATE evidence SET caption = ? WHERE id = ?", (body.caption, evidence_id)
    )
    return {"ok": True}


@api.get("/evidence/{evidence_id}/image", tags=["evidence"])
def get_evidence_image(evidence_id: int, request: Request, size: str = "derivative"):
    state = _state(request)
    row = state.db.query_one("SELECT * FROM evidence WHERE id = ?", (evidence_id,))
    if row is None:
        raise HTTPException(404, "Evidence not found")
    path = row["derivative_path"] if size == "derivative" and row["derivative_path"] else row["original_path"]
    return FileResponse(path)


# -- reports --------------------------------------------------------------------
@api.post("/sessions/{session_id}/report", tags=["reports"], dependencies=[ControlRequired])
async def create_report(session_id: str, request: Request):
    state = _state(request)
    try:
        # PDF rendering blocks for a few seconds - keep it off the event loop.
        result = await asyncio.to_thread(generate_report, state, session_id)
    except (ReportError, SessionError) as exc:
        raise HTTPException(409, str(exc)) from exc
    # Fresh report -> the connected display invites collection: a QR code
    # straight to the PDF plus "select another signal path".
    await state.activate_pattern("report")
    return result


@api.get("/sessions/{session_id}/reports", tags=["reports"])
def list_reports(session_id: str, request: Request):
    rows = _state(request).db.query(
        "SELECT * FROM report WHERE session_id = ? ORDER BY revision DESC",
        (session_id,),
    )
    return {"reports": [dict(r) for r in rows]}


@api.get("/reports", tags=["reports"])
def recent_reports(request: Request):
    rows = _state(request).db.query(
        "SELECT r.*, s.room, p.name AS project_name FROM report r"
        " JOIN session s ON s.id = r.session_id"
        " JOIN project p ON p.id = s.project_id"
        " ORDER BY r.generated_at DESC LIMIT 50"
    )
    return {"reports": [dict(r) for r in rows]}


@api.get("/reports/latest/download", tags=["reports"])
def download_latest_report(request: Request, kind: str = "pdf"):
    """The newest report, at a stable URL - open read, so a QR code or a
    bookmark reaches the PDF without any TL UI or login."""
    state = _state(request)
    row = state.db.query_one("SELECT * FROM report ORDER BY id DESC LIMIT 1")
    if row is None:
        raise HTTPException(404, "No reports have been generated yet")
    path = row["pdf_path"] if kind == "pdf" else row["json_path"]
    from pathlib import Path

    if not Path(path).exists():
        raise HTTPException(410, "Report file no longer exists on disk")
    return FileResponse(path, filename=Path(path).name)


@api.get("/reports/latest/qr.svg", tags=["reports"])
def latest_report_qr(request: Request):
    """QR code pointing at the newest report's PDF (shown on the kiosk's
    report-ready screen)."""
    state = _state(request)
    row = state.db.query_one("SELECT id FROM report ORDER BY id DESC LIMIT 1")
    if row is None:
        raise HTTPException(404, "No reports have been generated yet")
    base = state.identity()["control_url"].rstrip("/")
    url = f"{base}/api/v1/reports/{row['id']}/download"
    image = qrcode.make(url, image_factory=qrcode.image.svg.SvgPathImage, box_size=12)
    buf = io.BytesIO()
    image.save(buf)
    return Response(buf.getvalue(), media_type="image/svg+xml")


@api.get("/reports/{report_id}/download", tags=["reports"])
def download_report(report_id: int, request: Request, kind: str = "pdf"):
    row = _state(request).db.query_one("SELECT * FROM report WHERE id = ?", (report_id,))
    if row is None:
        raise HTTPException(404, "Report not found")
    path = row["pdf_path"] if kind == "pdf" else row["json_path"]
    from pathlib import Path

    if not Path(path).exists():
        raise HTTPException(410, "Report file no longer exists on disk")
    return FileResponse(path, filename=Path(path).name)


# -- events / logs -----------------------------------------------------------
@api.get("/system-events", tags=["events"])
def system_events(request: Request, session_id: str | None = None, limit: int = 200):
    return {"events": _state(request).store.events(session_id, min(limit, 1000))}


# -- websocket -------------------------------------------------------------------
@api.websocket("/events")
async def events_ws(websocket: WebSocket):
    state = websocket.app.state.appstate
    await websocket.accept()
    is_kiosk = websocket.query_params.get("role") == "kiosk"
    if is_kiosk:
        state.kiosk_connected = True
        from ..sessions import utcnow

        state.kiosk_last_seen = utcnow()
    queue = await state.hub.subscribe()
    try:
        # Push the full current state on connect so clients render immediately.
        await websocket.send_json(
            {"type": "hello", "payload": state.pattern_state()}
        )
        while True:
            sender = asyncio.create_task(queue.get())
            receiver = asyncio.create_task(websocket.receive_text())
            done, pending = await asyncio.wait(
                {sender, receiver}, return_when=asyncio.FIRST_COMPLETED
            )
            for task in pending:
                task.cancel()
            if sender in done:
                await websocket.send_text(sender.result())
            if receiver in done:
                receiver.result()  # raises WebSocketDisconnect when closed
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        await state.hub.unsubscribe(queue)
        if is_kiosk:
            state.kiosk_connected = False
