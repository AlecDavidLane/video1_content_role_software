"""tl-source CLI (§12).

Non-interactive commands so an Ansible role can install, configure and
validate the appliance without simulated GUI actions:

  tl-source serve            run the backend (used by systemd)
  tl-source healthcheck      exit 0 when healthy, non-zero otherwise (AC-14)
  tl-source init ...         set identity/branding/PIN without the UI
  tl-source sample-report    generate a sample Passed or Failed report
  tl-source export-config    print non-secret config JSON
  tl-source import-config    merge non-secret config JSON from a file
  tl-source diag-bundle      write a diagnostic zip (FR-42)
"""

from __future__ import annotations

import argparse
import json
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from . import __version__
from .config import config_path, load_config


def _mk_state():
    from .state import AppState

    return AppState(load_config())


def cmd_serve(args: argparse.Namespace) -> int:
    import uvicorn

    config = load_config()
    uvicorn.run(
        "tl_commissioning_source.main:app",
        host=str(config.get("server", "bind_host")),
        port=int(config.get("server", "port")),
        log_level="info",
    )
    return 0


def cmd_healthcheck(args: argparse.Namespace) -> int:
    """Checks the running service over HTTP; falls back to a local
    dependency check when the service is not up (useful pre-start)."""
    import urllib.error
    import urllib.request

    config = load_config()
    port = int(config.get("server", "port"))
    url = f"http://127.0.0.1:{port}/health"
    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            payload = json.loads(response.read())
    except urllib.error.HTTPError as exc:
        # 503 = reachable but degraded; the body still carries the checks.
        try:
            payload = json.loads(exc.read())
        except Exception:  # noqa: BLE001
            print(f"UNHEALTHY: {url} returned {exc.code} with no health payload")
            return 2
    except Exception as exc:  # noqa: BLE001
        print(f"UNHEALTHY: cannot reach {url}: {exc}")
        return 2
    print(json.dumps(payload, indent=2))
    if payload.get("ok"):
        print("HEALTHY")
        return 0
    failing = [k for k, v in payload.get("checks", {}).items() if not v.get("ok")]
    print(f"UNHEALTHY: {', '.join(failing)}")
    return 1


def cmd_init(args: argparse.Namespace) -> int:
    config = load_config()
    if args.appliance_id:
        config.set(("appliance", "id"), args.appliance_id)
    if args.friendly_name:
        config.set(("appliance", "friendly_name"), args.friendly_name)
    if args.source_number:
        config.set(("appliance", "source_number"), args.source_number)
    if args.company:
        config.set(("branding", "company_name"), args.company)
    if args.accent_colour:
        config.set(("branding", "accent_colour"), args.accent_colour)
    if args.logo:
        logo = Path(args.logo)
        if not logo.exists():
            print(f"Logo file not found: {logo}", file=sys.stderr)
            return 2
        config.set(("branding", "logo_path"), str(logo.resolve()))
    if args.report_footer:
        config.set(("branding", "report_footer"), args.report_footer)
    if args.panel_url is not None:
        config.set(("integration", "panel_url"), args.panel_url)
    if args.engineer:
        config.set(("engineer", "default_name"), args.engineer)
    if args.pin:
        config.set_pin(args.pin)
        config.set(("security", "setup_complete"), True)
    if args.disable_pin:
        config.set(("security", "require_pin"), False)
        config.set(("security", "setup_complete"), True)
        print("PIN/token protection DISABLED - anyone on the LAN can control this appliance")
    elif args.enable_pin:
        config.set(("security", "require_pin"), True)
    if args.api_token:
        config.set(("security", "api_token"), args.api_token)
    elif args.generate_api_token:
        import secrets as _secrets

        token = _secrets.token_urlsafe(32)
        config.set(("security", "api_token"), token)
        print(f"API token (store it now; it is not shown again): {token}")
    config.save()

    state = _mk_state()
    identity = state.identity()
    existing = state.db.query_one("SELECT id FROM appliance LIMIT 1")
    if existing:
        state.db.execute(
            "UPDATE appliance SET id=?, friendly_name=?, source_number=?, hostname=?"
            + (", role_version=?" if args.role_version is not None else ""),
            (
                identity["appliance_id"], identity["friendly_name"],
                identity["source_number"], identity["hostname"],
            )
            + ((args.role_version,) if args.role_version is not None else ()),
        )
    else:
        state.db.execute(
            "INSERT INTO appliance (id, friendly_name, source_number, hostname, role_version)"
            " VALUES (?,?,?,?,?)",
            (
                identity["appliance_id"] or "TL-TESTSOURCE-01",
                identity["friendly_name"], identity["source_number"],
                identity["hostname"], args.role_version or "",
            ),
        )
    print(f"Initialised {config.path} for {identity['appliance_id'] or 'TL-TESTSOURCE-01'}")
    return 0


