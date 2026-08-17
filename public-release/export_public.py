#!/usr/bin/env python3
"""Build a clean public-release tree from the private role repository.

The exporter is intentionally allow-list based. Nothing leaves the private
repository unless it is named in public-release/manifest.txt.
"""

from __future__ import annotations

import argparse
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "public-release" / "manifest.txt"
PUBLIC_README = ROOT / "public-release" / "README.md"

FORBIDDEN_PATH_PARTS = {
    "ansible",
    ".env",
    ".venv",
    "__pycache__",
    ".pytest_cache",
    "node_modules",
    ".git",
    "secrets",
    "secret",
    "vault",
}

FORBIDDEN_TEXT = [
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(r"\bansible_password\b", re.IGNORECASE),
    re.compile(r"\bansible_become_password\b", re.IGNORECASE),
    re.compile(r"\bvault_password\b", re.IGNORECASE),
    re.compile(r"\bgithub_pat_[A-Za-z0-9_]+"),
    re.compile(r"\bghp_[A-Za-z0-9]+"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
]

TEXT_SUFFIXES = {
    ".py", ".ts", ".tsx", ".js", ".json", ".html", ".css", ".md",
    ".txt", ".yaml", ".yml", ".toml", ".sh", ".service", ".sql",
    ".webmanifest", ".avcdriver",
}


def allowed_paths() -> list[Path]:
    paths: list[Path] = []
    for raw in MANIFEST.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        path = (ROOT / line).resolve()
        if ROOT not in path.parents and path != ROOT:
            raise RuntimeError(f"Manifest path escapes repository: {line}")
        if not path.exists():
            raise RuntimeError(f"Manifest path does not exist: {line}")
        paths.append(path)
    return paths


def clear_destination(destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    for child in destination.iterdir():
        if child.name == ".git":
            continue
        if child.is_dir() and not child.is_symlink():
            shutil.rmtree(child)
        else:
            child.unlink()


def copy_allowed(destination: Path) -> None:
    for source in allowed_paths():
        relative = source.relative_to(ROOT)
        target = destination / relative
        if source.is_dir():
            shutil.copytree(
                source,
                target,
                dirs_exist_ok=True,
                ignore=shutil.ignore_patterns(
                    ".git", ".env", ".env.*", ".venv", "node_modules",
                    "__pycache__", ".pytest_cache", "*.pyc",
                ),
            )
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)

    # Public README is deliberately different from the private role README.
    shutil.copy2(PUBLIC_README, destination / "README.md")


def safety_scan(destination: Path) -> None:
    failures: list[str] = []

    for path in destination.rglob("*"):
        relative = path.relative_to(destination)
        lower_parts = {part.lower() for part in relative.parts}

        if lower_parts & FORBIDDEN_PATH_PARTS:
            failures.append(f"Forbidden path: {relative}")
            continue

        if not path.is_file():
            continue

        if path.name.startswith(".env"):
            failures.append(f"Environment file present: {relative}")
            continue

        if path.suffix.lower() in {".pem", ".key", ".p12", ".pfx"}:
            failures.append(f"Potential credential file: {relative}")
            continue

        if path.suffix.lower() not in TEXT_SUFFIXES and path.name not in {"LICENSE", ".gitignore"}:
            continue

        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue

        for pattern in FORBIDDEN_TEXT:
            if pattern.search(text):
                failures.append(f"Sensitive pattern in {relative}: {pattern.pattern}")

    if (destination / "ansible").exists():
        failures.append("ansible/ directory present")

    if failures:
        raise RuntimeError("Public-release safety scan failed:\n- " + "\n- ".join(failures))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("destination", type=Path, help="Directory to populate")
    args = parser.parse_args()

    destination = args.destination.resolve()
    clear_destination(destination)
    copy_allowed(destination)
    safety_scan(destination)

    file_count = sum(1 for path in destination.rglob("*") if path.is_file())
    print(f"Public export ready: {destination} ({file_count} files)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
