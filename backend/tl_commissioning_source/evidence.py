"""Evidence capture: photo upload, validation and derivatives (§7.7).

Originals are kept untouched; a report-sized JPEG derivative is generated
for embedding (FR-28). Uploads are validated for type and size (AC-13).
HEIC converts when pillow-heif is present, otherwise a clear
supported-format message is returned (FR-27).
"""

from __future__ import annotations

import hashlib
import io
import re
from pathlib import Path

from PIL import Image

try:  # optional HEIC support
    import pillow_heif

    pillow_heif.register_heif_opener()
    HEIC_SUPPORTED = True
except ImportError:  # pragma: no cover - depends on optional extra
    HEIC_SUPPORTED = False

ALLOWED_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/heic": ".heic",
    "image/heif": ".heic",
}
DERIVATIVE_MAX_EDGE = 1600
DERIVATIVE_QUALITY = 82

_MAGIC = {
    b"\xff\xd8\xff": "image/jpeg",
    b"\x89PNG\r\n\x1a\n": "image/png",
}


class EvidenceError(Exception):
    pass


def sniff_type(data: bytes, declared: str) -> str:
    """Verify content matches an allowed image type; don't trust headers alone."""
    for magic, mime in _MAGIC.items():
        if data.startswith(magic):
            return mime
    # HEIC/HEIF: ISO-BMFF 'ftyp' box with heic/heix/mif1 brands
    if len(data) > 12 and data[4:8] == b"ftyp" and data[8:12] in (
        b"heic", b"heix", b"mif1", b"msf1", b"heim", b"heis",
    ):
        return "image/heic"
    raise EvidenceError(
        "Unsupported file content. Supported photo formats: JPEG, PNG"
        + (", HEIC" if HEIC_SUPPORTED else " (HEIC is not supported on this appliance)")
        + f". Declared type was {declared or 'unknown'}."
    )


def store_photo(
    data: bytes,
    declared_mime: str,
    evidence_dir: Path,
    session_id: str,
    attempt_id: int,
    max_bytes: int,
) -> dict:
    if len(data) == 0:
        raise EvidenceError("Uploaded file is empty")
    if len(data) > max_bytes:
        raise EvidenceError(
            f"Photo is {len(data) // (1024 * 1024)} MB; the limit is"
            f" {max_bytes // (1024 * 1024)} MB"
        )
    mime = sniff_type(data, declared_mime)
    if mime in ("image/heic", "image/heif") and not HEIC_SUPPORTED:
        raise EvidenceError(
            "HEIC photos are not supported on this appliance."
            " Please upload JPEG or PNG, or change the phone camera format."
        )
    safe_session = re.sub(r"[^A-Za-z0-9_-]", "_", session_id)
    target_dir = evidence_dir / safe_session
    target_dir.mkdir(parents=True, exist_ok=True)

    digest = hashlib.sha256(data).hexdigest()
    ext = ALLOWED_TYPES[mime]
    original = target_dir / f"attempt{attempt_id}_{digest[:12]}{ext}"
    original.write_bytes(data)

    derivative = target_dir / f"attempt{attempt_id}_{digest[:12]}_report.jpg"
    try:
        with Image.open(io.BytesIO(data)) as img:
            img = img.convert("RGB")
            img.thumbnail((DERIVATIVE_MAX_EDGE, DERIVATIVE_MAX_EDGE))
            img.save(derivative, "JPEG", quality=DERIVATIVE_QUALITY)
    except Exception as exc:  # noqa: BLE001
        original.unlink(missing_ok=True)
        raise EvidenceError(f"Image could not be decoded: {exc}") from exc

    return {
        "original_path": str(original),
        "derivative_path": str(derivative),
        "mime_type": mime,
        "sha256": digest,
    }
