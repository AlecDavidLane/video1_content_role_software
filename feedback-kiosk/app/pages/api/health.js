/** Deployment gate (brief §8): the Ansible role only flips the
 * `current` symlink when this reports ok. */
import fs from 'node:fs'
import { loadConfig } from '../../lib/config'
import { getDb, stats } from '../../lib/db'
import pkg from '../../package.json'

export default function handler(req, res) {
  const { config, errors, path: configPath } = loadConfig()
  const checks = {}
  checks.config = errors.length
    ? { ok: false, detail: errors.join('; ') }
    : { ok: true, detail: `${configPath} (event ${config.event.id}, ${config.locale})` }

  try {
    getDb().prepare('SELECT 1').get()
    checks.database = { ok: true, detail: config.storage.db_path }
  } catch (err) {
    checks.database = { ok: false, detail: String(err.message) }
  }

  // Model files are bundled at build time; presence = readiness.
  const modelsDir = `${process.cwd()}/public/models`
  checks.model = fs.existsSync(modelsDir) && fs.readdirSync(modelsDir).length > 0
    ? { ok: true, detail: 'bundled models present' }
    : { ok: false, detail: `no bundled models under ${modelsDir}` }

  let storageStats = null
  try {
    storageStats = stats()
  } catch { /* covered by database check */ }

  const ok = Object.values(checks).every((c) => c.ok)
  res.status(ok ? 200 : 503).json({
    ok,
    checks,
    app_version: pkg.version,
    config_version: config.config_version,
    event_id: config.event.id,
    locale: config.locale,
    responses: storageStats,
  })
}
