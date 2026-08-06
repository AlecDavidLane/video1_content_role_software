"""Pattern registry (§7.3).

The backend owns which pattern is active and its parameters; the kiosk
page renders it. Pattern keys are stable API identifiers (§10).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

HOLDING = "holding"  # black holding screen (FR-07); not user-selectable

# End-of-session screen: "get your report" QR + "select another signal
# path". Activated automatically when a report is generated; a system
# screen like HOLDING, not a selectable test pattern.
REPORT_READY = "report"


@dataclass(frozen=True)
class PatternDef:
    key: str
    name: str
    description: str
    parameters: dict[str, Any] = field(default_factory=dict)


PATTERNS: dict[str, PatternDef] = {
    p.key: p
    for p in [
        PatternDef(
            "identify",
            "Identify",
            "Large source number/name, appliance ID, current mode, moving border, clock and frame counter.",
        ),
        PatternDef(
            "alignment",
            "Alignment",
            "Edge border, centre cross, grid, 16:9 circle and 5%/10% safe-area guides.",
            {"grid_divisions": {"type": "integer", "default": 8, "min": 4, "max": 16}},
        ),
        PatternDef(
            "colour",
            "Colour",
            "Reference colour bars, primary/secondary blocks, grayscale ramp and black/white level areas.",
        ),
        PatternDef(
            "motion",
            "Motion",
            "Smooth horizontal/vertical movement, rotating element, seconds clock and frame counter.",
            {"speed": {"type": "number", "default": 1.0, "min": 0.25, "max": 4.0}},
        ),
        PatternDef(
            "audio",
            "Audio",
            "Left then right spoken identification with visible tone activity. Stereo only in MVP.",
            {"tone_hz": {"type": "integer", "default": 1000, "min": 100, "max": 10000}},
        ),
        PatternDef(
            "mode",
            "Mode",
            "Selected resolution and refresh shown prominently with live motion.",
        ),
        PatternDef(
            "soak",
            "Soak",
            "Automatic timed cycle through Identify, Colour, Motion and Audio with elapsed/remaining time.",
            {"minutes": {"type": "integer", "default": 30, "min": 1, "max": 1440}},
        ),
    ]
}

SOAK_CYCLE = ["identify", "colour", "motion", "audio"]
SOAK_STEP_SECONDS = 30


def validate_params(key: str, params: dict[str, Any]) -> dict[str, Any]:
    """Return validated params for a pattern, raising ValueError on junk."""
    definition = PATTERNS.get(key)
    if definition is None:
        raise ValueError(f"Unknown pattern: {key}")
    clean: dict[str, Any] = {}
    for name, spec in definition.parameters.items():
        if name not in params:
            clean[name] = spec["default"]
            continue
        value = params[name]
        if spec["type"] == "integer":
            if not isinstance(value, int) or isinstance(value, bool):
                raise ValueError(f"Parameter {name} must be an integer")
        elif spec["type"] == "number":
            if not isinstance(value, (int, float)) or isinstance(value, bool):
                raise ValueError(f"Parameter {name} must be a number")
        if not (spec["min"] <= value <= spec["max"]):
            raise ValueError(
                f"Parameter {name} must be between {spec['min']} and {spec['max']}"
            )
        clean[name] = value
    unknown = set(params) - set(definition.parameters)
    if unknown:
        raise ValueError(f"Unknown parameters: {', '.join(sorted(unknown))}")
    return clean
