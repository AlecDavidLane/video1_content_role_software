"""Report result logic (§7.8, FR-32..37)."""

import hashlib
import json
from pathlib import Path

import pytest

from tl_commissioning_source import reports
from tl_commissioning_source.reports import (
    ReportError,
    build_report_data,
    generate_report,
    safe_filename,
)

from conftest import make_session


@pytest.fixture(autouse=True)
def fake_pdf(monkeypatch):
    """Report data/JSON logic is tested everywhere; the real Chromium
    rendering is covered by the smoke test and sample generation."""
    monkeypatch.setattr(
        reports, "html_to_pdf",
        lambda html, pdf_path, config: Path(pdf_path).write_bytes(b"%PDF-1.4 fake"),
    )


def _complete(store, state, failed=False):
    session = make_session(store)
    store.start(session["id"])
    store.record_attempt(
        session["id"], "identify", "pass", system_state=state.captured_state()
    )
    store.record_attempt(
        session["id"], "colour",
        "fail" if failed else "pass",
        note="colour missing" if failed else "",
        system_state=state.captured_state(),
    )
    return store.complete(session["id"])


def test_report_requires_completed_session(appstate):
    session = make_session(appstate.store)
    with pytest.raises(ReportError):
        build_report_data(appstate, session["id"])


def test_passed_report_data(appstate):
    session = _complete(appstate.store, appstate)
    data = build_report_data(appstate, session["id"])
    assert data["overall_passed"] is True
    assert data["unresolved_failures"] == []
    assert {r["test_key"] for r in data["results"]} == {"identify", "colour"}


def test_failed_report_flags_unresolved(appstate):
    session = _complete(appstate.store, appstate, failed=True)
    data = build_report_data(appstate, session["id"])
    assert data["overall_passed"] is False
    assert [r["test_key"] for r in data["unresolved_failures"]] == ["colour"]


def test_generate_writes_pdf_json_and_checksum(appstate):
    session = _complete(appstate.store, appstate)
    result = generate_report(appstate, session["id"])
    pdf = Path(result["pdf_path"])
    json_file = Path(result["json_path"])
    assert pdf.exists() and json_file.exists()
    digest = hashlib.sha256(json_file.read_bytes()).hexdigest()
    assert digest == result["json_sha256"]
    payload = json.loads(json_file.read_text())
    assert payload["session"]["id"] == session["id"]
    assert payload["report"]["revision"] == 1
    # Checksum sidecar file
    sidecar = json_file.with_suffix(".json.sha256")
    assert sidecar.exists()
    assert digest in sidecar.read_text()


def test_regeneration_increments_revision_without_touching_data(appstate):
    session = _complete(appstate.store, appstate)
    first = generate_report(appstate, session["id"])
    attempts_before = appstate.store.attempts(session["id"])
    second = generate_report(appstate, session["id"])
    assert second["revision"] == first["revision"] + 1
    assert appstate.store.attempts(session["id"]) == attempts_before


def test_attempt_records_output_mode(appstate):
    """AC-09: each attempt captures connector and mode."""
    session = _complete(appstate.store, appstate)
    attempts = appstate.store.attempts(session["id"])
    for attempt in attempts:
        captured = attempt["captured_system_state"]
        assert captured["connector"] == "HDMI-1"
        assert captured["mode"] == "1920x1080@60"


def test_safe_filename():
    assert safe_filename("Room 3 / Rack: A") == "Room-3-Rack-A"
    assert safe_filename("   ") == "untitled"
    assert safe_filename("x" * 100) == "x" * 60
    assert "/" not in safe_filename("../../etc/passwd")
