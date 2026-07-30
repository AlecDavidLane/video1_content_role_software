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
