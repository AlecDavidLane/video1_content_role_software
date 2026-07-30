"""SQLite access and migrations.

Migrations are numbered SQL files under migrations/ applied in order and
recorded in schema_migrations (NFR-07). WAL mode is used so an abrupt
power-off during a test loses no committed result (NFR-05).
"""

from __future__ import annotations

import re
import sqlite3
import threading
from pathlib import Path

MIGRATIONS_DIR = Path(__file__).parent / "migrations"
_MIGRATION_RE = re.compile(r"^(\d{4})_[\w-]+\.sql$")


class Database:
    def __init__(self, path: Path | str):
        self.path = str(path)
        self._local = threading.local()

    def connect(self) -> sqlite3.Connection:
        conn = getattr(self._local, "conn", None)
        if conn is None:
            conn = sqlite3.connect(self.path, timeout=30)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA foreign_keys=ON")
            conn.execute("PRAGMA synchronous=NORMAL")
            self._local.conn = conn
        return conn

    def close(self) -> None:
        conn = getattr(self._local, "conn", None)
        if conn is not None:
            conn.close()
            self._local.conn = None

    # -- migrations -----------------------------------------------------
    def migrate(self) -> list[str]:
        conn = self.connect()
        conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations ("
            " version TEXT PRIMARY KEY,"
            " applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')))"
        )
        applied = {
            row["version"]
            for row in conn.execute("SELECT version FROM schema_migrations")
        }
        ran: list[str] = []
        for sql_file in sorted(MIGRATIONS_DIR.glob("*.sql")):
            match = _MIGRATION_RE.match(sql_file.name)
            if not match:
                continue
            version = sql_file.stem
            if version in applied:
                continue
            with conn:
                conn.executescript(sql_file.read_text(encoding="utf-8"))
                conn.execute(
                    "INSERT INTO schema_migrations (version) VALUES (?)", (version,)
                )
            ran.append(version)
        return ran

    # -- helpers ----------------------------------------------------------
    def execute(self, sql: str, params: tuple = ()) -> sqlite3.Cursor:
        conn = self.connect()
        with conn:
            return conn.execute(sql, params)

    def query(self, sql: str, params: tuple = ()) -> list[sqlite3.Row]:
        return self.connect().execute(sql, params).fetchall()

    def query_one(self, sql: str, params: tuple = ()) -> sqlite3.Row | None:
        return self.connect().execute(sql, params).fetchone()
