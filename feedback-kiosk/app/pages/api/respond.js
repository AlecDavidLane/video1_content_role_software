/** Record a completed interaction (brief §6). The browser does the
 * classification (bundled model/lexicon) and posts the outcome; this
 * endpoint owns persistence and the privacy mode. */
import { loadConfig } from '../../lib/config'
import { recordResponse } from '../../lib/db'
import pkg from '../../package.json'

const FACES = new Set(['joy', 'calm', 'sad', 'angry', 'surprised'])

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const { config, errors } = loadConfig()
  if (errors.length) return res.status(503).json({ error: 'config invalid' })

  const { text, emotion, confidence, engine, input_method: inputMethod } = req.body || {}
  if (!FACES.has(emotion)) return res.status(422).json({ error: 'unknown emotion' })
  if (typeof text !== 'string' || !text.trim()) {
    return res.status(422).json({ error: 'text required' })
  }

  const id = recordResponse({
    eventId: config.event.id,
    profile: config.config_version,
    locale: config.locale,
    inputMethod: inputMethod === 'voice' ? 'voice' : 'typed',
    responseText: text.trim().slice(0, 2000),
    emotion,
    confidence: typeof confidence === 'number' ? confidence : null,
    engine: typeof engine === 'string' ? engine.slice(0, 80) : null,
    appVersion: pkg.version,
    configVersion: config.config_version,
    storeText: !!config.privacy.store_text,
  })
  res.json({ response_id: id })
}
