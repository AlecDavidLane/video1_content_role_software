"""FastAPI application factory.

Serves:
  /api/v1/*    control API (§10)
  /health      liveness/dependency health
  /kiosk/      full-screen test output page (Chromium kiosk points here)
  /            control UI (built React app), falling back to a plain
               status page when the frontend bundle is absent (dev installs)
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from . import __version__
from .config import load_config
from .state import AppState
from .api.routes import api, router

KIOSK_DIR = Path(__file__).parent / "kiosk"
STATIC_DIR = Path(__file__).parent / "static"


class NoStoreStaticFiles(StaticFiles):
    """Static files served with Cache-Control: no-store.

    The kiosk's files are unversioned (no content-hashed names), and
    without cache headers Chromium applies heuristic caching: after an
    upgrade the kiosk kept rendering the previous release's JavaScript
    - new backend screens fell back to a black holding screen. no-store
    forces a fresh copy on every kiosk (re)load; the files are tiny and
    local, so there is no cost.
    """

    def file_response(self, *args, **kwargs):
        response = super().file_response(*args, **kwargs)
        response.headers["Cache-Control"] = "no-store"
        return response


@asynccontextmanager
async def lifespan(app: FastAPI):
    state = AppState(load_config())
    app.state.appstate = state
    state.store.record_event("backend_started", f"Backend started, version {__version__}")
    startup_pattern = state.config.get("output", "startup_pattern") or "identify"
    if startup_pattern != "holding":
        try:
            await state.activate_pattern(startup_pattern)
        except ValueError:
            await state.activate_pattern("identify")
    await state.start_watcher()
    yield
    await state.stop_watcher()
    state.db.close()


def create_app() -> FastAPI:
    app = FastAPI(
        title="Transition Layer Commissioning Test Source",
        version=__version__,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )
    app.include_router(router)
    app.include_router(api)

    if KIOSK_DIR.exists():
        app.mount("/kiosk", NoStoreStaticFiles(directory=KIOSK_DIR, html=True), name="kiosk")

    if (STATIC_DIR / "index.html").exists():
        app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="ui-assets")
        index_html = (STATIC_DIR / "index.html").read_text(encoding="utf-8")

        @app.get("/{path:path}", response_class=HTMLResponse, include_in_schema=False)
        def spa(path: str):
            """SPA history fallback: real files are served, unknown paths get
            index.html so phone deep links (/patterns, /session/…) work."""
            if path == "kiosk":
                # The kiosk mount only matches /kiosk/ — send the slashless
                # form there instead of an empty control-UI shell.
                return RedirectResponse("/kiosk/")
            candidate = (STATIC_DIR / path).resolve()
            if (
                path
                and candidate.is_file()
                and candidate.is_relative_to(STATIC_DIR.resolve())
            ):
                return FileResponse(candidate)
            return HTMLResponse(index_html)

    else:

        @app.get("/", response_class=HTMLResponse)
        def placeholder() -> str:
            return (
                "<html><body style='font-family:sans-serif'>"
                "<h1>TL Commissioning Test Source</h1>"
                "<p>Control UI bundle not installed. API docs: <a href='/api/docs'>/api/docs</a>"
                " &middot; Kiosk output: <a href='/kiosk/'>/kiosk/</a></p>"
                "</body></html>"
            )

    return app


app = create_app()
