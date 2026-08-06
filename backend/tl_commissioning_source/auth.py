"""PIN/token protection for state-changing calls (§10, NFR-09, AC-13).

Flow: POST /api/v1/auth/token with the control PIN returns a short-lived
bearer token stored in SQLite. Until first-run setup is complete
(security.setup_complete = false) state-changing calls are open so the
appliance can be configured; after that they require a valid token.
"""

from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, Request

from .db import Database


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _fmt(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def issue_token(db: Database, ttl_seconds: int) -> dict:
    token = secrets.token_urlsafe(32)
    expires = _now() + timedelta(seconds=ttl_seconds)
    db.execute(
        "INSERT INTO auth_token (token, expires_at) VALUES (?, ?)",
        (token, _fmt(expires)),
    )
    # Opportunistic cleanup of expired tokens.
    db.execute("DELETE FROM auth_token WHERE expires_at < ?", (_fmt(_now()),))
    return {"token": token, "expires_at": _fmt(expires)}


def token_valid(db: Database, token: str) -> bool:
    row = db.query_one(
        "SELECT token FROM auth_token WHERE token = ? AND expires_at >= ?",
        (token, _fmt(_now())),
    )
    return row is not None


def require_control(request: Request) -> None:
    """FastAPI dependency guarding state-changing endpoints."""
    state = request.app.state.appstate
    if not state.config.setup_complete:
        return  # first-run: allow configuration without a token
    if state.config.get("security", "require_pin", default=True) is False:
        return  # operator opted out of PIN protection (config: security.require_pin)
    header = request.headers.get("authorization", "")
    token = header.removeprefix("Bearer ").strip()
    if not token:
        token = request.query_params.get("token", "")
    if not token:
        raise HTTPException(
            status_code=401,
            detail="Control token required. Obtain one with the control PIN at /api/v1/auth/token.",
        )
    # A provisioned static API token (integrations: OpenAVC, Ansible) is
    # accepted alongside PIN-issued short-lived tokens.
    api_token = state.config.get("security", "api_token") or ""
    if api_token and secrets.compare_digest(token, api_token):
        return
    if not token_valid(state.db, token):
        raise HTTPException(
            status_code=401,
            detail="Control token required. Obtain one with the control PIN at /api/v1/auth/token.",
        )


ControlRequired = Depends(require_control)
