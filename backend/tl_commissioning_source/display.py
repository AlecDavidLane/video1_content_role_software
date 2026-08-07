"""Display output detection and mode control (§7.4).

Backed by xrandr on the appliance (Xorg session, per the brief's v1
recommendation). A mock backend keeps the application fully functional in
development, tests and CI where no display server exists. Only modes
advertised by the OS/EDID may be selected (FR-12).
"""

from __future__ import annotations

import re
import shutil
import subprocess
from dataclasses import dataclass, field


@dataclass
class DisplayMode:
    width: int
    height: int
    refresh: float

    @property
    def key(self) -> str:
        refresh = f"{self.refresh:.2f}".rstrip("0").rstrip(".")
        return f"{self.width}x{self.height}@{refresh}"

    def to_dict(self) -> dict:
        return {
            "width": self.width,
            "height": self.height,
            "refresh": self.refresh,
            "key": self.key,
        }


@dataclass
class Output:
    connector: str
    connected: bool
    active_mode: DisplayMode | None
    modes: list[DisplayMode] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "connector": self.connector,
            "connected": self.connected,
            "active_mode": self.active_mode.to_dict() if self.active_mode else None,
            "modes": [m.to_dict() for m in self.modes],
        }


QUICK_MODES = [
    "1280x720@50", "1280x720@60",
    "1920x1080@50", "1920x1080@60",
    "3840x2160@50", "3840x2160@60",
]


class DisplayBackend:
    kind = "unknown"

    def list_outputs(self) -> list[Output]:  # pragma: no cover - interface
        raise NotImplementedError

    def set_mode(self, connector: str, mode: DisplayMode) -> None:  # pragma: no cover
        raise NotImplementedError

    def find_mode(self, connector: str, mode_key: str) -> DisplayMode | None:
        for output in self.list_outputs():
            if output.connector != connector:
                continue
            for mode in output.modes:
                if _mode_matches(mode, mode_key):
                    return mode
        return None


def _mode_matches(mode: DisplayMode, key: str) -> bool:
    try:
        res, refresh = key.split("@")
        width, height = res.split("x")
        return (
            mode.width == int(width)
            and mode.height == int(height)
            and abs(mode.refresh - float(refresh)) < 0.5
        )
    except ValueError:
        return False


class XrandrBackend(DisplayBackend):
    """Parses `xrandr --query`. Mode setting uses --mode/--rate only, so the
    selected timing is always one the driver advertised (FR-12)."""

    kind = "xrandr"

    _OUTPUT_RE = re.compile(r"^(\S+) (connected|disconnected)")
    _MODE_RE = re.compile(r"^\s+(\d+)x(\d+)i?\s+(.*)$")
    _RATE_RE = re.compile(r"(\d+\.\d+)(\*?)(\+?)")

    def _query(self) -> str:
        # --current reads the X server's cached state. Plain --query forces
        # a hardware EDID re-probe, which visibly hitches the video output
        # on some GPU/monitor combinations - and this runs every ~2 s from
        # the disconnect watcher. Hotplug detection is unaffected: the X
        # server updates its state from kernel events on its own.
        return subprocess.run(
            ["xrandr", "--current"], capture_output=True, text=True, timeout=10, check=True
        ).stdout

    def list_outputs(self) -> list[Output]:
        outputs: list[Output] = []
        current: Output | None = None
        for line in self._query().splitlines():
            header = self._OUTPUT_RE.match(line)
            if header:
                current = Output(
                    connector=header.group(1),
                    connected=header.group(2) == "connected",
                    active_mode=None,
                )
                outputs.append(current)
                continue
            if current is None:
                continue
            mode_match = self._MODE_RE.match(line)
            if mode_match:
                width, height = int(mode_match.group(1)), int(mode_match.group(2))
                for rate_match in self._RATE_RE.finditer(mode_match.group(3)):
                    mode = DisplayMode(width, height, float(rate_match.group(1)))
                    current.modes.append(mode)
                    if rate_match.group(2) == "*":
                        current.active_mode = mode
        return outputs

    def set_mode(self, connector: str, mode: DisplayMode) -> None:
        subprocess.run(
            [
                "xrandr", "--output", connector,
                "--mode", f"{mode.width}x{mode.height}",
                "--rate", f"{mode.refresh:g}",
            ],
            capture_output=True, text=True, timeout=15, check=True,
        )


class MockDisplayBackend(DisplayBackend):
    """Simulates one connected HDMI output with the quick-choice modes."""

    kind = "mock"

    def __init__(self) -> None:
        self.active = DisplayMode(1920, 1080, 60.0)
        self.connected = True

    def list_outputs(self) -> list[Output]:
        modes = [
            DisplayMode(1280, 720, 50.0), DisplayMode(1280, 720, 60.0),
            DisplayMode(1920, 1080, 50.0), DisplayMode(1920, 1080, 60.0),
            DisplayMode(3840, 2160, 50.0), DisplayMode(3840, 2160, 60.0),
        ]
        return [
            Output(
                connector="HDMI-1",
                connected=self.connected,
                active_mode=self.active if self.connected else None,
                modes=modes if self.connected else [],
            )
        ]

    def set_mode(self, connector: str, mode: DisplayMode) -> None:
        if not self.connected:
            raise RuntimeError("HDMI output disconnected")
        self.active = mode


class AutoDisplayBackend(DisplayBackend):
    """Prefers real xrandr, falling back to mock — re-probing on every call,
    because the X server usually starts *after* the backend service on an
    appliance. `kind` always reflects the backend that answered last, so
    health and status can never present simulated hardware as real."""

    def __init__(self) -> None:
        self._xrandr = XrandrBackend()
        self._mock = MockDisplayBackend()
        self.kind = "mock"

    def _real_available(self) -> bool:
        return shutil.which("xrandr") is not None

    def list_outputs(self) -> list[Output]:
        if self._real_available():
            try:
                outputs = self._xrandr.list_outputs()
                self.kind = "xrandr"
                return outputs
            except Exception:
                pass
        self.kind = "mock"
        return self._mock.list_outputs()

    def set_mode(self, connector: str, mode: DisplayMode) -> None:
        if self.kind == "xrandr":
            self._xrandr.set_mode(connector, mode)
        else:
            self._mock.set_mode(connector, mode)


def make_display_backend(kind: str = "auto") -> DisplayBackend:
    if kind == "mock":
        return MockDisplayBackend()
    if kind == "xrandr":
        return XrandrBackend()
    return AutoDisplayBackend()
