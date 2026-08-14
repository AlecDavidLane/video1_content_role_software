/** Everything the visitor UI needs in one call: sanitised config
 * (no operator secrets) + resolved locale strings. */
import { loadConfig, loadLocaleStrings } from '../../lib/config'
import pkg from '../../package.json'

export default function handler(req, res) {
  const { config, errors } = loadConfig()
  if (errors.length) {
    return res.status(503).json({ error: 'config invalid', detail: errors })
  }
  let strings
  try {
    strings = loadLocaleStrings(config.locale, config.copy_overrides)
  } catch (err) {
    return res.status(503).json({ error: `locale load failed: ${err.message}` })
  }
  res.json({
    event: config.event,
    locale: config.locale,
    branding: config.branding,
    timeouts: config.timeouts,
    privacy: { store_text: !!config.privacy.store_text },
    voice: { enabled: !!config.voice.enabled },
    strings,
    app_version: pkg.version,
    config_version: config.config_version,
  })
}