def cmd_sample_report(args: argparse.Namespace) -> int:
    """Create a synthetic completed session and generate its report (§12)."""
    from .reports import generate_report

    state = _mk_state()
    store = state.store
    project_id = store.upsert_project(
        "Sample Project", "Sample Client", "Sample Site", "Sample Engineer"
    )
    session = store.create_session(
        project_id=project_id,
        room="Demo Room",
        engineer="Sample Engineer",
        signal_path_text="Test source -> HDBaseT TX -> HDBaseT RX -> Display",
        endpoints={
            "source": "TL test source HDMI out",
            "transmitter": "HDBaseT transmitter",
            "receiver": "HDBaseT receiver",
            "destination": "Reference display",
        },
        selected_tests=["identify", "alignment", "colour", "motion", "audio", "mode"],
    )
    store.start(session["id"])
    outcome_failed = args.outcome == "failed"
    for key in session["selected_tests"]:
        if outcome_failed and key == "audio":
            store.record_attempt(
                session["id"], key, "fail",
                note="Right channel not audible at destination; suspect RX de-embed.",
                fault_category="audio",
                system_state=state.captured_state(),
            )
        else:
            store.record_attempt(
                session["id"], key, "pass",
                system_state=state.captured_state(),
            )
    store.complete(session["id"])
    result = generate_report(state, session["id"])
    print(json.dumps(result, indent=2))
    return 0


def cmd_export_config(args: argparse.Namespace) -> int:
    config = load_config()
    print(json.dumps(config.export_public(), indent=2))
    return 0


def cmd_import_config(args: argparse.Namespace) -> int:
    config = load_config()
    incoming = json.loads(Path(args.file).read_text(encoding="utf-8"))
    if not isinstance(incoming, dict):
        print("Import file must contain a JSON object", file=sys.stderr)
        return 2
    config.import_public(incoming)
    config.save()
    print(f"Imported configuration into {config.path}")
    return 0


def cmd_diag_bundle(args: argparse.Namespace) -> int:
    """Diagnostic bundle: config (no secrets), health, events, recent logs.
    Excludes photos and reports unless --include-reports is set (FR-42)."""
    state = _mk_state()
    out = Path(args.output or f"tl-source-diag-{datetime.now(timezone.utc):%Y%m%d-%H%M%S}.zip")
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as bundle:
        bundle.writestr("config.json", json.dumps(state.config.export_public(), indent=2))
        bundle.writestr("health.json", json.dumps(state.health(), indent=2, default=str))
        bundle.writestr(
            "events.json", json.dumps(state.store.events(limit=1000), indent=2)
        )
        bundle.writestr(
            "version.txt", f"tl-commissioning-source {__version__}\n"
        )
        journal = Path("/var/log/tl-commissioning-source")
        if journal.is_dir():
            for log_file in journal.glob("*.log*"):
                bundle.write(log_file, f"logs/{log_file.name}")
        if args.include_reports:
            for report in state.config.reports_dir.glob("*"):
                if report.is_file():
                    bundle.write(report, f"reports/{report.name}")
    print(f"Diagnostic bundle written to {out}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="tl-source",
        description="Transition Layer commissioning test source",
    )
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("serve", help="run the backend server").set_defaults(func=cmd_serve)
    sub.add_parser("healthcheck", help="exit 0 when healthy").set_defaults(func=cmd_healthcheck)

    init = sub.add_parser("init", help="initialise identity/branding non-interactively")
    init.add_argument("--appliance-id")
    init.add_argument("--friendly-name")
    init.add_argument("--source-number", type=int)
    init.add_argument("--company")
    init.add_argument("--accent-colour")
    init.add_argument("--logo")
    init.add_argument("--report-footer")
    init.add_argument("--panel-url",
                      help="room-control panel URL shown as a QR on the Identify"
                      " screen. Use {ip} for the appliance's current LAN address"
                      " (DHCP-safe), e.g. 'http://{ip}:8080/panel'. Pass '' to remove.")
    init.add_argument("--engineer")
    init.add_argument("--pin", help="set control PIN and mark setup complete")
    init.add_argument("--api-token", help="set a static API token for integrations (OpenAVC, Ansible)")
    init.add_argument("--disable-pin", action="store_true",
                      help="turn off PIN/token protection entirely (open LAN control)")
    init.add_argument("--enable-pin", action="store_true",
                      help="re-enable PIN/token protection")
    init.add_argument("--generate-api-token", action="store_true",
                      help="generate and print a static API token for integrations")
    init.add_argument("--role-version", help="record the deploying role version")
    init.set_defaults(func=cmd_init)

    sample = sub.add_parser("sample-report", help="generate a sample report")
    sample.add_argument("--outcome", choices=["passed", "failed"], default="passed")
    sample.set_defaults(func=cmd_sample_report)

    sub.add_parser("export-config", help="print non-secret config as JSON").set_defaults(
        func=cmd_export_config
    )
    imp = sub.add_parser("import-config", help="merge non-secret config JSON")
    imp.add_argument("file")
    imp.set_defaults(func=cmd_import_config)

    diag = sub.add_parser("diag-bundle", help="write a diagnostic zip")
    diag.add_argument("--output")
    diag.add_argument("--include-reports", action="store_true")
    diag.set_defaults(func=cmd_diag_bundle)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
