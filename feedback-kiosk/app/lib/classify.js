// Deterministic keyword classification — the no-model fallback path.
// Adapted from the upstream Feedback Artist page's lexiconBuckets():
// the same padded-space word matching, generalised so the lexicon is
// data ({ face: [terms...] } in any language) instead of hardcoded
// English, and normalisation is case- and diacritics-insensitive
// (so "ENFADADO" matches "enfadado", "está" matches "esta", etc.).

// Normalise for matching: lowercase, strip combining diacritics,
// unify curly apostrophes, and collapse anything that is not a letter
// or apostrophe into single spaces. \p{L} keeps letters of any script,
// where the upstream regex only kept [a-z].
function normalizeForMatch(str) {
  return String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritical marks
    .replace(/[\u2019\u02bc\u2032]/g, "'") // curly/modifier apostrophes → straight
    .toLowerCase()
    .replace(/[^\p{L}' ]+/gu, ' ')
    .replace(/ +/g, ' ')
    .trim()
}

// Count whole-word (and multi-word phrase) lexicon hits per face.
// Upstream matched " word " or " word'" against the padded text so a
// term only hits on word boundaries; phrases like "can't believe" or
// "hacked off" work the same way.
export function lexiconBuckets(text, lexicon) {
  const t = ' ' + normalizeForMatch(text) + ' '
  const hits = {}
  for (const [bucket, words] of Object.entries(lexicon || {})) {
    for (const raw of words) {
      const w = normalizeForMatch(raw)
      if (!w) continue
      if (t.includes(' ' + w + ' ') || t.includes(' ' + w + "'")) {
        hits[bucket] = (hits[bucket] || 0) + 1
      }
    }
  }
  return hits
}

// Classify text with a keyword lexicon alone (no ML model).
//   text: visitor's words.
//   lexicon: { face: [terms...] } — e.g. EN_LEXICON from lib/faces, or a
//            per-locale lexicon loaded from config/translations.
// Returns { face, confidence, source: 'lexicon' } or null when no term
// matched. Confidence is the winning face's share of all lexicon hits
// (the same "winning bucket's share of total emotion mass" formula the
// upstream page used), capped at 0.99.
export function classifyWithLexicon(text, lexicon) {
  if (!text || !lexicon) return null
  const buckets = lexiconBuckets(text, lexicon)
  let face = null
  let best = 0
  let total = 0
  for (const [k, v] of Object.entries(buckets)) {
    total += v
    if (v > best) {
      best = v
      face = k
    }
  }
  if (!face || total <= 0) return null
  return { face, confidence: Math.min(0.99, best / total), source: 'lexicon' }
}
