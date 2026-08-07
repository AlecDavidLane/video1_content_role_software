"""API validation and auth (§10, AC-13)."""

import io

from PIL import Image


def _setup_appliance(client, pin="135790"):
    response = client.post(
        "/api/v1/setup",
        json={"company_name": "Co", "pin": pin, "source_number": 1},
    )
    assert response.status_code == 200
    token = client.post("/api/v1/auth/token", json={"pin": pin}).json()["token"]
    return {"Authorization": f"Bearer {token}"}


def test_state_changing_calls_open_before_setup(client):
    response = client.post("/api/v1/patterns/identify/activate", json={})
    assert response.status_code == 200


def test_state_changing_calls_locked_after_setup(client):
    _setup_appliance(client)
    response = client.post("/api/v1/patterns/identify/activate", json={})
    assert response.status_code == 401
    response = client.post("/api/v1/sessions", json={"project_name": "P"})
    assert response.status_code == 401


def test_wrong_pin_rejected(client):
    _setup_appliance(client)
    response = client.post("/api/v1/auth/token", json={"pin": "000000"})
    assert response.status_code == 401


def test_token_grants_access_and_reads_stay_open(client):
    auth = _setup_appliance(client)
    assert client.post(
        "/api/v1/patterns/identify/activate", json={}, headers=auth
    ).status_code == 200
    assert client.get("/api/v1/status").status_code == 200
    assert client.get("/api/v1/patterns").status_code == 200


def test_unknown_pattern_and_bad_params(client):
    auth = _setup_appliance(client)
    assert client.post(
        "/api/v1/patterns/nonsense/activate", json={}, headers=auth
    ).status_code == 422
    response = client.post(
        "/api/v1/patterns/motion/activate",
        json={"params": {"speed": 99}},
        headers=auth,
    )
    assert response.status_code == 422


def test_output_mode_must_be_advertised(client):
    auth = _setup_appliance(client)
    response = client.post(
        "/api/v1/output/mode",
        json={"connector": "HDMI-1", "mode": "1234x777@60"},
        headers=auth,
    )
    assert response.status_code == 422
    response = client.post(
        "/api/v1/output/mode",
        json={"connector": "HDMI-1", "mode": "1280x720@50"},
        headers=auth,
    )
    assert response.status_code == 200
    assert response.json()["active"]["active_mode"]["key"] == "1280x720@50"


def test_audio_sink_validation(client):
    auth = _setup_appliance(client)
    assert client.post(
        "/api/v1/audio/sink", json={"sink": "not-a-sink"}, headers=auth
    ).status_code == 422


def test_session_flow_over_api(client):
    auth = _setup_appliance(client)
    session = client.post(
        "/api/v1/sessions",
        json={
            "project_name": "P", "room": "R", "engineer": "E",
            "signal_path_text": "a->b",
            "selected_tests": ["identify"],
        },
        headers=auth,
    ).json()
    session_id = session["id"]
    assert client.post(f"/api/v1/sessions/{session_id}/start", headers=auth).status_code == 200
    # fail without note -> 409
    assert client.post(
        f"/api/v1/sessions/{session_id}/tests/identify/attempts",
        json={"result": "fail", "note": ""},
        headers=auth,
    ).status_code == 409
    # complete while unanswered -> 409
    assert client.post(
        f"/api/v1/sessions/{session_id}/complete", headers=auth
    ).status_code == 409
    assert client.post(
        f"/api/v1/sessions/{session_id}/tests/identify/attempts",
        json={"result": "pass"},
        headers=auth,
    ).status_code == 200
    done = client.post(f"/api/v1/sessions/{session_id}/complete", headers=auth)
    assert done.json()["status"] == "completed_passed"


def _png_bytes(size=(400, 300)):
    buffer = io.BytesIO()
    Image.new("RGB", size, "#3355aa").save(buffer, "PNG")
    return buffer.getvalue()


