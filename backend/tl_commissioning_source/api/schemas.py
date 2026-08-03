"""Pydantic request/response models for /api/v1 (§10)."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, field_validator


class TokenRequest(BaseModel):
    pin: str = Field(min_length=1, max_length=128)


class PatternActivate(BaseModel):
    params: dict[str, Any] = Field(default_factory=dict)


class OutputModeRequest(BaseModel):
    connector: str = Field(min_length=1, max_length=64)
    mode: str = Field(pattern=r"^\d+x\d+@[\d.]+$")


class AudioSinkRequest(BaseModel):
    sink: str = Field(min_length=1, max_length=256)


class Endpoints(BaseModel):
    source: str = ""
    transmitter: str = ""
    network: str = ""
    receiver: str = ""
    destination: str = ""


class SessionCreate(BaseModel):
    project_name: str = Field(min_length=1, max_length=200)
    client: str = Field(default="", max_length=200)
    site: str = Field(default="", max_length=200)
    room: str = Field(default="", max_length=200)
    engineer: str = Field(default="", max_length=200)
    signal_path_text: str = Field(default="", max_length=4000)
    endpoints: Endpoints = Field(default_factory=Endpoints)
    selected_tests: list[str] | None = None
    soak_minutes: int = Field(default=0, ge=0, le=1440)
    # Create and start in one call — for panel/automation clients that
    # can't hold a draft open (OpenAVC macros, scripted flows).
    autostart: bool = False


class SessionUpdate(BaseModel):
    room: str | None = None
    engineer: str | None = None
    signal_path_text: str | None = None
    endpoints: Endpoints | None = None
    selected_tests: list[str] | None = None
    soak_minutes: int | None = Field(default=None, ge=0, le=1440)


class AttemptCreate(BaseModel):
    result: str
    note: str = Field(default="", max_length=4000)
    engineer: str = Field(default="", max_length=200)
    fault_category: str = Field(default="", max_length=100)
    started_at: str | None = None

    @field_validator("result")
    @classmethod
    def _result(cls, value: str) -> str:
        if value not in ("pass", "fail"):
            raise ValueError("result must be 'pass' or 'fail'")
        return value


class ReopenRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=1000)


class CaptionUpdate(BaseModel):
    caption: str = Field(default="", max_length=500)


class SetupRequest(BaseModel):
    company_name: str = Field(min_length=1, max_length=200)
    accent_colour: str = Field(default="#0E7C66", pattern=r"^#[0-9a-fA-F]{6}$")
    default_engineer: str = Field(default="", max_length=200)
    appliance_id: str = Field(default="", max_length=64)
    friendly_name: str = Field(default="", max_length=200)
    source_number: int = Field(default=1, ge=1, le=999)
    report_footer: str = Field(default="", max_length=500)
    pin: str = Field(min_length=4, max_length=128)


class BrandingUpdate(BaseModel):
    company_name: str | None = Field(default=None, max_length=200)
    accent_colour: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    report_footer: str | None = Field(default=None, max_length=500)
