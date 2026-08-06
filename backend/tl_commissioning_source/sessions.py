"""Guided commissioning session state machine (§7.6).

States: draft -> in_progress -> review -> completed_passed / completed_failed.
"Failed step" from the brief is a UI condition (latest attempt of the
current test failed), not a distinct stored state.

Invariants enforced here, independent of the API layer:
- Results are append-only: attempts are never updated or deleted (FR-24).
- FAIL requires a note (FR-22).
- Completion as Passed is impossible while any required test's latest
  attempt is missing or failed (FR-37, AC-06).
- Completed sessions are read-only; Reopen records a revision event and
  timestamps reopened_at rather than rewriting history (FR-25).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from .db import Database


class SessionError(Exception):
    """Raised on any state-machine rule violation. Maps to HTTP 409/422."""


def utcnow() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


@dataclass
class SessionSummary:
    id: str
    status: str
    project_id: int
    room: str


class SessionStore:
    def __init__(self, db: Database):
        self.db = db

    # -- reference generation (FR-20) -----------------------------------
    def next_reference(self, when: datetime | None = None) -> str:
        when = when or datetime.now(timezone.utc)
        stamp = when.strftime("%Y%m%d")
        prefix = f"TL-{stamp}-"
        row = self.db.query_one(
            "SELECT id FROM session WHERE id LIKE ? ORDER BY id DESC LIMIT 1",
            (f"{prefix}%",),
        )
        seq = 1
        if row:
            try:
                seq = int(row["id"].rsplit("-", 1)[1]) + 1
            except (IndexError, ValueError):
                seq = 1
        return f"{prefix}{seq:03d}"

    # -- projects (FR-19) -------------------------------------------------
    def upsert_project(self, name: str, client: str, site: str, engineer: str) -> int:
        row = self.db.query_one(
            "SELECT id FROM project WHERE name = ? AND site = ?", (name, site)
        )
        if row:
            self.db.execute(
                "UPDATE project SET client = ?, default_engineer = ?, updated_at = ? WHERE id = ?",
                (client, engineer, utcnow(), row["id"]),
            )
            return int(row["id"])
        cursor = self.db.execute(
            "INSERT INTO project (name, client, site, default_engineer) VALUES (?, ?, ?, ?)",
            (name, client, site, engineer),
        )
        return int(cursor.lastrowid)

    def list_projects(self) -> list[dict]:
        return [
            dict(row)
            for row in self.db.query(
                "SELECT * FROM project ORDER BY updated_at DESC LIMIT 50"
            )
        ]

    # -- test definitions -------------------------------------------------
    def test_definitions(self) -> list[dict]:
        return [
            dict(row)
            for row in self.db.query(
                "SELECT * FROM test_definition ORDER BY sequence"
            )
        ]

    # -- session lifecycle ------------------------------------------------
    def create_session(
        self,
        project_id: int,
        room: str,
        engineer: str,
        signal_path_text: str,
        endpoints: dict[str, str] | None = None,
        selected_tests: list[str] | None = None,
        soak_minutes: int = 0,
    ) -> dict:
        known = {d["key"] for d in self.test_definitions()}
        if selected_tests is None:
            selected_tests = [
                d["key"] for d in self.test_definitions() if d["required_by_default"]
            ]
        unknown = set(selected_tests) - known
        if unknown:
            raise SessionError(f"Unknown tests selected: {', '.join(sorted(unknown))}")
        if not selected_tests:
            raise SessionError("At least one test must be selected")
        session_id = self.next_reference()
        self.db.execute(
            "INSERT INTO session (id, project_id, room, engineer, signal_path_text,"
            " endpoints_json, selected_tests_json, soak_minutes) VALUES (?,?,?,?,?,?,?,?)",
            (
                session_id, project_id, room, engineer, signal_path_text,
                json.dumps(endpoints or {}), json.dumps(selected_tests), soak_minutes,
            ),
        )
        return self.get_session(session_id)

    def get_session(self, session_id: str) -> dict:
        row = self.db.query_one(
            "SELECT * FROM session WHERE id = ? AND deleted = 0", (session_id,)
        )
        if row is None:
            raise SessionError(f"Session not found: {session_id}")
        session = dict(row)
        session["endpoints"] = json.loads(session.pop("endpoints_json"))
        session["selected_tests"] = json.loads(session.pop("selected_tests_json"))
        project = self.db.query_one(
            "SELECT * FROM project WHERE id = ?", (session["project_id"],)
        )
        session["project"] = dict(project) if project else None
        session["attempts"] = self.attempts(session_id)
        session["progress"] = self.progress(session_id, session)
        return session

    def list_sessions(self, status: str | None = None) -> list[dict]:
        if status:
            rows = self.db.query(
                "SELECT s.*, p.name AS project_name, p.client, p.site FROM session s"
                " JOIN project p ON p.id = s.project_id"
                " WHERE s.deleted = 0 AND s.status = ? ORDER BY s.created_at DESC",
                (status,),
            )
        else:
            rows = self.db.query(
                "SELECT s.*, p.name AS project_name, p.client, p.site FROM session s"
                " JOIN project p ON p.id = s.project_id"
                " WHERE s.deleted = 0 ORDER BY s.created_at DESC LIMIT 100"
            )
        out = []
        for row in rows:
            session = dict(row)
            session["endpoints"] = json.loads(session.pop("endpoints_json"))
            session["selected_tests"] = json.loads(session.pop("selected_tests_json"))
            out.append(session)
        return out

    def update_draft(self, session_id: str, fields: dict[str, Any]) -> dict:
        session = self.get_session(session_id)
        if session["status"] != "draft":
            raise SessionError("Only draft sessions can be edited")
        allowed = {
            "room", "engineer", "signal_path_text", "endpoints",
            "selected_tests", "soak_minutes",
        }
        unknown = set(fields) - allowed
        if unknown:
            raise SessionError(f"Fields not editable: {', '.join(sorted(unknown))}")
        merged = {**session, **fields}
        if not merged["selected_tests"]:
            raise SessionError("At least one test must be selected")
        known = {d["key"] for d in self.test_definitions()}
        if set(merged["selected_tests"]) - known:
            raise SessionError("Unknown tests selected")
        self.db.execute(
            "UPDATE session SET room=?, engineer=?, signal_path_text=?,"
            " endpoints_json=?, selected_tests_json=?, soak_minutes=? WHERE id=?",
            (
                merged["room"], merged["engineer"], merged["signal_path_text"],
                json.dumps(merged["endpoints"]), json.dumps(merged["selected_tests"]),
                int(merged["soak_minutes"]), session_id,
            ),
        )
        return self.get_session(session_id)

    def delete_draft(self, session_id: str) -> None:
        session = self.get_session(session_id)
        if session["status"] != "draft":
            raise SessionError(
                "Only draft sessions can be deleted; completed evidence is preserved"
            )
        self.db.execute("UPDATE session SET deleted = 1 WHERE id = ?", (session_id,))

    def abandon_active(self, reason: str, keep: str | None = None) -> list[str]:
        """Retire every in_progress/review session (single-active rule).

        Only one session can be worked at a time; starting a new one
        retires anything left behind. Retired sessions are soft-deleted
        (attempts and evidence remain in the database) and each gets a
        'session_abandoned' audit event - nothing is destroyed.
        """
        rows = self.db.query(
            "SELECT id FROM session WHERE status IN ('in_progress','review')"
            " AND deleted = 0"
        )
        abandoned = []
        for row in rows:
            if keep and row["id"] == keep:
                continue
            self.db.execute(
                "UPDATE session SET deleted = 1 WHERE id = ?", (row["id"],)
            )
            self.db.execute(
                "INSERT INTO system_event (session_id, severity, event_type, message)"
                " VALUES (?, 'warning', 'session_abandoned', ?)",
                (row["id"], f"Session abandoned: {reason.strip()}"),
            )
            abandoned.append(row["id"])
        return abandoned

    def start(self, session_id: str) -> dict:
        session = self.get_session(session_id)
        if session["status"] != "draft":
            raise SessionError(f"Cannot start a session in state {session['status']}")
        self.abandon_active(
            f"Superseded by new session {session_id} (one active session at a time)",
        )
        self.db.execute(
            "UPDATE session SET status = 'in_progress', started_at = ? WHERE id = ?",
            (utcnow(), session_id),
        )
        return self.get_session(session_id)

    # -- attempts ---------------------------------------------------------
    def record_attempt(
        self,
        session_id: str,
        test_key: str,
        result: str,
        note: str = "",
        engineer: str = "",
        fault_category: str = "",
        system_state: dict | None = None,
        started_at: str | None = None,
    ) -> dict:
        session = self.get_session(session_id)
        if session["status"] not in ("in_progress", "review"):
            raise SessionError(
                f"Results cannot be recorded in state {session['status']}"
            )
        if test_key not in session["selected_tests"]:
            raise SessionError(f"Test {test_key} is not part of this session")
        if result not in ("pass", "fail"):
            raise SessionError("Result must be 'pass' or 'fail'")
        if result == "fail" and not note.strip():
            raise SessionError("A failed test requires a note (FR-22)")
        row = self.db.query_one(
            "SELECT COALESCE(MAX(attempt_number), 0) AS n FROM test_attempt"
            " WHERE session_id = ? AND test_key = ?",
            (session_id, test_key),
        )
        attempt_number = int(row["n"]) + 1
        cursor = self.db.execute(
            "INSERT INTO test_attempt (session_id, test_key, attempt_number, result,"
            " note, engineer, fault_category, started_at, answered_at,"
            " captured_system_state_json) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (
                session_id, test_key, attempt_number, result,
                note.strip(), engineer or session["engineer"], fault_category,
                started_at, utcnow(), json.dumps(system_state or {}),
            ),
        )
        # A session sitting in review drops back to in_progress on retest.
        if session["status"] == "review":
            self.db.execute(
                "UPDATE session SET status = 'in_progress' WHERE id = ?", (session_id,)
            )
        attempt = self.db.query_one(
            "SELECT * FROM test_attempt WHERE id = ?", (cursor.lastrowid,)
        )
        return self._attempt_dict(attempt)

    def attempts(self, session_id: str) -> list[dict]:
        rows = self.db.query(
            "SELECT * FROM test_attempt WHERE session_id = ?"
            " ORDER BY test_key, attempt_number",
            (session_id,),
        )
        out = []
        for row in rows:
            attempt = self._attempt_dict(row)
            attempt["evidence"] = [
                dict(e)
                for e in self.db.query(
                    "SELECT id, caption, mime_type, sha256, created_at, original_path,"
                    " derivative_path FROM evidence WHERE attempt_id = ?",
                    (row["id"],),
                )
            ]
            out.append(attempt)
        return out

    def _attempt_dict(self, row) -> dict:
        attempt = dict(row)
        attempt["captured_system_state"] = json.loads(
            attempt.pop("captured_system_state_json")
        )
        return attempt

    # -- progress and completion (FR-37) --------------------------------
    def progress(self, session_id: str, session: dict | None = None) -> dict:
        if session is None:
            session = self.get_session(session_id)
        latest: dict[str, dict] = {}
        rows = self.db.query(
            "SELECT * FROM test_attempt WHERE session_id = ?"
            " ORDER BY attempt_number",
            (session_id,),
        )
        for row in rows:
            latest[row["test_key"]] = self._attempt_dict(row)
        tests = []
        for key in session["selected_tests"]:
            last = latest.get(key)
            tests.append(
                {
                    "test_key": key,
                    "answered": last is not None,
                    "latest_result": last["result"] if last else None,
                    "attempt_count": last["attempt_number"] if last else 0,
                }
            )
        unanswered = [t["test_key"] for t in tests if not t["answered"]]
        failed = [t["test_key"] for t in tests if t["latest_result"] == "fail"]
        return {
            "tests": tests,
            "unanswered": unanswered,
            "failed": failed,
            "can_complete_passed": not unanswered and not failed,
            "can_complete_failed": not unanswered and bool(failed),
        }

    def enter_review(self, session_id: str) -> dict:
        session = self.get_session(session_id)
        if session["status"] != "in_progress":
            raise SessionError(
                f"Cannot review a session in state {session['status']}"
            )
        self.db.execute(
            "UPDATE session SET status = 'review' WHERE id = ?", (session_id,)
        )
        return self.get_session(session_id)

    def complete(self, session_id: str) -> dict:
        """Validate and complete. Outcome is derived, never asserted (FR-37)."""
        session = self.get_session(session_id)
        if session["status"] not in ("in_progress", "review"):
            raise SessionError(
                f"Cannot complete a session in state {session['status']}"
            )
        progress = self.progress(session_id, session)
        if progress["unanswered"]:
            raise SessionError(
                "Completion blocked: unanswered tests: "
                + ", ".join(progress["unanswered"])
            )
        status = (
            "completed_passed" if progress["can_complete_passed"] else "completed_failed"
        )
        self.db.execute(
            "UPDATE session SET status = ?, completed_at = ? WHERE id = ?",
            (status, utcnow(), session_id),
        )
        return self.get_session(session_id)

    def reopen(self, session_id: str, reason: str) -> dict:
        session = self.get_session(session_id)
        if session["status"] not in ("completed_passed", "completed_failed"):
            raise SessionError("Only completed sessions can be reopened")
        if not reason.strip():
            raise SessionError("Reopening requires a reason")
        self.abandon_active(
            f"Superseded by reopened session {session_id} (one active session at a time)",
        )
        now = utcnow()
        self.db.execute(
            "UPDATE session SET status = 'in_progress', reopened_at = ?,"
            " completed_at = NULL WHERE id = ?",
            (now, session_id),
        )
        self.db.execute(
            "INSERT INTO system_event (session_id, severity, event_type, message)"
            " VALUES (?, 'warning', 'session_reopened', ?)",
            (session_id, f"Session reopened: {reason.strip()}"),
        )
        return self.get_session(session_id)

    # -- system events ------------------------------------------------------
    def record_event(
        self,
        event_type: str,
        message: str,
        severity: str = "info",
        session_id: str | None = None,
        state: dict | None = None,
    ) -> None:
        self.db.execute(
            "INSERT INTO system_event (session_id, severity, event_type, message, state_json)"
            " VALUES (?,?,?,?,?)",
            (session_id, severity, event_type, message, json.dumps(state or {})),
        )

    def events(self, session_id: str | None = None, limit: int = 200) -> list[dict]:
        if session_id:
            rows = self.db.query(
                "SELECT * FROM system_event WHERE session_id = ?"
                " ORDER BY id DESC LIMIT ?",
                (session_id, limit),
            )
        else:
            rows = self.db.query(
                "SELECT * FROM system_event ORDER BY id DESC LIMIT ?", (limit,)
            )
        return [dict(row) for row in rows]
