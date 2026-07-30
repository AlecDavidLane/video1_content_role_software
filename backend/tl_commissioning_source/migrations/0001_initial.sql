-- Initial schema. Entities per brief §9.

CREATE TABLE appliance (
    id            TEXT PRIMARY KEY,
    friendly_name TEXT NOT NULL,
    source_number INTEGER NOT NULL DEFAULT 1,
    hostname      TEXT NOT NULL DEFAULT '',
    role_version  TEXT NOT NULL DEFAULT '',
    branding_json TEXT NOT NULL DEFAULT '{}',
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE project (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    name             TEXT NOT NULL,
    client           TEXT NOT NULL DEFAULT '',
    site             TEXT NOT NULL DEFAULT '',
    default_engineer TEXT NOT NULL DEFAULT '',
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE session (
    id               TEXT PRIMARY KEY,          -- human-readable ref, e.g. TL-20260730-001
    project_id       INTEGER NOT NULL REFERENCES project(id),
    room             TEXT NOT NULL DEFAULT '',
    engineer         TEXT NOT NULL DEFAULT '',
    signal_path_text TEXT NOT NULL DEFAULT '',
    endpoints_json   TEXT NOT NULL DEFAULT '{}',
    selected_tests_json TEXT NOT NULL DEFAULT '[]',
    soak_minutes     INTEGER NOT NULL DEFAULT 0,
    status           TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','in_progress','review','completed_passed','completed_failed')),
    deleted          INTEGER NOT NULL DEFAULT 0,
    started_at       TEXT,
    completed_at     TEXT,
    reopened_at      TEXT,
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE test_definition (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    key                 TEXT NOT NULL UNIQUE,
    name                TEXT NOT NULL,
    instruction         TEXT NOT NULL,
    expected_result     TEXT NOT NULL,
    pattern_key         TEXT NOT NULL,
    required_by_default INTEGER NOT NULL DEFAULT 1,
    sequence            INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE test_attempt (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id     TEXT NOT NULL REFERENCES session(id),
    test_key       TEXT NOT NULL,
    attempt_number INTEGER NOT NULL,
    result         TEXT NOT NULL CHECK (result IN ('pass','fail')),
    note           TEXT NOT NULL DEFAULT '',
    engineer       TEXT NOT NULL DEFAULT '',
    fault_category TEXT NOT NULL DEFAULT '',
    started_at     TEXT,
    answered_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    captured_system_state_json TEXT NOT NULL DEFAULT '{}',
    UNIQUE (session_id, test_key, attempt_number)
);

CREATE TABLE evidence (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    attempt_id      INTEGER NOT NULL REFERENCES test_attempt(id),
    original_path   TEXT NOT NULL,
    derivative_path TEXT NOT NULL DEFAULT '',
    caption         TEXT NOT NULL DEFAULT '',
    mime_type       TEXT NOT NULL,
    sha256          TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE system_event (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT REFERENCES session(id),
    severity   TEXT NOT NULL DEFAULT 'info'
        CHECK (severity IN ('info','warning','error')),
    event_type TEXT NOT NULL,
    message    TEXT NOT NULL,
    state_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE report (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id   TEXT NOT NULL REFERENCES session(id),
    revision     INTEGER NOT NULL DEFAULT 1,
    pdf_path     TEXT NOT NULL,
    json_path    TEXT NOT NULL,
    json_sha256  TEXT NOT NULL,
    generated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    UNIQUE (session_id, revision)
);

CREATE TABLE auth_token (
    token      TEXT PRIMARY KEY,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE soak_run (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id      TEXT REFERENCES session(id),
    requested_minutes INTEGER NOT NULL,
    started_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    ended_at        TEXT,
    status          TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running','completed','interrupted')),
    fault_count     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_attempt_session ON test_attempt(session_id, test_key);
CREATE INDEX idx_event_session ON system_event(session_id);
CREATE INDEX idx_session_status ON session(status);

-- Default guided checklist: one step per pattern (§7.3).
INSERT INTO test_definition (key, name, instruction, expected_result, pattern_key, required_by_default, sequence) VALUES
 ('identify',  'Identify',  'Confirm the destination shows this source identity, live clock and incrementing frame counter.', 'Correct source number and name are visible; clock and frame counter are moving; resolution shown matches the required mode.', 'identify', 1, 10),
 ('alignment', 'Alignment', 'Check the border reaches every edge and the geometry references are undistorted.', 'Full border visible with no cropping or overscan; centre cross centred; circle round; safe-area guides visible.', 'alignment', 1, 20),
 ('colour',    'Colour',    'Check colour bars, primaries, grayscale ramp and black/white level areas.', 'All bars and blocks show the expected colours with no missing channel; grayscale steps are distinct; no gross clipping.', 'colour', 1, 30),
 ('motion',    'Motion',    'Watch the moving elements, clock and frame counter for several seconds.', 'Motion is smooth with no freeze, obvious judder or dropped/duplicated frames.', 'motion', 1, 40),
 ('audio',     'Audio',     'Listen for the left then right channel identification and tone.', 'Left announcement is heard on the left channel only, right on the right; tone is audible.', 'audio', 1, 50),
 ('mode',      'Mode',      'Confirm the destination reports or displays the required resolution and refresh rate.', 'Destination accepts and reports the selected mode; image is stable.', 'mode', 1, 60),
 ('soak',      'Soak',      'Run the timed soak sequence for the selected duration.', 'The route remains operational for the full soak duration with no faults recorded.', 'soak', 0, 70);
