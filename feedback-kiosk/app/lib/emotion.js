/** Emotion engine (client side), per-locale strategy - DESIGN.md.
 *
 * Order: bundled ONNX model (via @huggingface/transformers, local files
 * only - never the network) -> locale lexicon fallback -> 'calm'.
 * Every path is offline; a missing/failed model can never break the
 * typed journey (brief §3 recovery, §7 offline).
 */
import { LABEL_TO_FACE, EN_LEXICON } from './faces'
import { classifyWithLexicon } from './classify'
import { ES_LEXICON } from './lexicon-es'

// Bundled model per locale; paths resolve under public/models at build
// time (scripts/fetch-models.mjs). Empty = lexicon-only for that locale.
const MODEL_BY_LOCALE = {
  'en-GB': 'distilbert-emotion-en',
  'es-ES': 'sentiment-multilingual',
}

const LEXICON_BY_LOCALE = {
  'en-GB': EN_LEXICON,
  'es-ES': ES_LEXICON,
}

let pipelinePromise = null

async function loadPipeline(modelId) {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      const { pipeline, env } = await import('@huggingface/transformers')
      env.allowRemoteModels = false
      env.localModelPath = '/models/'
      return pipeline('text-classification', modelId)
    })()
  }
  return pipelinePromise
}

/** classifyText(text, locale) -> { face, confidence, engine } (never throws). */
export async function classifyText(text, locale) {
  const lexicon = LEXICON_BY_LOCALE[locale] || EN_LEXICON

  let modelResult = null
  const modelId = MODEL_BY_LOCALE[locale]
  if (modelId) {
    try {
      const clf = await withTimeout(loadPipeline(modelId), 8000)
      const out = await withTimeout(clf(text, { top_k: 3 }), 8000)
      const ranked = Array.isArray(out) ? (Array.isArray(out[0]) ? out[0] : out) : [out]
      for (const cand of ranked) {
        const face = LABEL_TO_FACE[String(cand.label || '').toLowerCase()]
        if (face) {
          modelResult = { face, confidence: cand.score ?? 0.5, engine: `model:${modelId}` }
          break
        }
      }
    } catch {
      // Model unavailable (not bundled / load failure): lexicon carries on.
      pipelinePromise = null
    }
  }

  const lexResult = classifyWithLexicon(text, lexicon)

  // A confident lexicon hit beats a weak model call (mirrors upstream's
  // merge: explicit keywords are strong signals, esp. for es-ES where
  // the model may only be sentiment-grade).
  if (lexResult && (!modelResult || lexResult.confidence >= modelResult.confidence)) {
    return { face: lexResult.face, confidence: lexResult.confidence, engine: 'lexicon' }
  }
  if (modelResult) return modelResult
  return { face: 'calm', confidence: 0.2, engine: 'default' }
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ])
}
