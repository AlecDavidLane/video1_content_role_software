"""Unit tests: config secrets, xrandr parsing, pattern params, evidence."""

import io

import pytest
from PIL import Image

from tl_commissioning_source.config import Config, load_config
from tl_commissioning_source.display import XrandrBackend
from tl_commissioning_source.evidence import EvidenceError, sniff_type, store_photo
from tl_commissioning_source.patterns import validate_params


# -- config ------------------------------------------------------------------
def test_pin_hash_and_check(workdir):
    config = load_config()
    config.set_pin("2468")
    assert config.check_pin("2468")
    assert not config.check_pin("0000")
    with pytest.raises(ValueError):
        config.set_pin("12")


def test_export_excludes_secrets_and_import_ignores_them(workdir):
    config = load_config()
    config.set_pin("2468")
    exported = config.export_public()
    assert "pin_hash" not in exported["security"]
    config.import_public({"security": {"pin_hash": "evil"}, "server": {"port": 9999}})
    assert config.check_pin("2468")
    assert config.get("server", "port") == 9999


def test_config_roundtrip(workdir, tmp_path):
    config = load_config()
    config.set(("appliance", "id"), "TL-X-9")
    config.save()
    reloaded = load_config()
    assert reloaded.get("appliance", "id") == "TL-X-9"


# -- xrandr parsing ------------------------------------------------------------
XRANDR_SAMPLE = """\
Screen 0: minimum 320 x 200, current 1920 x 1080, maximum 16384 x 16384
HDMI-1 connected primary 1920x1080+0+0 (normal left inverted) 527mm x 296mm
   3840x2160     60.00 +  50.00    30.00
   1920x1080     60.00*   50.00    59.94
   1280x720      60.00    50.00
DP-1 disconnected (normal left inverted right x axis y axis)
"""


def test_xrandr_parse(monkeypatch):
    backend = XrandrBackend()
    monkeypatch.setattr(backend, "_query", lambda: XRANDR_SAMPLE)
    outputs = backend.list_outputs()
    assert len(outputs) == 2
    hdmi = outputs[0]
    assert hdmi.connector == "HDMI-1"
    assert hdmi.connected
    assert hdmi.active_mode.key == "1920x1080@60"
    keys = {m.key for m in hdmi.modes}
    assert "3840x2160@60" in keys and "1280x720@50" in keys
    assert not outputs[1].connected
    # FR-12: only advertised modes are findable
    assert backend.find_mode("HDMI-1", "2560x1440@60") is None
    assert backend.find_mode("HDMI-1", "3840x2160@50").width == 3840


# -- pattern params ------------------------------------------------------------
def test_pattern_param_validation():
    assert validate_params("motion", {})["speed"] == 1.0
    assert validate_params("motion", {"speed": 2})["speed"] == 2
    with pytest.raises(ValueError):
        validate_params("motion", {"speed": 100})
    with pytest.raises(ValueError):
        validate_params("motion", {"bogus": 1})
    with pytest.raises(ValueError):
        validate_params("nope", {})


# -- evidence -------------------------------------------------------------------
def _png(size=(1200, 900)):
    buffer = io.BytesIO()
    Image.new("RGB", size, "#aa5533").save(buffer, "PNG")
    return buffer.getvalue()


def test_sniff_rejects_non_images():
    with pytest.raises(EvidenceError):
        sniff_type(b"<script>alert(1)</script>", "image/png")
    assert sniff_type(_png(), "image/png") == "image/png"


def test_store_photo_creates_derivative_and_checksums(tmp_path):
    stored = store_photo(
        _png((3000, 2000)), "image/png", tmp_path, "TL-1", 5, 25 * 1024 * 1024
    )
    from pathlib import Path

    original = Path(stored["original_path"])
    derivative = Path(stored["derivative_path"])
    assert original.exists() and derivative.exists()
    with Image.open(derivative) as image:
        assert max(image.size) <= 1600
    assert len(stored["sha256"]) == 64


def test_store_photo_size_limit(tmp_path):
    with pytest.raises(EvidenceError, match="limit"):
        store_photo(_png(), "image/png", tmp_path, "TL-1", 1, max_bytes=100)
