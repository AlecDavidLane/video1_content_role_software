import os
from pathlib import Path

import pytest


@pytest.fixture()
def workdir(tmp_path: Path, monkeypatch) -> Path:
    config_path = tmp_path / "config.yaml"
    config_path.write_text(
        f"""
storage:
  data_dir: {tmp_path}/data
  reports_dir: {tmp_path}/reports
  evidence_dir: {tmp_path}/evidence
hardware:
  display_backend: mock
  audio_backend: mock
report:
  chromium_path: "{os.environ.get('TEST_CHROMIUM', '')}"
server:
  bind_host: 127.0.0.1
  port: 8907
"""
    )
    monkeypatch.setenv("TL_SOURCE_CONFIG", str(config_path))
    return tmp_path


@pytest.fixture()
def appstate(workdir):
    from tl_commissioning_source.config import load_config
    from tl_commissioning_source.state import AppState

    state = AppState(load_config())
    yield state
    state.db.close()


@pytest.fixture()
def store(appstate):
    return appstate.store


@pytest.fixture()
def client(workdir):
    from fastapi.testclient import TestClient

    from tl_commissioning_source.main import create_app

    with TestClient(create_app()) as test_client:
        yield test_client


def make_session(store, tests=None, **overrides):
    project_id = store.upsert_project("Proj", "Client", "Site", "Eng")
    defaults = dict(
        project_id=project_id,
        room="Room 1",
        engineer="Eng",
        signal_path_text="src -> dst",
        selected_tests=tests or ["identify", "colour"],
    )
    defaults.update(overrides)
    return store.create_session(**defaults)
