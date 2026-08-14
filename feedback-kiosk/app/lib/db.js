/** Persistent feedback store (brief §6).
 *
 * SQLite outside the release directory so updates and rollbacks can
 * never erase collected feedback. response_text is stored only when
 * the active privacy mode allows it.
 */
import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { loadConfig } from './config'

let db = null

export function getDb() {
  if (db) return db
  const { config } = loadConfig()
  const dbPath =
    process.env.FEEDBACK_KIOSK_DB || config.storage.db_path
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS response (
      response_id    TEXT PRIMARY KEY,
      ts_local       TEXT NOT NULL,
      ts_utc         TEXT NOT NULL,
      event_id       TEXT NOT NULL,
      profile        TEXT NOT NULL,
      locale         TEXT NOT NULL,
      input_method   TEXT NOT NULL,
      response_text  TEXT,
      emotion        TEXT NOT NULL,
      confidence     REAL,
      engine         TEXT,
      app_version    TEXT NOT NULL,
      config_version TEXT NOT NULL
    );
  `)
  return db
}

export function recordResponse({
  eventId, profile, locale, inputMethod, responseText,
  emotion, confidence, engine, appVersion, configVersion, storeText,
}) {
  const now = new Date()
  const row = {
    response_id: crypto.randomUUID(),
    ts_local: now.toLocaleString('sv-SE'), // ISO-like local time
    ts_utc: now.toISOString(),
    event_id: eventId,
    profile,
    locale,
    input_method: inputMethod,
    response_text: storeText ? responseText : null,
    emotion,
    confidence: confidence ?? null,
    engine: engine ?? null,
    app_version: appVersion,
    config_version: configVersion,
  }
  getDb()
    .prepare(
      `INSERT INTO response (response_id, ts_local, ts_utc, event_id, profile,
        locale, input_method, response_text, emotion, confidence, engine,
        app_version, config_version)
       VALUES (@response_id, @ts_local, @ts_utc, @event_id, @profile, @locale,
        @input_method, @response_text, @emotion, @confidence, @engine,
        @app_version, @config_version)`
    )
    .run(row)
  return row.response_id
}

export function stats() {
  const d = getDb()
  const total = d.prepare('SELECT COUNT(*) AS n FROM response').get().n
  const byEmotion = d
    .prepare('SELECT emotion, COUNT(*) AS n FROM response GROUP BY emotion')
    .all()
  const last = d
    .prepare('SELECT ts_utc, emotion FROM response ORDER BY ts_utc DESC LIMIT 1')
    .get()
  return { total, by_emotion: byEmotion, last_response: last || null }
}

export function allResponses() {
  return getDb().prepare('SELECT * FROM response ORDER BY ts_utc').all()
}

export function clearResponses() {
  getDb().prepare('DELETE FROM response').run()
}