def test_evidence_upload_validation(client):
    auth = _setup_appliance(client)
    session = client.post(
        "/api/v1/sessions",
        json={"project_name": "P", "selected_tests": ["identify"]},
        headers=auth,
    ).json()
    client.post(f"/api/v1/sessions/{session['id']}/start", headers=auth)
    attempt = client.post(
        f"/api/v1/sessions/{session['id']}/tests/identify/attempts",
        json={"result": "pass"},
        headers=auth,
    ).json()

    # Executable content disguised as an image is rejected (AC-13).
    response = client.post(
        f"/api/v1/sessions/{session['id']}/attempts/{attempt['id']}/evidence",
        files={"file": ("evil.png", b"#!/bin/sh\nrm -rf /", "image/png")},
        headers=auth,
    )
    assert response.status_code == 422

    response = client.post(
        f"/api/v1/sessions/{session['id']}/attempts/{attempt['id']}/evidence",
        files={"file": ("photo.png", _png_bytes(), "image/png")},
        data={"caption": "Destination display"},
        headers=auth,
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["caption"] == "Destination display"
    image = client.get(f"/api/v1/evidence/{payload['id']}/image")
    assert image.status_code == 200

    # Wrong attempt id -> 404
    response = client.post(
        f"/api/v1/sessions/{session['id']}/attempts/99999/evidence",
        files={"file": ("photo.png", _png_bytes(), "image/png")},
        headers=auth,
    )
    assert response.status_code == 404


def test_config_export_never_contains_secrets(client):
    auth = _setup_appliance(client)
    exported = client.get("/api/v1/config/export").json()
    assert "pin_hash" not in exported.get("security", {})
    assert "pin_salt" not in exported.get("security", {})
    # And importing a crafted payload cannot smuggle a hash in.
    response = client.post(
        "/api/v1/config/import",
        json={"security": {"pin_hash": "attacker", "pin_salt": "x"}},
        headers=auth,
    )
    assert response.status_code == 200
    still = client.post("/api/v1/auth/token", json={"pin": "135790"})
    assert still.status_code == 200  # original PIN still works


def test_health_endpoint_shape(client):
    response = client.get("/health")
    assert response.status_code in (200, 503)
    payload = response.json()
    assert set(payload["checks"]) >= {
        "backend", "database", "output_browser", "display", "audio", "disk",
    }


def test_static_api_token_for_integrations(client, workdir):
    """OpenAVC-style integrations authenticate with a provisioned static
    bearer token instead of the PIN flow."""
    _setup_appliance(client)
    # Provision the token the way the CLI does.
    from tl_commissioning_source.config import load_config

    config = load_config()
    config.set(("security", "api_token"), "openavc-static-token")
    config.save()
    client.app.state.appstate.config = load_config()

    headers = {"Authorization": "Bearer openavc-static-token"}
    assert client.post(
        "/api/v1/patterns/identify/activate", json={}, headers=headers
    ).status_code == 200
    assert client.post(
        "/api/v1/patterns/identify/activate", json={},
        headers={"Authorization": "Bearer wrong-token"},
    ).status_code == 401
    # The static token is a secret: never exported.
    exported = client.get("/api/v1/config/export").json()
    assert "api_token" not in exported.get("security", {})


def test_status_works_while_soak_running(client):
    """Regression: /status is a sync endpoint served from a worker thread;
    the soak timer must not depend on the event-loop clock."""
    response = client.post(
        "/api/v1/patterns/soak/activate", json={"params": {"minutes": 1}}
    )
    assert response.status_code == 200
    status = client.get("/api/v1/status")
    assert status.status_code == 200
    payload = status.json()
    assert payload["soak"]["running"] is True
    assert payload["soak"]["remaining_seconds"] <= 60
    client.post("/api/v1/soak/stop")


def test_current_session_panel_workflow(client, monkeypatch):
    """OpenAVC-style flow: autostart session -> pass/fail via current-session
    aliases -> complete -> report, with no session-ID plumbing."""
    auth = _setup_appliance(client)

    # No active session yet -> 404 with guidance
    response = client.post(
        "/api/v1/current-session/tests/identify/attempts",
        json={"result": "pass"}, headers=auth,
    )
    assert response.status_code == 404

    # Create + start in one call
    session = client.post(
        "/api/v1/sessions",
        json={
            "project_name": "Room 12", "room": "Meeting Room",
            "signal_path_text": "Switcher out 1 -> Left monitor",
            "selected_tests": ["identify", "colour"],
            "autostart": True,
        },
        headers=auth,
    ).json()
    assert session["status"] == "in_progress"

    assert client.get("/api/v1/current-session").json()["id"] == session["id"]

    # Fail without note still blocked through the alias
    assert client.post(
        "/api/v1/current-session/tests/identify/attempts",
        json={"result": "fail", "note": ""}, headers=auth,
    ).status_code == 409

    for key in ("identify", "colour"):
        assert client.post(
            f"/api/v1/current-session/tests/{key}/attempts",
            json={"result": "pass"}, headers=auth,
        ).status_code == 200

    done = client.post("/api/v1/current-session/complete", headers=auth).json()
    assert done["status"] == "completed_passed"
    # Completion returns the output to the idle Identify pattern.
    assert client.app.state.appstate.active_pattern == "identify"

    # After completion the report alias still resolves (to the completed one)
    from tl_commissioning_source.api import routes as routes_module

    monkeypatch.setattr(
        routes_module, "generate_report",
        lambda state, sid: {"session_id": sid, "revision": 1, "pdf_path": "x.pdf",
                            "json_path": "x.json", "json_sha256": "0" * 64,
                            "generated_at": "now"},
    )
    report = client.post("/api/v1/current-session/report", headers=auth).json()
    assert report["session_id"] == done["id"]
    # Report generation flips the display to the "get your report" screen.
    assert client.app.state.appstate.active_pattern == "report"

    # But attempts against the completed session are gone (404, not 409)
    assert client.post(
        "/api/v1/current-session/tests/identify/attempts",
        json={"result": "pass"}, headers=auth,
    ).status_code == 404


def test_status_reports_next_unanswered_test(client):
    """Panel integrations follow the appliance's next_test instead of
    counting steps client-side."""
    auth = _setup_appliance(client)
    empty = client.get("/api/v1/status").json()
    assert empty["next_test"] == "" and empty["unanswered_count"] == 0

    client.post(
        "/api/v1/sessions",
        json={"project_name": "P", "selected_tests": ["identify", "colour", "mode"],
              "autostart": True},
        headers=auth,
    )
    s = client.get("/api/v1/status").json()
    assert s["next_test"] == "identify"
    assert s["unanswered_count"] == 3
    assert s["current_session_status"] == "in_progress"

    client.post("/api/v1/current-session/tests/identify/attempts",
                json={"result": "pass"}, headers=auth)
    s = client.get("/api/v1/status").json()
    assert s["next_test"] == "colour"
    assert s["unanswered_count"] == 2

    # Answering out of order still yields the first unanswered in sequence
    client.post("/api/v1/current-session/tests/mode/attempts",
                json={"result": "pass"}, headers=auth)
    s = client.get("/api/v1/status").json()
    assert s["next_test"] == "colour"
    assert s["unanswered_count"] == 1

    client.post("/api/v1/current-session/tests/colour/attempts",
                json={"result": "pass"}, headers=auth)
    s = client.get("/api/v1/status").json()
    assert s["next_test"] == "" and s["unanswered_count"] == 0
    client.post("/api/v1/current-session/complete", headers=auth)
    # After completion, status keeps reporting the finished session so a
    # panel can show the outcome instead of going blank.
    s = client.get("/api/v1/status").json()
    assert s["current_session_status"] == "completed_passed"
    assert s["next_test"] == "" and s["unanswered_count"] == 0


def test_only_one_active_session(client):
    """Starting a new session retires anything left in progress, so the
    appliance can never accumulate zombie in-progress sessions."""
    auth = _setup_appliance(client)

    def begin(name):
        return client.post(
            "/api/v1/sessions",
            json={"project_name": name, "selected_tests": ["identify"],
                  "autostart": True},
            headers=auth,
        ).json()

    first = begin("Path A")
    second = begin("Path B")
    third = begin("Path C")
    assert len({first["id"], second["id"], third["id"]}) == 3

    # Only the newest session is visible / in progress.
    sessions = client.get("/api/v1/sessions").json()["sessions"]
    active = [s for s in sessions if s["status"] in ("in_progress", "review")]
    assert [s["id"] for s in active] == [third["id"]]

    # The retired sessions are soft-deleted with an audit trail, not destroyed.
    events = client.get("/api/v1/system-events").json()["events"]
    abandoned = [e for e in events if e["event_type"] == "session_abandoned"]
    assert {e["session_id"] for e in abandoned} == {first["id"], second["id"]}

    # current-session aliases target the survivor.
    assert client.get("/api/v1/current-session").json()["id"] == third["id"]


def test_report_ready_screen_and_latest_download(client, monkeypatch, tmp_path):
    """Generating a report shows the 'get your report' QR screen on the
    display, and the latest-report endpoints serve the PDF without auth."""
    auth = _setup_appliance(client)

    assert client.get("/api/v1/reports/latest/download").status_code == 404
    assert client.get("/api/v1/reports/latest/qr.svg").status_code == 404

    client.post(
        "/api/v1/sessions",
        json={"project_name": "P", "selected_tests": ["identify"],
              "autostart": True},
        headers=auth,
    )
    client.post("/api/v1/current-session/tests/identify/attempts",
                json={"result": "pass"}, headers=auth)
    client.post("/api/v1/current-session/complete", headers=auth)

    pdf = tmp_path / "r.pdf"
    pdf.write_bytes(b"%PDF-1.4 fake")
    json_file = tmp_path / "r.json"
    json_file.write_text("{}")

    from tl_commissioning_source.api import routes as routes_module

    def fake_generate(state, sid):
        state.db.execute(
            "INSERT INTO report (session_id, revision, pdf_path, json_path,"
            " json_sha256) VALUES (?,?,?,?,?)",
            (sid, 1, str(pdf), str(json_file), "0" * 64),
        )
        return {"session_id": sid, "revision": 1, "pdf_path": str(pdf),
                "json_path": str(json_file), "json_sha256": "0" * 64,
                "generated_at": "now"}

    monkeypatch.setattr(routes_module, "generate_report", fake_generate)
    assert client.post(
        "/api/v1/current-session/report", headers=auth
    ).status_code == 200

    s = client.get("/api/v1/status").json()
    assert s["pattern"]["active_pattern"] == "report"
    payload = client.app.state.appstate.pattern_state()
    assert payload["report"]["status"] == "completed_passed"

    # Open reads: QR scan / bookmark reach the PDF with no login.
    download = client.get("/api/v1/reports/latest/download")
    assert download.status_code == 200
    assert download.content.startswith(b"%PDF")
    qr = client.get("/api/v1/reports/latest/qr.svg")
    assert qr.status_code == 200
    assert b"svg" in qr.content


def test_kiosk_files_are_never_cached(client):
    """Kiosk JS is unversioned; without no-store, Chromium's heuristic
    cache kept serving the previous release's renderer after upgrades."""
    response = client.get("/kiosk/patterns.js")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert client.get("/kiosk/").headers["cache-control"] == "no-store"


def test_boots_to_identify_and_panel_qr(client):
    """The appliance is self-describing from power-on: startup activates
    Identify, and a configured panel URL yields a QR for the kiosk."""
    appstate = client.app.state.appstate
    assert appstate.active_pattern == "identify"

    assert client.get("/api/v1/integration/panel-qr.svg").status_code == 404
    assert appstate.identity()["panel_url"] == ""

    appstate.config.set(("integration", "panel_url"), "http://10.0.0.5:8080/panel")
    response = client.get("/api/v1/integration/panel-qr.svg")
    assert response.status_code == 200
    assert b"svg" in response.content
    assert appstate.identity()["panel_url"] == "http://10.0.0.5:8080/panel"

    # {ip} resolves to the current LAN address per request (DHCP-safe).
    appstate.config.set(("integration", "panel_url"), "http://{ip}:8080/panel")
    resolved = appstate.identity()["panel_url"]
    assert "{ip}" not in resolved
    assert resolved.startswith("http://") and resolved.endswith(":8080/panel")
    assert client.get("/api/v1/integration/panel-qr.svg").status_code == 200


def test_require_pin_opt_out(client):
    """security.require_pin=false opens control to the LAN (per-appliance
    opt-out; the shipped default stays on per NFR-09/AC-13)."""
    _setup_appliance(client)
    appstate = client.app.state.appstate
    assert client.post(
        "/api/v1/patterns/identify/activate", json={}
    ).status_code == 401

    appstate.config.set(("security", "require_pin"), False)
    assert client.post(
        "/api/v1/patterns/identify/activate", json={}
    ).status_code == 200

    appstate.config.set(("security", "require_pin"), True)
    assert client.post(
        "/api/v1/patterns/identify/activate", json={}
    ).status_code == 401
