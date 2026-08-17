/** Event configuration (server side).
 *
 * The kiosk loads a single validated JSON file at startup (brief §4):
 * FEEDBACK_KIOSK_CONFIG (default /etc/feedback-kiosk/config.json).
 * Invalid config = refuse to serve visitors: the API reports the error
 * and the UI shows the operator-facing failure card, never a broken
 * visitor journey.
 */
import fs from 'node:fs'
import path from 'node:path'

const CONFIG_PATH =
  process.env.FEEDBACK_KIOSK_CONFIG || '/etc/feedback-kiosk/config.json'

const DEFAULTS = {
  event: { id: 'dev', name: 'Feedback Artist', subtitle: '', venue: '' },
  locale: 'en-GB',
  branding: {
    logo: '/transition-layer-logo.png',
    background: '',
    accent: '#00d4aa',
    sponsor_mark: '',
    credits_on_public_screen: false,
  },
  copy_overrides: {},
  // Visitor input: 'rating' = five big buttons straight onto the five
  // artworks (1..5 -> angry,sad,surprised,calm,joy); 'text' = typed
  // feedback with emotion classification. Labels are per-profile: stars
  // ("★") or wording steps (likelihood scales etc.).
  input: {
    mode: 'rating',
    rating: {
      style: 'stars', // stars | labels
      labels: ['1', '2', '3', '4', '5'],
      faces: ['angry', 'sad', 'surprised', 'calm', 'joy'],
    },
  },
  timeouts: { idle_seconds: 90, result_seconds: 25, input_seconds: 120 },
  privacy: { store_text: true },
  voice: { enabled: false },
  operator: { pin_hash: '', pin_salt: '' },
  storage: { db_path: '/var/lib/feedback-kiosk/feedback.db' },
  config_version: 'dev',
}

const REQUIRED_STRINGS = [
  ['event', 'id'],
  ['event', 'name'],
  ['locale'],
]

function deepMerge(base, over) {
  const out = { ...base }
  for (const [k, v] of Object.entries(over || {})) {
    out[k] =
      v && typeof v === 'object' && !Array.isArray(v) && typeof base[k] === 'object'
        ? deepMerge(base[k], v)
        : v
  }
  return out
}

let cached = null

export function loadConfig() {
  if (cached) return cached
  let raw = {}
  const errors = []
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
    } catch (err) {
      errors.push(`config parse error: ${err.message}`)
    }
  } else if (process.env.NODE_ENV === 'production') {
    errors.push(`config file missing: ${CONFIG_PATH}`)
  }
  const config = deepMerge(DEFAULTS, raw)
  for (const keys of REQUIRED_STRINGS) {
    let node = config
    for (const k of keys) node = node?.[k]
    if (!node || typeof node !== 'string') {
      errors.push(`missing required config value: ${keys.join('.')}`)
    }
  }
  if (!['en-GB', 'es-ES', 'pt-BR'].includes(config.locale)) {
    errors.push(`unsupported locale: ${config.locale}`)
  }
  if (!['rating', 'text'].includes(config.input.mode)) {
    errors.push(`unsupported input.mode: ${config.input.mode}`)
  }
  cached = { config, errors, path: CONFIG_PATH }
  return cached
}

export function loadLocaleStrings(locale, copyOverrides = {}) {
  const file = path.join(process.cwd(), 'locales', `${locale}.json`)
  const strings = JSON.parse(fs.readFileSync(file, 'utf-8'))
  return { ...strings, ...copyOverrides }
}
