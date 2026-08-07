"""Runtime appliance state.

One AppState instance owns the config, database, hardware backends, the
active pattern, the soak runner and a background health watcher. It is
created on FastAPI startup and injected into routers.
"""

from __future__ import annotations

import asyncio
import shutil
import socket
import time
from datetime import datetime, timezone
from typing import Any

from . import __version__
from .audio import AudioBackend, make_audio_backend
from .config import Config
from .db import Database
from .display import DisplayBackend, DisplayMode, QUICK_MODES, make_display_backend
from .events import EventHub
from .patterns import (
    HOLDING,
    PATTERNS,
    REPORT_READY,
    SOAK_CYCLE,
    SOAK_STEP_SECONDS,
    validate_params,
)
from .sessions import SessionStore, utcnow


def _hostname() -> str:
    return socket.gethostname()


def _primary_ip() -> str:
    """Best-effort LAN IP without sending traffic (works offline)."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect(("10.255.255.255", 1))
            return probe.getsockname()[0]
    except OSError:
        return "127.0.0.1"


class AppState:
    def __init__(self, config: Config):
        self.config = config
        config.ensure_dirs()
        self.db = Database(config.db_path)
        self.db.migrate()
        self.store = SessionStore(self.db)
        self.hub = EventHub()
        self.display: DisplayBackend = make_display_backend(
            config.get("hardware", "display_backend", default="auto")
        )
        self.audio: AudioBackend = make_audio_backend(
            config.get("hardware", "audio_backend", default="auto")
        )
        self.active_pattern: str = HOLDING
        self.active_params: dict[str, Any] = {}
        self.kiosk_connected: bool = False
        self.kiosk_last_seen: str | None = None
        self.soak: SoakRunner = SoakRunner(self)
        self._watcher_task: asyncio.Task | None = None
        self._last_output_connected: bool | None = None
        self.started_at = utcnow()

    # -- identity ---------------------------------------------------------
    def identity(self) -> dict:
        port = self.config.get("server", "port")
        external = self.config.get("server", "external_url") or ""
        control_url = external or f"http://{_primary_ip()}:{port}"
        return {
            "appliance_id": self.config.get("appliance", "id") or "UNSET",
            "friendly_name": self.config.get("appliance", "friendly_name"),
            "source_number": self.config.get("appliance", "source_number"),
            "hostname": _hostname(),
            "ip_address": _primary_ip(),
            "control_url": control_url,
            # {ip} resolves to the current LAN address at request time, so a
            # DHCP lease change never leaves a stale QR on the display.
            "panel_url": (self.config.get("integration", "panel_url") or "").replace(
                "{ip}", _primary_ip()
            ),
            "app_version": __version__,
            "role_version": self._role_version(),
        }

    def _role_version(self) -> str:
        row = self.db.query_one("SELECT role_version FROM appliance LIMIT 1")
        return row["role_version"] if row else ""

    # -- pattern control (FR-08) -----------------------------------------
    async def activate_pattern(self, key: str, params: dict[str, Any] | None = None) -> dict:
        if key not in (HOLDING, REPORT_READY) and key not in PATTERNS:
            raise ValueError(f"Unknown pattern: {key}")
        clean = validate_params(key, params or {}) if key in PATTERNS else {}
        if key == "soak":
            minutes = clean.get("minutes") or self.config.get("soak", "default_minutes")
            await self.soak.start(minutes=minutes)
        elif self.soak.running:
            await self.soak.stop(interrupted=True)
        self.active_pattern = key
        self.active_params = clean
        await self.hub.publish("pattern", self.pattern_state())
        return self.pattern_state()

    def latest_report(self) -> dict | None:
        row = self.db.query_one(
            "SELECT r.id, r.session_id, r.revision, r.generated_at, s.status"
            " FROM report r JOIN session s ON s.id = r.session_id"
            " ORDER BY r.id DESC LIMIT 1"
        )
        return dict(row) if row else None

    def pattern_state(self) -> dict:
        return {
            "active_pattern": self.active_pattern,
            "params": self.active_params,
            "identity": self.identity(),
            "report": self.latest_report()
            if self.active_pattern == REPORT_READY
            else None,
            "output": self.output_state(),
            "audio_enabled": bool(self.config.get("soak", "audio_enabled"))
            if self.soak.running
            else True,
            "soak": self.soak.state(),
        }

    # -- output -----------------------------------------------------------
    def output_state(self) -> dict:
        try:
            outputs = self.display.list_outputs()
        except Exception as exc:  # noqa: BLE001 - surfaced as fault, not crash
            return {"error": f"Display query failed: {exc}", "outputs": [], "active": None}
        preferred = self.config.get("output", "preferred_connector") or ""
        active = None
        for output in outputs:
            if output.connected and (not preferred or output.connector == preferred):
                active = output
                break
        if active is None:
            active = next((o for o in outputs if o.connected), None)
        quick = []
        if active:
            available = {m.key for m in active.modes}
            quick = [m for m in QUICK_MODES if m in available]
        return {
            "outputs": [o.to_dict() for o in outputs],
            "active": active.to_dict() if active else None,
            "quick_modes": quick,
            "backend": getattr(self.display, "kind", "unknown"),
        }

    async def set_mode(self, connector: str, mode_key: str) -> dict:
        mode = self.display.find_mode(connector, mode_key)
        if mode is None:
            raise ValueError(
                f"Mode {mode_key} is not advertised by {connector} (FR-12)"
            )
        self.display.set_mode(connector, mode)
        self.store.record_event(
            "output_mode_changed",
            f"Output {connector} set to {mode.key}",
            state={"connector": connector, "mode": mode.key},
        )
        state = self.output_state()
        await self.hub.publish("output", state)
        return state

    # -- audio --------------------------------------------------------------
    def audio_state(self) -> dict:
        try:
            sinks = self.audio.list_sinks()
        except Exception as exc:  # noqa: BLE001
            return {"error": f"Audio query failed: {exc}", "sinks": []}
        return {
            "sinks": [s.to_dict() for s in sinks],
            "backend": getattr(self.audio, "kind", "unknown"),
        }

    async def set_audio_sink(self, name: str) -> dict:
        known = {s.name for s in self.audio.list_sinks()}
        if name not in known:
            raise ValueError(f"Audio sink not found: {name}")
        self.audio.set_default_sink(name)
        self.store.record_event(
            "audio_sink_changed", f"Audio sink set to {name}", state={"sink": name}
        )
        state = self.audio_state()
        await self.hub.publish("audio", state)
        return state

    # -- health (FR-38) ------------------------------------------------------
    def health(self) -> dict:
        output = self.output_state()
        active = output.get("active")
        checks = {
            "backend": {"ok": True, "detail": f"version {__version__}"},
            "database": self._db_health(),
            "output_browser": {
                "ok": self.kiosk_connected,
                "detail": "Kiosk connected"
                if self.kiosk_connected
                else "Kiosk page not connected",
            },
            "display": {
                "ok": active is not None,
                # A mock answer must never read as real hardware (simulated
                # data is fine for bench work, poison in a commissioning log).
                "detail": (
                    f"{active['connector']} {active['active_mode']['key']}"
                    if active and active.get("active_mode")
                    else "HDMI output disconnected"
                )
                + (
                    " (SIMULATED - no real display control)"
                    if output.get("backend") == "mock"
                    else ""
                ),
            },
            "audio": self._audio_health(),
            "disk": self._disk_health(),
        }
        return {
            "ok": all(c["ok"] for c in checks.values()),
            "checks": checks,
            "started_at": self.started_at,
        }

    def _db_health(self) -> dict:
        try:
            self.db.query_one("SELECT 1")
            return {"ok": True, "detail": str(self.config.db_path)}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "detail": f"Database error: {exc}"}

    def _audio_health(self) -> dict:
        state = self.audio_state()
        if state.get("error"):
            return {"ok": False, "detail": state["error"]}
        default = next((s for s in state["sinks"] if s["is_default"]), None)
        return {
            "ok": default is not None,
            "detail": (default["name"] if default else "No default audio sink")
            + (
                " (SIMULATED - no real audio control)"
                if state.get("backend") == "mock"
                else ""
            ),
        }

    def _disk_health(self) -> dict:
        try:
            usage = shutil.disk_usage(self.config.data_dir)
        except OSError as exc:
            return {"ok": False, "detail": f"Disk check failed: {exc}"}
        free_mb = usage.free // (1024 * 1024)
        warn_mb = int(self.config.get("storage", "low_disk_warn_mb") or 0)
        ok = warn_mb == 0 or free_mb > warn_mb
        return {
            "ok": ok,
            "detail": f"{free_mb} MB free"
            + ("" if ok else f" (below {warn_mb} MB warning threshold, NFR-10)"),
        }

    # -- output watcher (FR-16, AC-11) --------------------------------------
    async def start_watcher(self) -> None:
        self._watcher_task = asyncio.create_task(self._watch_output())

    async def stop_watcher(self) -> None:
        if self._watcher_task:
            self._watcher_task.cancel()
            try:
                await self._watcher_task
            except asyncio.CancelledError:
                pass
        await self.soak.stop(interrupted=True)

    async def _watch_output(self) -> None:
        while True:
            try:
                output = self.output_state()
                connected = output.get("active") is not None
                if self._last_output_connected is None:
                    self._last_output_connected = connected
                elif connected != self._last_output_connected:
                    self._last_output_connected = connected
                    if connected:
                        message = "HDMI output reconnected"
                        severity = "info"
                    else:
                        message = "HDMI output disconnected"
                        severity = "error"
                        self.soak.note_fault(message)
                    session = self.current_session_id()
                    self.store.record_event(
                        "output_connection", message, severity=severity,
                        session_id=session, state={"connected": connected},
                    )
                    await self.hub.publish(
                        "fault" if not connected else "recovery",
                        {"message": message, "connected": connected},
                    )
                await asyncio.sleep(2)
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 - watcher must survive glitches
                await asyncio.sleep(5)

    def current_session_id(self) -> str | None:
        row = self.db.query_one(
            "SELECT id FROM session WHERE status = 'in_progress' AND deleted = 0"
            " ORDER BY started_at DESC LIMIT 1"
        )
        return row["id"] if row else None

    # -- capture for attempts (FR-31, AC-09) ---------------------------------
    def captured_state(self) -> dict:
        output = self.output_state()
        active = output.get("active") or {}
        mode = active.get("active_mode") or {}
        return {
            "app_version": __version__,
            "connector": active.get("connector"),
            "mode": mode.get("key"),
            "display_backend": output.get("backend"),
            "pattern": self.active_pattern,
            "captured_at": utcnow(),
        }


class SoakRunner:
    """Timed cycle through Identify, Colour, Motion, Audio (§7.3 Soak)."""

    def __init__(self, state: AppState):
        self.state_ref = state
        self.task: asyncio.Task | None = None
        self.run_id: int | None = None
        self.requested_minutes = 0
        self.started_monotonic: float = 0.0
        self.current_step = ""
        self.faults = 0

    @property
    def running(self) -> bool:
        return self.task is not None and not self.task.done()

    def state(self) -> dict:
        if not self.running:
            return {"running": False}
        # time.monotonic, not the event loop clock: state() is also called
        # from sync endpoints running in worker threads with no loop.
        elapsed = time.monotonic() - self.started_monotonic
        total = self.requested_minutes * 60
        return {
            "running": True,
            "requested_minutes": self.requested_minutes,
            "elapsed_seconds": int(elapsed),
            "remaining_seconds": max(0, int(total - elapsed)),
            "current_step": self.current_step,
            "faults": self.faults,
        }

    def note_fault(self, message: str) -> None:
        if self.running:
            self.faults += 1
            if self.run_id:
                self.state_ref.db.execute(
                    "UPDATE soak_run SET fault_count = ? WHERE id = ?",
                    (self.faults, self.run_id),
                )

    async def start(self, minutes: int) -> None:
        await self.stop(interrupted=True)
        self.requested_minutes = minutes
        self.faults = 0
        self.started_monotonic = time.monotonic()
        cursor = self.state_ref.db.execute(
            "INSERT INTO soak_run (session_id, requested_minutes) VALUES (?, ?)",
            (self.state_ref.current_session_id(), minutes),
        )
        self.run_id = int(cursor.lastrowid)
        self.task = asyncio.create_task(self._run(minutes))

    async def stop(self, interrupted: bool = False) -> None:
        if self.task and not self.task.done():
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass
            if self.run_id and interrupted:
                self._finish("interrupted")
        self.task = None

    def _finish(self, status: str) -> None:
        if self.run_id:
            self.state_ref.db.execute(
                "UPDATE soak_run SET status = ?, ended_at = ? WHERE id = ?",
                (status, utcnow(), self.run_id),
            )
            self.run_id = None

    async def _run(self, minutes: int) -> None:
        deadline = time.monotonic() + minutes * 60
        index = 0
        try:
            while time.monotonic() < deadline:
                self.current_step = SOAK_CYCLE[index % len(SOAK_CYCLE)]
                index += 1
                await self.state_ref.hub.publish(
                    "soak_step",
                    {"step": self.current_step, **self.state()},
                )
                remaining = deadline - time.monotonic()
                await asyncio.sleep(min(SOAK_STEP_SECONDS, max(0, remaining)))
            self._finish("completed")
            self.state_ref.store.record_event(
                "soak_completed",
                f"Soak completed after {minutes} minutes with {self.faults} fault(s)",
                session_id=self.state_ref.current_session_id(),
                state={"minutes": minutes, "faults": self.faults},
            )
            await self.state_ref.hub.publish("soak_complete", {"minutes": minutes, "faults": self.faults})
            # Fall back to identify at the end of a soak.
            self.state_ref.active_pattern = "identify"
            self.state_ref.active_params = {}
            await self.state_ref.hub.publish("pattern", self.state_ref.pattern_state())
        except asyncio.CancelledError:
            raise


def latest_soak(db: Database, session_id: str | None = None) -> dict | None:
    if session_id:
        row = db.query_one(
            "SELECT * FROM soak_run WHERE session_id = ? ORDER BY id DESC LIMIT 1",
            (session_id,),
        )
    else:
        row = db.query_one("SELECT * FROM soak_run ORDER BY id DESC LIMIT 1")
    return dict(row) if row else None
