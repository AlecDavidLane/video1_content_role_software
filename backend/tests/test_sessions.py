"""Session state machine rules (§7.6, FR-21..26, FR-37)."""

import pytest

from tl_commissioning_source.sessions import SessionError

from conftest import make_session


def test_reference_format_and_sequence(store):
    first = make_session(store)
    second = make_session(store)
    assert first["id"].startswith("TL-")
    assert first["id"].endswith("-001")
    assert second["id"].endswith("-002")


def test_draft_lifecycle(store):
    session = make_session(store)
    assert session["status"] == "draft"
    updated = store.update_draft(session["id"], {"room": "Boardroom"})
    assert updated["room"] == "Boardroom"
    store.delete_draft(session["id"])
    with pytest.raises(SessionError):
        store.get_session(session["id"])


def test_started_session_cannot_be_edited_or_deleted(store):
    session = make_session(store)
    store.start(session["id"])
    with pytest.raises(SessionError):
        store.update_draft(session["id"], {"room": "X"})
    with pytest.raises(SessionError):
        store.delete_draft(session["id"])


def test_attempts_require_started_session(store):
    session = make_session(store)
    with pytest.raises(SessionError):
        store.record_attempt(session["id"], "identify", "pass")


def test_fail_requires_note(store):
    session = make_session(store)
    store.start(session["id"])
    with pytest.raises(SessionError, match="note"):
        store.record_attempt(session["id"], "identify", "fail", note="   ")
    attempt = store.record_attempt(
        session["id"], "identify", "fail", note="No image at destination"
    )
    assert attempt["attempt_number"] == 1


def test_retest_appends_and_keeps_history(store):
    session = make_session(store)
    store.start(session["id"])
    store.record_attempt(session["id"], "identify", "fail", note="bad cable")
    store.record_attempt(session["id"], "identify", "pass")
    attempts = [
        a for a in store.attempts(session["id"]) if a["test_key"] == "identify"
    ]
    assert [a["result"] for a in attempts] == ["fail", "pass"]
    progress = store.progress(session["id"])
    identify = next(t for t in progress["tests"] if t["test_key"] == "identify")
    assert identify["latest_result"] == "pass"
    assert identify["attempt_count"] == 2


def test_completion_blocked_while_unanswered(store):
    session = make_session(store)
    store.start(session["id"])
    store.record_attempt(session["id"], "identify", "pass")
    with pytest.raises(SessionError, match="unanswered"):
        store.complete(session["id"])


def test_completion_outcome_is_derived_not_asserted(store):
    session = make_session(store)
    store.start(session["id"])
    store.record_attempt(session["id"], "identify", "pass")
    store.record_attempt(session["id"], "colour", "fail", note="green missing")
    completed = store.complete(session["id"])
    assert completed["status"] == "completed_failed"


def test_completed_passed_requires_all_latest_passed(store):
    session = make_session(store)
    store.start(session["id"])
    store.record_attempt(session["id"], "identify", "fail", note="x")
    store.record_attempt(session["id"], "identify", "pass")
    store.record_attempt(session["id"], "colour", "pass")
    completed = store.complete(session["id"])
    assert completed["status"] == "completed_passed"


def test_completed_session_is_read_only(store):
    session = make_session(store)
    store.start(session["id"])
    store.record_attempt(session["id"], "identify", "pass")
    store.record_attempt(session["id"], "colour", "pass")
    store.complete(session["id"])
    with pytest.raises(SessionError):
        store.record_attempt(session["id"], "identify", "pass")


def test_reopen_requires_reason_and_records_event(store):
    session = make_session(store)
    store.start(session["id"])
    store.record_attempt(session["id"], "identify", "pass")
    store.record_attempt(session["id"], "colour", "pass")
    store.complete(session["id"])
    with pytest.raises(SessionError):
        store.reopen(session["id"], "  ")
    reopened = store.reopen(session["id"], "Client requested re-verification")
    assert reopened["status"] == "in_progress"
    assert reopened["reopened_at"] is not None
    events = store.events(session_id=session["id"])
    assert any(e["event_type"] == "session_reopened" for e in events)


def test_unknown_test_rejected(store):
    session = make_session(store)
    store.start(session["id"])
    with pytest.raises(SessionError):
        store.record_attempt(session["id"], "hdcp", "pass")


def test_create_requires_known_tests(store):
    with pytest.raises(SessionError):
        make_session(store, tests=["identify", "nonsense"])
    project_id = store.upsert_project("P2", "", "", "")
    with pytest.raises(SessionError):
        store.create_session(
            project_id=project_id, room="", engineer="",
            signal_path_text="", selected_tests=[],
        )
