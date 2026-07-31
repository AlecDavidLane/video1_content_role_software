"""Audio sink enumeration and selection via PulseAudio/PipeWire pactl
(FR-15). Mock backend for development and tests."""

from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass


@dataclass
class AudioSink:
    name: str
    description: str
    is_default: bool

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "description": self.description,
            "is_default": self.is_default,
            "is_hdmi": "hdmi" in self.name.lower() or "hdmi" in self.description.lower(),
        }


class AudioBackend:
    kind = "unknown"

    def list_sinks(self) -> list[AudioSink]:  # pragma: no cover - interface
        raise NotImplementedError

    def set_default_sink(self, name: str) -> None:  # pragma: no cover
        raise NotImplementedError


class PactlBackend(AudioBackend):
    kind = "pactl"

    def list_sinks(self) -> list[AudioSink]:
        default = subprocess.run(
            ["pactl", "get-default-sink"], capture_output=True, text=True, timeout=10
        ).stdout.strip()
        result = subprocess.run(
            ["pactl", "list", "short", "sinks"],
            capture_output=True, text=True, timeout=10, check=True,
        )
        sinks = []
        for line in result.stdout.splitlines():
            parts = line.split("\t")
            if len(parts) >= 2:
                name = parts[1]
                sinks.append(AudioSink(name=name, description=name, is_default=name == default))
        return sinks

    def set_default_sink(self, name: str) -> None:
        subprocess.run(
            ["pactl", "set-default-sink", name],
            capture_output=True, text=True, timeout=10, check=True,
        )


class MockAudioBackend(AudioBackend):
    kind = "mock"

    def __init__(self) -> None:
        self.sinks = [
            AudioSink("alsa_output.pci-0000_00_1f.3.hdmi-stereo", "HDMI / DisplayPort", True),
            AudioSink("alsa_output.pci-0000_00_1f.3.analog-stereo", "Built-in Analog", False),
        ]

    def list_sinks(self) -> list[AudioSink]:
        return list(self.sinks)

    def set_default_sink(self, name: str) -> None:
        if name not in {s.name for s in self.sinks}:
            raise RuntimeError(f"Unknown audio sink: {name}")
        for sink in self.sinks:
            sink.is_default = sink.name == name


class AutoAudioBackend(AudioBackend):
    """Prefers real pactl, falling back to mock — re-probing on every call
    so a session audio server that starts later is picked up, and `kind`
    always reflects the backend that answered last."""

    def __init__(self) -> None:
        self._pactl = PactlBackend()
        self._mock = MockAudioBackend()
        self.kind = "mock"

    def list_sinks(self) -> list[AudioSink]:
        if shutil.which("pactl"):
            try:
                sinks = self._pactl.list_sinks()
                if sinks:
                    self.kind = "pactl"
                    return sinks
            except Exception:
                pass
        self.kind = "mock"
        return self._mock.list_sinks()

    def set_default_sink(self, name: str) -> None:
        if self.kind == "pactl":
            self._pactl.set_default_sink(name)
        else:
            self._mock.set_default_sink(name)


def make_audio_backend(kind: str = "auto") -> AudioBackend:
    if kind == "mock":
        return MockAudioBackend()
    if kind == "pactl":
        return PactlBackend()
    return AutoAudioBackend()
