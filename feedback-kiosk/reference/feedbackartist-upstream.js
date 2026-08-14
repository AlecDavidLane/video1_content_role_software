import Head from 'next/head'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

// ————————————————————————————————————————————————————————————————
// 5 spray-face identities. Colour and face agree: the model's labels
// collapse into these buckets and the robot sprays the matching face.
// ————————————————————————————————————————————————————————————————
const FACES = {
  joy:       { display: 'joy',       chip: '#FFC94A', drip: 0.08, palette: ['#FFD54A', '#FFC107', '#FFB300', '#FFE082'] },
  calm:      { display: 'calm',      chip: '#7FD8BE', drip: 0.05, palette: ['#7FD8BE', '#4DB6AC', '#80CBC4', '#A8E6CF'] },
  sad:       { display: 'sad',       chip: '#64B5F6', drip: 0.5,  palette: ['#5885AF', '#64B5F6', '#4A7BA6', '#90CAF9'] },
  angry:     { display: 'angry',     chip: '#FF6B6B', drip: 0.12, palette: ['#FF3B30', '#E53935', '#FF6B6B', '#C62828'] },
  surprised: { display: 'surprised', chip: '#E040FB', drip: 0.08, palette: ['#B388FF', '#E040FB', '#FF4DA6', '#CE93D8'] },
}

// Model label → face bucket. Covers go_emotions (28 labels), the
// 6-emotion distilbert model, and the SST-2 binary fallback.
const LABEL_TO_FACE = {
  // joy bucket
  joy: 'joy', happiness: 'joy', amusement: 'joy', excitement: 'joy',
  optimism: 'joy', pride: 'joy', admiration: 'joy', gratitude: 'joy',
  desire: 'joy', positive: 'joy',
  // calm bucket
  love: 'calm', caring: 'calm', relief: 'calm', approval: 'calm',
  neutral: 'calm',
  // sad bucket
  sadness: 'sad', disappointment: 'sad', grief: 'sad', remorse: 'sad',
  embarrassment: 'sad', negative: 'sad',
  // angry bucket
  anger: 'angry', annoyance: 'angry', disgust: 'angry', disapproval: 'angry',
  // surprised bucket
  surprise: 'surprised', fear: 'surprised', nervousness: 'surprised',
  confusion: 'surprised', curiosity: 'surprised', realization: 'surprised',
}

// ——— Stroke geometry in face space: x,y in [-1, 1], y positive = down.
function arcPts(cx, cy, rx, ry, a0, a1, n = 26) {
  const pts = []
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)])
  }
  return pts
}

function linePts(x1, y1, x2, y2, n = 16) {
  const pts = []
  for (let i = 0; i <= n; i++) {
    pts.push([x1 + ((x2 - x1) * i) / n, y1 + ((y2 - y1) * i) / n])
  }
  return pts
}

// A tight inward spiral — sprays up as a solid filled dot/blob
function blobPts(cx, cy, r) {
  const pts = []
  const n = 30
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * 3 * 2 * Math.PI
    const rr = r * (1 - i / (n * 1.15))
    pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)])
  }
  return pts
}

const PI = Math.PI

// Each face is a fixed design: a set of strokes the robot draws in
// order. g = draw group (eyes → mouth → extra), w = stroke weight,
// density < 1 = lighter fill passes.
const FACE_STROKES = {
  joy: [
    { g: 'eyes', pts: arcPts(-0.42, -0.3, 0.16, 0.13, PI, 2 * PI) },          // happy arced eyes (∩)
    { g: 'eyes', pts: arcPts(0.42, -0.3, 0.16, 0.13, PI, 2 * PI) },
    { g: 'mouth', pts: linePts(-0.5, 0.14, 0.5, 0.14) },                       // big open grin (D shape)
    { g: 'mouth', pts: arcPts(0, 0.14, 0.5, 0.44, 0, PI) },
    { g: 'mouth', pts: arcPts(0, 0.14, 0.36, 0.3, 0, PI), density: 0.55 },     // grin fill
    { g: 'mouth', pts: arcPts(0, 0.14, 0.2, 0.16, 0, PI), density: 0.55 },
    { g: 'extra', pts: linePts(-0.78, -0.72, -0.78, -0.52), w: 0.7 },          // sparkles
    { g: 'extra', pts: linePts(-0.88, -0.62, -0.68, -0.62), w: 0.7 },
    { g: 'extra', pts: linePts(0.66, -0.74, 0.82, -0.58), w: 0.7 },
    { g: 'extra', pts: linePts(0.82, -0.74, 0.66, -0.58), w: 0.7 },
  ],
  calm: [
    { g: 'eyes', pts: arcPts(-0.4, -0.34, 0.15, 0.08, 0, PI) },                // relaxed closed lids (‿)
    { g: 'eyes', pts: arcPts(0.4, -0.34, 0.15, 0.08, 0, PI) },
    { g: 'mouth', pts: arcPts(0, 0.28, 0.36, 0.17, 0, PI) },                   // gentle closed smile
    { g: 'extra', pts: blobPts(-0.64, 0.02, 0.06), density: 0.5, w: 0.9 },     // soft blush
    { g: 'extra', pts: blobPts(0.64, 0.02, 0.06), density: 0.5, w: 0.9 },
  ],
  sad: [
    { g: 'eyes', pts: linePts(-0.6, -0.5, -0.26, -0.6), w: 0.9 },              // brows raised at centre
    { g: 'eyes', pts: linePts(0.26, -0.6, 0.6, -0.5), w: 0.9 },
    { g: 'eyes', pts: blobPts(-0.4, -0.3, 0.075) },                            // drooping round eyes
    { g: 'eyes', pts: blobPts(0.4, -0.3, 0.075) },
    { g: 'mouth', pts: arcPts(0, 0.56, 0.38, 0.22, PI, 2 * PI) },              // downturned frown
    { g: 'extra', pts: blobPts(-0.42, -0.1, 0.05), w: 0.8 },                   // droplet under the eye
    { g: 'extra', pts: linePts(-0.42, -0.06, -0.42, 0.24), w: 0.7 },
  ],
  angry: [
    { g: 'eyes', pts: linePts(-0.62, -0.58, -0.22, -0.42), w: 0.9 },           // furrowed angled brows
    { g: 'eyes', pts: linePts(0.22, -0.42, 0.62, -0.58), w: 0.9 },
    { g: 'eyes', pts: blobPts(-0.4, -0.24, 0.07) },
    { g: 'eyes', pts: blobPts(0.4, -0.24, 0.07) },
    { g: 'mouth', pts: linePts(-0.34, 0.46, 0.34, 0.46) },                     // hard flat mouth
    { g: 'extra', pts: linePts(0.64, -0.8, 0.8, -0.64), w: 0.8 },              // anger mark
    { g: 'extra', pts: linePts(0.8, -0.8, 0.64, -0.64), w: 0.8 },
  ],
  surprised: [
    { g: 'eyes', pts: arcPts(-0.4, -0.62, 0.16, 0.07, PI, 2 * PI), w: 0.9 },   // raised brows
    { g: 'eyes', pts: arcPts(0.4, -0.62, 0.16, 0.07, PI, 2 * PI), w: 0.9 },
    { g: 'eyes', pts: arcPts(-0.4, -0.28, 0.15, 0.15, 0, 2 * PI) },            // wide round eyes
    { g: 'eyes', pts: arcPts(0.4, -0.28, 0.15, 0.15, 0, 2 * PI) },
    { g: 'eyes', pts: blobPts(-0.4, -0.28, 0.05), density: 0.6 },
    { g: 'eyes', pts: blobPts(0.4, -0.28, 0.05), density: 0.6 },
    { g: 'mouth', pts: arcPts(0, 0.44, 0.14, 0.17, 0, 2 * PI) },               // small O mouth
    { g: 'mouth', pts: blobPts(0, 0.44, 0.07), density: 0.5 },
    { g: 'extra', pts: linePts(0, -0.98, 0, -0.82), w: 0.7 },                  // startled dashes
    { g: 'extra', pts: linePts(-0.26, -0.94, -0.2, -0.79), w: 0.7 },
    { g: 'extra', pts: linePts(0.26, -0.94, 0.2, -0.79), w: 0.7 },
  ],
}

// Tried in order until one loads. The first entries are multi-emotion
// go_emotions conversions; SST-2 is the guaranteed-to-exist binary
// fallback (its telltale is everything reading as joy/sad).
const MODEL_CHAIN = [
  'SamLowe/roberta-base-go_emotions-onnx',
  'onnx-community/roberta-base-go_emotions-ONNX',
  'Xenova/roberta-base-go_emotions',
  'Xenova/distilbert-base-uncased-emotion',
  'Xenova/distilbert-base-uncased-finetuned-sst-2-english',
]
const BINARY_FALLBACK = 'Xenova/distilbert-base-uncased-finetuned-sst-2-english'

// Deterministic first pass: if the visitor names the feeling outright,
// that always wins — every face stays reachable even if only the
// binary fallback model could load.
const LEXICON = {
  joy: ['happy', 'great', 'fantastic', 'wonderful', 'joy', 'joyful', 'excited', 'thrilled', 'brilliant', 'awesome', 'delighted', 'ecstatic', 'buzzing', 'cheerful', 'glad', 'good', 'lovely', 'stoked', 'chuffed'],
  calm: ['calm', 'relaxed', 'chilled', 'chill', 'peaceful', 'content', 'fine', 'okay', 'alright', 'mellow', 'serene', 'comfortable', 'cosy', 'rested', 'love', 'loved', 'loving'],
  sad: ['sad', 'unhappy', 'down', 'depressed', 'miserable', 'terrible', 'awful', 'tired', 'exhausted', 'gutted', 'heartbroken', 'lonely', 'upset', 'crying', 'hurt', 'disappointed', 'hopeless', 'drained', 'rubbish', 'blue'],
  angry: ['angry', 'furious', 'mad', 'annoyed', 'irritated', 'frustrated', 'livid', 'cross', 'raging', 'fuming', 'outraged', 'seething', 'hate', 'hacked off', 'pissed'],
  surprised: ['surprised', 'shocked', 'amazed', 'amazing', 'astonished', 'stunned', 'wow', 'whoa', 'unbelievable', 'unexpected', 'startled', 'incredible', "can't believe", 'scared', 'terrified', 'afraid', 'frightened', 'anxious', 'nervous', 'worried'],
}

function lexiconBuckets(text) {
  const t = ' ' + text.toLowerCase().replace(/[^a-z' ]+/g, ' ') + ' '
  const hits = {}
  for (const [bucket, words] of Object.entries(LEXICON)) {
    for (const w of words) {
      if (t.includes(' ' + w + ' ') || t.includes(' ' + w + "'")) {
        hits[bucket] = (hits[bucket] || 0) + 1
      }
    }
  }
  return hits
}
// v4 runtime — bundles a current ONNX runtime; the old v2 runtime
// silently failed to instantiate models converted with newer tooling.
const TRANSFORMERS_CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0'

// Clear the wall between visitors. Flip to false (and keep pushing to
// sessionArtworks) to build an accumulating mural instead.
const CLEAR_WALL_BETWEEN_SESSIONS = true

// Robot choreography positions, as % of stage width.
const ROBOT_HOME_X = 5
const WALL_LEFT_PCT = 34
const WALL_RIGHT_PCT = 94

// ————————————————————————————————————————————————————————————————
// Seeded randomness so one emotion never paints the same way twice,
// but stays inside its own envelope.
// ————————————————————————————————————————————————————————————————
function hashString(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const gauss = (rng) => (rng() + rng() + rng()) / 1.5 - 1 // ~[-1,1], centre-weighted

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export default function ArtGenerator() {
  // idle | listening | thinking | walking | painting | returning | done
  const [phase, setPhase] = useState('idle')
  const [modelState, setModelState] = useState('loading') // loading | ready | error
  const [modelProgress, setModelProgress] = useState(0)
  const [modelName, setModelName] = useState('')
  const [modelAttempt, setModelAttempt] = useState(null) // { index, total }
  const [modelFailures, setModelFailures] = useState([])
  const [speechSupported, setSpeechSupported] = useState(true)
  const [transcript, setTranscript] = useState('')
  const [liveTranscript, setLiveTranscript] = useState('')
  const [typed, setTyped] = useState('')
  const [emotionKey, setEmotionKey] = useState(null)
  const [emotionLabel, setEmotionLabel] = useState('')
  const [confidence, setConfidence] = useState(0)
  const [notice, setNotice] = useState('')
  const [robotX, setRobotX] = useState(ROBOT_HOME_X)
  const [facing, setFacing] = useState(1) // 1 = right, -1 = left
  const [aimDeg, setAimDeg] = useState(0) // spray-arm angle while painting
  const [shaking, setShaking] = useState(false) // rattling the can

  const phaseRef = useRef('idle')
  phaseRef.current = phase
  const stageRef = useRef(null)
  const wallRef = useRef(null)
  const canvasRef = useRef(null)
  const robotRef = useRef(null)
  const recognitionRef = useRef(null)
  const runIdRef = useRef(0)
  const finalTranscriptRef = useRef('')
  const sessionArtworksRef = useRef([]) // in-memory only; groundwork for a future persistent mural
  const artImagesRef = useRef({})

  // Pre-baked artwork per emotion; starts downloading the moment the
  // emotion is known so it's usually ready by the time the robot
  // reaches the wall. Falls back to stroke-painting if it isn't.
  function loadArtwork(key) {
    if (artImagesRef.current[key]) return artImagesRef.current[key]
    const entry = { img: new Image(), ready: false }
    entry.promise = new Promise((res) => {
      entry.img.onload = () => { entry.ready = true; res(true) }
      entry.img.onerror = () => res(false)
    })
    entry.img.src = `/art/${key}.webp`
    artImagesRef.current[key] = entry
    return entry
  }

  // ——— Load Transformers.js + the emotion model from the CDN.
  // Injected as a real <script type="module"> so the bundler never sees it.
  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) setSpeechSupported(false)

    const onProgress = (e) => {
      const d = e.detail
      if (d && d.status === 'progress' && typeof d.progress === 'number' && String(d.file || '').endsWith('.onnx')) {
        setModelProgress(Math.min(99, Math.round(d.progress)))
      }
    }
    const onAttempt = (e) => {
      setModelProgress(0) // fresh bar per candidate so retries are visible
      setModelAttempt(e.detail || null)
    }
    const onReady = () => {
      setModelProgress(100)
      setModelName(window.__vdArtModel || '')
      setModelFailures(window.__vdArtModelFailures || [])
      setModelState('ready')
    }
    const onError = () => setModelState('error')

    window.addEventListener('vd-model-progress', onProgress)
    window.addEventListener('vd-model-attempt', onAttempt)
    window.addEventListener('vd-model-ready', onReady)
    window.addEventListener('vd-model-error', onError)

    if (window.__vdClassify) {
      onReady()
    } else if (!window.__vdArtBoot) {
      window.__vdArtBoot = true
      const s = document.createElement('script')
      s.type = 'module'
      s.textContent = `
        try {
          const { pipeline, env } = await import('${TRANSFORMERS_CDN}');
          if (env && 'allowLocalModels' in env) env.allowLocalModels = false;
          const progress = (p) => window.dispatchEvent(new CustomEvent('vd-model-progress', { detail: p }));
          const chain = ${JSON.stringify(MODEL_CHAIN)};
          const failures = [];
          let clf = null;
          for (let i = 0; i < chain.length; i++) {
            const model = chain[i];
            window.dispatchEvent(new CustomEvent('vd-model-attempt', { detail: { model, index: i + 1, total: chain.length } }));
            try {
              clf = await pipeline('text-classification', model, { progress_callback: progress });
              window.__vdArtModel = model;
              break;
            } catch (e) {
              console.warn('Emotion model failed, trying next:', model, e);
              failures.push(model.split('/')[1] + ': ' + String((e && e.message) || e).slice(0, 120));
            }
          }
          window.__vdArtModelFailures = failures;
          if (!clf) throw new Error('No emotion model could be loaded');
          window.__vdClassify = (text) => clf(text, { top_k: 30, topk: 30 });
          window.dispatchEvent(new CustomEvent('vd-model-ready'));
        } catch (err) {
          console.error('Art brain failed to load:', err);
          window.dispatchEvent(new CustomEvent('vd-model-error', { detail: String(err) }));
        }
      `
      document.body.appendChild(s)
    }

    return () => {
      window.removeEventListener('vd-model-progress', onProgress)
      window.removeEventListener('vd-model-attempt', onAttempt)
      window.removeEventListener('vd-model-ready', onReady)
      window.removeEventListener('vd-model-error', onError)
      runIdRef.current++
      try { recognitionRef.current && recognitionRef.current.abort() } catch {}
    }
  }, [])

  // ——— Canvas sizing (device-pixel aware, sized to the wall panel)
  function prepareCanvas() {
    const canvas = canvasRef.current
    const wall = wallRef.current
    if (!canvas || !wall) return null
    const rect = wall.getBoundingClientRect()
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.round(rect.width * dpr)
    canvas.height = Math.round(rect.height * dpr)
    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    return { ctx, width: rect.width, height: rect.height }
  }

  function clearWall() {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
  }

  // ——— Session setup shared by voice and text input
  function beginSession() {
    runIdRef.current++
    if (CLEAR_WALL_BETWEEN_SESSIONS) clearWall()
    setTranscript('')
    setLiveTranscript('')
    setEmotionKey(null)
    setEmotionLabel('')
    setConfidence(0)
    setNotice('')
    setRobotX(ROBOT_HOME_X)
    setFacing(1)
    finalTranscriptRef.current = ''
  }

  // ——— Typed input (works even in keyword-only mode when the model failed)
  function handleTextSubmit(e) {
    e.preventDefault()
    if (modelState === 'loading') return
    if (phase !== 'idle' && phase !== 'done') return
    const text = typed.trim()
    if (!text) return
    beginSession()
    setTyped('')
    setTranscript(text)
    setPhase('thinking')
    classifyAndPaint(text)
  }

  // ——— Speech capture
  function startListening() {
    if (phase !== 'idle' && phase !== 'done') return
    if (modelState === 'loading') return

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) { setSpeechSupported(false); return }

    beginSession()

    const rec = new SR()
    recognitionRef.current = rec
    rec.lang = 'en-GB'
    rec.interimResults = true
    rec.continuous = false
    rec.maxAlternatives = 1

    rec.onresult = (e) => {
      let interim = ''
      let final = ''
      for (let i = 0; i < e.results.length; i++) {
        const chunk = e.results[i][0].transcript
        if (e.results[i].isFinal) final += chunk
        else interim += chunk
      }
      if (final) finalTranscriptRef.current = final.trim()
      setLiveTranscript((final + ' ' + interim).trim())
    }

    rec.onerror = (e) => {
      recognitionRef.current = null
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setNotice('Microphone access was blocked. Allow the mic in your browser bar, then try again.')
      } else if (e.error === 'no-speech') {
        setNotice("Didn't catch anything — give it another go and speak up a little.")
      } else if (e.error !== 'aborted') {
        setNotice('Something went wrong with the microphone. Try again.')
      }
      setPhase('idle')
    }

    rec.onend = () => {
      recognitionRef.current = null
      const text = finalTranscriptRef.current
      // onend fires after onerror too — only continue if we're still listening
      if (phaseRef.current !== 'listening') return
      if (!text) {
        setNotice("Didn't catch anything — give it another go and speak up a little.")
        setPhase('idle')
        return
      }
      setPhase('thinking')
      classifyAndPaint(text)
    }

    setPhase('listening')
    try {
      rec.start()
    } catch {
      setNotice('Could not start the microphone. Try again.')
      setPhase('idle')
    }
  }

  function stopListening() {
    try { recognitionRef.current && recognitionRef.current.stop() } catch {}
  }

  // ——— Classification → choreography
  async function classifyAndPaint(text) {
    const runId = ++runIdRef.current
    setTranscript(text)
    try {
      let flat = []
      try {
        if (window.__vdClassify) {
          const results = await window.__vdClassify(text)
          flat = Array.isArray(results[0]) ? results[0] : results
        }
      } catch (err) {
        console.warn('Classifier unavailable, using keyword mode:', err)
      }
      if (runId !== runIdRef.current) return
      // Collapse the model's labels into the 5 face buckets, summing
      // scores so e.g. fear + surprise reinforce the surprised face.
      const buckets = {}
      let modelTotal = 0
      for (const r of flat) {
        const b = LABEL_TO_FACE[String(r.label || '').toLowerCase()]
        if (!b) continue
        buckets[b] = (buckets[b] || 0) + (r.score || 0)
        modelTotal += r.score || 0
      }
      // Normalise model mass to 1, then let explicit emotion words
      // outvote it — "I'm angry" must paint angry no matter the model.
      if (modelTotal > 0) {
        for (const k of Object.keys(buckets)) buckets[k] /= modelTotal
      }
      for (const [b, hits] of Object.entries(lexiconBuckets(text))) {
        buckets[b] = (buckets[b] || 0) + hits * 1.4
      }
      let key = 'calm' // neutral default when nothing signals otherwise
      let best = 0
      let total = 0
      for (const [k, v] of Object.entries(buckets)) {
        total += v
        if (v > best) { best = v; key = k }
      }
      // Confidence = the winning bucket's share of all emotion mass
      const conf = total > 0 ? Math.min(0.99, best / total) : 0.5
      setEmotionKey(key)
      setEmotionLabel(FACES[key].display)
      setConfidence(conf)
      loadArtwork(key) // start fetching the artwork while the robot reacts
      await sleep(1100) // let the robot have its "hmm" moment
      if (runId !== runIdRef.current) return
      await paintSession(key, conf, text, runId)
    } catch (err) {
      console.error('Classification failed:', err)
      if (runId !== runIdRef.current) return
      setNotice('The art brain stumbled on that one. Try saying it again.')
      setPhase('idle')
    }
  }

  // Convert a canvas x-coordinate to the robot stage position that puts
  // its spray can just left of that point.
  function robotXForCanvasX(canvasX) {
    const stage = stageRef.current
    const wall = wallRef.current
    if (!stage || !wall) return WALL_LEFT_PCT + 5
    const stageRect = stage.getBoundingClientRect()
    const wallRect = wall.getBoundingClientRect()
    const robotLeftPx = wallRect.left - stageRect.left + canvasX - 118
    return Math.max(2, Math.min(86, (robotLeftPx / stageRect.width) * 100))
  }

  async function paintSession(key, score, seedText, runId) {
    const spec = FACES[key]
    const rng = mulberry32(hashString(seedText) ^ (Date.now() & 0xffffffff))
    const surface = prepareCanvas()
    if (!surface) return

    // Face box: centred on the wall, sized to fill it confidently
    const S = Math.min(surface.width * 0.42, surface.height * 0.46)
    const faceCx = surface.width / 2
    const faceCy = surface.height * 0.52

    // Walk to the wall
    setPhase('walking')
    setFacing(1)
    setRobotX(robotXForCanvasX(faceCx - 0.42 * S))
    await sleep(1500)
    if (runId !== runIdRef.current) return

    setPhase('painting')

    // Preferred path: spray-reveal the pre-baked artwork. Give the
    // download a moment to finish; otherwise stroke-paint as fallback.
    const art = loadArtwork(key)
    await Promise.race([art.promise, sleep(3000)])
    if (runId !== runIdRef.current) return

    if (art.ready) {
      // rattle the can first — tiny beat that sells the craft
      setShaking(true)
      await sleep(700)
      setShaking(false)
      if (runId !== runIdRef.current) return
      await revealArtwork(surface, art.img, spec, rng, runId)
      if (runId !== runIdRef.current) return
    } else {
      // Fallback: draw the face in sequence: eyes → mouth → extras,
      // the robot shuffling along to stand by each stroke it sprays.
      const strokes = FACE_STROKES[key]
      for (const group of ['eyes', 'mouth', 'extra']) {
        for (const stroke of strokes.filter((s) => s.g === group)) {
          if (runId !== runIdRef.current) return
          const xs = stroke.pts.map((p) => p[0])
          const centroidX = faceCx + ((Math.min(...xs) + Math.max(...xs)) / 2) * S
          setRobotX(robotXForCanvasX(centroidX))
          await sleep(340)
          if (runId !== runIdRef.current) return
          await sprayStroke(surface, stroke, spec, score, S, faceCx, faceCy, rng, runId)
          await sleep(90 + rng() * 150)
        }
      }
    }

    sessionArtworksRef.current.push({ emotion: key, transcript: seedText, at: Date.now() })

    // Walk home
    setPhase('returning')
    setFacing(-1)
    setRobotX(ROBOT_HOME_X)
    await sleep(1600)
    if (runId !== runIdRef.current) return
    setFacing(1)
    setPhase('done')
  }

  // ——— Spray-reveal: the robot paints the artwork the way a person
  // would — eyes first, then mouth, then fills the face, then the aura
  // and background. A visible jet connects the can to the paint, the
  // arm aims at the work, and the spray mask means the artwork only
  // ever appears exactly where the can has sprayed.
  function revealArtwork(surface, img, spec, rng, runId) {
    return new Promise((resolve) => {
      const { ctx, width, height } = surface
      const TAU = Math.PI * 2

      // Offscreen alpha mask the spray accumulates onto
      const mask = document.createElement('canvas')
      mask.width = width
      mask.height = height
      const mctx = mask.getContext('2d')

      // Soft spray-dot sprite
      const sprite = document.createElement('canvas')
      sprite.width = sprite.height = 64
      const spx = sprite.getContext('2d')
      const grad = spx.createRadialGradient(32, 32, 0, 32, 32, 32)
      grad.addColorStop(0, 'rgba(255,255,255,0.9)')
      grad.addColorStop(0.6, 'rgba(255,255,255,0.45)')
      grad.addColorStop(1, 'rgba(255,255,255,0)')
      spx.fillStyle = grad
      spx.fillRect(0, 0, 64, 64)

      // Cover-fit the artwork to the wall
      const scale = Math.max(width / img.width, height / img.height)
      const dw = img.width * scale
      const dh = img.height * scale
      const ix = (width - dw) / 2
      const iy = (height - dh) / 2

      // The artworks share a known layout: face centred at (50%, 47%)
      // of the image with radius 33% of its height. Map into wall space
      // so the painting path lands exactly on the artwork's features.
      const fcx = ix + dw / 2
      const fcy = iy + dh * 0.47
      const Rw = dh * 0.33

      function spiralPts(cx, cy, r0, r1, loops, n = 110) {
        const pts = []
        for (let i = 0; i <= n; i++) {
          const t = i / n
          const r = r0 + (r1 - r0) * t
          const a = t * loops * TAU - Math.PI / 2
          pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.92])
        }
        return pts
      }
      function loopPts(cx, cy, r, loops = 2, n = 34) {
        const pts = []
        for (let i = 0; i <= n; i++) {
          const a = (i / n) * loops * TAU
          pts.push([cx + Math.cos(a) * r * (0.8 + rng() * 0.4), cy + Math.sin(a) * r * (0.8 + rng() * 0.4)])
        }
        return pts
      }
      function arcSweep(cx, cy, rx, ry, n = 30) {
        const pts = []
        for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI; pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]) }
        for (let i = n; i >= 0; i--) { const a = (i / n) * Math.PI; pts.push([cx + Math.cos(a) * rx * 1.15, cy + Math.sin(a) * ry * 1.25]) }
        return pts
      }

      // Painting plan, in the order a painter would work
      const segments = [
        { pts: loopPts(fcx - Rw * 0.4, fcy - Rw * 0.27, Rw * 0.15, 2.5), brush: Rw * 0.2, dur: 520 },  // left eye
        { pts: loopPts(fcx + Rw * 0.4, fcy - Rw * 0.27, Rw * 0.15, 2.5), brush: Rw * 0.2, dur: 520 },  // right eye
        { pts: arcSweep(fcx, fcy + Rw * 0.28, Rw * 0.5, Rw * 0.3), brush: Rw * 0.22, dur: 700 },       // mouth
        { pts: spiralPts(fcx, fcy, Rw * 1.02, Rw * 0.12, 2.6), brush: Rw * 0.34, dur: 2400 },          // fill the face
        { pts: spiralPts(fcx, fcy, Rw * 1.5, Rw * 1.15, 1.05, 60), brush: Rw * 0.42, dur: 1200 },      // aura ring
        {
          pts: [[width * 0.05, height * 0.16], [width * 0.95, height * 0.2], [width * 0.93, height * 0.8], [width * 0.06, height * 0.76]],
          brush: height * 0.24, dur: 1000,
        }, // background coat
      ]

      function composite() {
        ctx.clearRect(0, 0, width, height)
        ctx.drawImage(mask, 0, 0, width, height)
        ctx.globalCompositeOperation = 'source-in'
        ctx.drawImage(img, ix, iy, dw, dh)
        ctx.globalCompositeOperation = 'source-over'
      }

      // Transient aerosol jet from the can tip to the paint point,
      // redrawn fresh every frame on top of the composite.
      function drawJet(ax, ay) {
        const wall = wallRef.current
        const robot = robotRef.current
        if (!wall || !robot) return
        const wr = wall.getBoundingClientRect()
        const rr = robot.getBoundingClientRect()
        const nx = rr.right - wr.left - 4
        const ny = rr.top - wr.top + rr.height * 0.3
        const dx = ax - nx
        const dy = ay - ny
        const dist = Math.hypot(dx, dy) || 1
        for (let i = 0; i < 18; i++) {
          const t = rng()
          const spreadScale = dist * 0.06 * t
          const x = nx + dx * t + gauss(rng) * spreadScale
          const y = ny + dy * t + gauss(rng) * spreadScale
          ctx.globalAlpha = 0.12 * (1 - t * 0.55)
          ctx.fillStyle = i % 3 === 0 ? spec.chip : '#ffffff'
          ctx.beginPath()
          ctx.arc(x, y, 1 + t * 2.6, 0, TAU)
          ctx.fill()
        }
        // nozzle flare
        ctx.globalAlpha = 0.55
        ctx.fillStyle = '#fff'
        ctx.beginPath()
        ctx.arc(nx, ny, 2, 0, TAU)
        ctx.fill()
        ctx.globalAlpha = 1
      }

      // Point the arm at the paint spot (viewport-space angle)
      function updateAim(ax, ay) {
        const wall = wallRef.current
        const robot = robotRef.current
        if (!wall || !robot) return
        const wr = wall.getBoundingClientRect()
        const rr = robot.getBoundingClientRect()
        const sx = rr.left + rr.width * 0.78
        const sy = rr.top + rr.height * 0.42
        const deg = (Math.atan2(wr.top + ay - sy, wr.left + ax - sx) * 180) / Math.PI
        setAimDeg(Math.max(-80, Math.min(30, deg)))
      }

      let lastFollow = 0

      function runSegment(seg) {
        return new Promise((segDone) => {
          const cum = [0]
          for (let i = 1; i < seg.pts.length; i++) {
            cum.push(cum[i - 1] + Math.hypot(seg.pts[i][0] - seg.pts[i - 1][0], seg.pts[i][1] - seg.pts[i - 1][1]))
          }
          const len = cum[cum.length - 1] || 1
          const start = performance.now()

          function pointAt(d) {
            let i = 1
            while (i < cum.length - 1 && cum[i] < d) i++
            const t = (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1)
            return [
              seg.pts[i - 1][0] + (seg.pts[i][0] - seg.pts[i - 1][0]) * t,
              seg.pts[i - 1][1] + (seg.pts[i][1] - seg.pts[i - 1][1]) * t,
            ]
          }

          function frame(now) {
            if (runId !== runIdRef.current) return segDone()
            const t = Math.min(1, (now - start) / seg.dur)
            const [ax, ay] = pointAt(t * len)

            for (let i = 0; i < 24; i++) {
              const r = seg.brush * (0.14 + rng() * 0.3)
              const x = ax + gauss(rng) * seg.brush * 0.55
              const y = ay + gauss(rng) * seg.brush * 0.55
              mctx.globalAlpha = 0.25 + rng() * 0.25
              mctx.drawImage(sprite, x - r, y - r, r * 2, r * 2)
            }
            mctx.globalAlpha = 1

            if (now - lastFollow > 380) {
              lastFollow = now
              setRobotX(robotXForCanvasX(ax))
            }
            updateAim(ax, ay)

            composite()
            drawJet(ax, ay)

            if (t >= 1) return segDone()
            requestAnimationFrame(frame)
          }
          requestAnimationFrame(frame)
        })
      }

      ;(async () => {
        for (const seg of segments) {
          if (runId !== runIdRef.current) break
          await runSegment(seg)
          await sleep(60 + rng() * 120) // beat between moves
        }
        // settle: flood the last thin patches so the piece ends complete
        for (let k = 0; k < 12; k++) {
          if (runId !== runIdRef.current) break
          mctx.globalAlpha = 0.18
          mctx.fillStyle = '#fff'
          mctx.fillRect(0, 0, width, height)
          mctx.globalAlpha = 1
          composite()
          await sleep(40)
        }
        setAimDeg(0)
        resolve()
      })()
    })
  }

  // ——— The spray engine: each stroke is traced tip-to-tail with a dense
  // particle core and a soft halo, so it reads hand-sprayed, not vector-clean.
  function sprayStroke(surface, stroke, spec, score, S, faceCx, faceCy, rng, runId) {
    return new Promise((resolve) => {
      const { ctx, width, height } = surface

      // Face-space → canvas, with seeded whole-stroke drift + wobble so
      // no two sprays are pixel-identical but the face stays legible.
      const base = stroke.pts.map(([x, y]) => [faceCx + x * S, faceCy + y * S])
      const offX = gauss(rng) * S * 0.022
      const offY = gauss(rng) * S * 0.022
      const amp = S * (0.008 + rng() * 0.013)
      const freq = 2 + rng() * 3
      const ph = rng() * Math.PI * 2

      // Cumulative arc length so the can moves at constant speed
      const seg = [0]
      for (let i = 1; i < base.length; i++) {
        seg.push(seg[i - 1] + Math.hypot(base[i][0] - base[i - 1][0], base[i][1] - base[i - 1][1]))
      }
      const len = seg[seg.length - 1] || 1

      const density = stroke.density ?? 1
      const wCore = S * 0.03 * (stroke.w || 1)
      const intensity = 0.55 + score * 0.45
      const color = spec.palette[Math.floor(rng() * spec.palette.length)]
      const coreR = Math.max(1.1, S * 0.011)
      const duration = Math.min(1150, Math.max(340, len * 2.1))
      const start = performance.now()
      let painted = 0

      function pointAt(d) {
        let i = 1
        while (i < seg.length - 1 && seg[i] < d) i++
        const t = (d - seg[i - 1]) / ((seg[i] - seg[i - 1]) || 1)
        const x = base[i - 1][0] + (base[i][0] - base[i - 1][0]) * t
        const y = base[i - 1][1] + (base[i][1] - base[i - 1][1]) * t
        const wob = Math.sin((d / len) * freq * Math.PI * 2 + ph) * amp
        return [x + offX + wob, y + offY + wob * 0.6]
      }

      function dot(x, y, r, a) {
        if (x < 3 || x > width - 3 || y < 3 || y > height - 3) return
        ctx.globalAlpha = Math.min(0.5, a * (0.6 + rng() * 0.8))
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fill()
      }

      function frame(now) {
        if (runId !== runIdRef.current) return resolve()
        const t = Math.min(1, (now - start) / duration)
        const target = t * len
        while (painted <= target) {
          const [px, py] = pointAt(painted)
          // dense core
          for (let i = 0; i < Math.round(3 * density); i++) {
            dot(px + gauss(rng) * wCore * 0.45, py + gauss(rng) * wCore * 0.45,
              coreR * (0.6 + rng() * 0.8), 0.16 * intensity * density)
          }
          // soft halo of overspray
          for (let i = 0; i < 2; i++) {
            dot(px + gauss(rng) * wCore * 1.7, py + gauss(rng) * wCore * 1.7,
              coreR * (1.1 + rng() * 1.2), 0.035 * density)
          }
          painted += 2.2
        }
        ctx.globalAlpha = 1
        if (t >= 1) {
          // Fresh paint runs: seeded chance of a drip below the stroke
          if (rng() < spec.drip) {
            const d = rng() * len
            const [dx, dy] = pointAt(d)
            const dripLen = 18 + rng() * 55
            for (let k = 0; k < dripLen; k += 2.2) {
              dot(dx + gauss(rng) * 0.9, dy + k, 1.05, 0.14 * (1 - k / dripLen))
            }
            ctx.globalAlpha = 1
          }
          return resolve()
        }
        requestAnimationFrame(frame)
      }
      requestAnimationFrame(frame)
    })
  }

  // ——— UI derived bits
  const busy = phase === 'thinking' || phase === 'walking' || phase === 'painting' || phase === 'returning'
  const spraying = phase === 'painting'
  const walking = phase === 'walking' || phase === 'returning'
  const chip = emotionKey ? FACES[emotionKey] : null

  const statusLine = {
    idle: 'How are you feeling today?',
    listening: 'Listening… say whatever is on your mind.',
    thinking: 'Hmm… reading the feeling in your words.',
    walking: 'The robot has an idea.',
    painting: chip ? `Painting ${emotionLabel}…` : 'Painting…',
    returning: 'Stepping back to admire it.',
    done: chip ? `That's what ${emotionLabel} looks like today.` : 'Done.',
  }[phase]

  return (
    <div className="page">
      <Head>
        <title>Feedback Artist | Voodoo Immersive × Transition Layer</title>
        <link rel="icon" href="/favicon.ico" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="description" content="Give the robot your feedback; he will extract the sentiment and emotion and turn it into street art. A browser demo by Voodoo Immersive." />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="true" />
        <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      </Head>

      <nav className="nav">
        <div className="nav-inner">
          <Link href="/"><img src="/transition-layer-logo.png" alt="Transition Layer" className="logo" /></Link>
        </div>
      </nav>

      <main>
        <div className="page-wrap">
          <div className="page-header">
            <div className="label-tag">Voodoo Immersive demo</div>
            <h1 className="page-h1">Feedback Artist</h1>
            <p className="page-sub">Give the robot your feedback; he will extract the sentiment and emotion and turn it into street art.</p>
          </div>

          {/* STAGE */}
          <div className="stage" ref={stageRef}>
            <div className="wall" ref={wallRef}>
              <canvas ref={canvasRef} className="wall-canvas" />
            </div>
            <div className="floor" />

            {/* Intercom the robot listens at */}
            <div className={`intercom ${phase === 'listening' ? 'live' : ''}`}>
              <svg viewBox="0 0 40 90" width="34" height="76" aria-hidden="true">
                <rect x="18" y="26" width="4" height="58" rx="2" fill="#333" />
                <rect x="8" y="2" width="24" height="30" rx="7" fill="#1c1c1c" stroke="rgba(255,255,255,0.25)" />
                <circle className="intercom-light" cx="20" cy="10" r="3" fill="#444" />
                <rect x="13" y="17" width="14" height="2" rx="1" fill="#555" />
                <rect x="13" y="21" width="14" height="2" rx="1" fill="#555" />
                <rect x="13" y="25" width="14" height="2" rx="1" fill="#555" />
              </svg>
            </div>

            {/* THE ROBOT */}
            <div
              className={`robot-pos ${walking ? 'moving' : ''} ${spraying ? 'stepping' : ''}`}
              style={{ left: `${robotX}%` }}
              ref={robotRef}
            >
              {(phase === 'idle' || phase === 'done') && (
                <div className="speech-bubble">Tell me what you think</div>
              )}
              <div
                className={`robot ${walking ? 'walking' : ''} ${spraying ? 'spraying' : ''} ${shaking ? 'shaking' : ''} ${phase === 'idle' || phase === 'done' ? 'waving' : ''} ${phase === 'thinking' || phase === 'listening' ? 'attentive' : ''}`}
                style={{ transform: `scaleX(${facing})` }}
              >
                {spraying && <div className="spray-puff" />}
                <svg viewBox="0 0 90 120" width="82" height="110" aria-hidden="true">
                  {/* antenna */}
                  <line x1="45" y1="18" x2="45" y2="6" stroke="#8a939c" strokeWidth="2.5" />
                  <circle className="antenna-tip" cx="45" cy="5" r="4" fill="#555" />
                  {/* head */}
                  <rect x="26" y="16" width="38" height="28" rx="9" fill="#c9d1d9" />
                  <rect x="31" y="22" width="28" height="16" rx="6" fill="#10151a" />
                  <circle className="eye" cx="40" cy="30" r="3.2" fill="#7ee3ff" />
                  <circle className="eye" cx="50" cy="30" r="3.2" fill="#7ee3ff" />
                  {/* body */}
                  <rect x="24" y="47" width="42" height="38" rx="10" fill="#aeb8c2" />
                  <rect x="31" y="54" width="28" height="12" rx="4" fill="#87919b" />
                  <circle cx="45" cy="76" r="4" fill="#7ee3ff" opacity="0.75" />
                  {/* left arm (back arm — hangs, or waves at the audience) */}
                  <g className="arm-left">
                    <rect x="16" y="51" width="8" height="24" rx="4" fill="#98a2ac" />
                    <circle cx="20" cy="75" r="5" fill="#87919b" />
                  </g>
                  {/* right arm (front arm, holds the can, aims at the work) */}
                  <g className="arm-right" style={{ transform: `rotate(${spraying ? aimDeg : 0}deg)`, transformOrigin: '68px 55px' }}>
                    <rect x="66" y="51" width="22" height="8" rx="4" fill="#98a2ac" />
                    <g className="spray-can">
                      <rect x="82" y="38" width="10" height="16" rx="2" fill="#ff5f57" />
                      <rect x="84" y="34" width="6" height="5" rx="1" fill="#e8edf2" />
                    </g>
                  </g>
                  {/* legs */}
                  <g className="leg leg-l">
                    <rect x="30" y="85" width="9" height="22" rx="4" fill="#98a2ac" />
                    <rect x="27" y="105" width="15" height="7" rx="3.5" fill="#6f7982" />
                  </g>
                  <g className="leg leg-r">
                    <rect x="51" y="85" width="9" height="22" rx="4" fill="#98a2ac" />
                    <rect x="48" y="105" width="15" height="7" rx="3.5" fill="#6f7982" />
                  </g>
                </svg>
              </div>
            </div>
          </div>

          {/* CONTROLS */}
          <div className="controls">
            <p className="status-line">{statusLine}</p>

            {(liveTranscript || transcript) && (
              <p className="transcript">&ldquo;{transcript || liveTranscript}&rdquo;</p>
            )}

            {chip && (
              <div className="emotion-chip" style={{ borderColor: chip.chip }}>
                <span className="chip-dot" style={{ background: chip.chip }} />
                {emotionLabel} · {Math.round(confidence * 100)}%
              </div>
            )}

            <form className="input-row" onSubmit={handleTextSubmit}>
              <input
                className="feel-input"
                type="text"
                maxLength={280}
                placeholder={busy ? 'The artist is at work…' : phase === 'listening' ? 'Listening…' : "Type how you feel…"}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                disabled={busy || phase === 'listening' || modelState === 'loading'}
              />
              <button
                type="submit"
                className="send-btn"
                disabled={busy || phase === 'listening' || modelState === 'loading' || !typed.trim()}
              >
                Paint it →
              </button>
              {speechSupported && (
                <button
                  type="button"
                  className={`mic-btn ${phase === 'listening' ? 'live' : ''}`}
                  aria-label={phase === 'listening' ? 'Stop listening' : 'Speak instead'}
                  title={phase === 'listening' ? 'Tap when you are done' : 'Speak instead'}
                  onClick={phase === 'listening' ? stopListening : startListening}
                  disabled={busy || modelState === 'loading'}
                >
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
                    <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3z" />
                    <path d="M18 11a1 1 0 1 0-2 0 4 4 0 0 1-8 0 1 1 0 1 0-2 0 6 6 0 0 0 5 5.92V19H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-2.08A6 6 0 0 0 18 11z" />
                  </svg>
                </button>
              )}
            </form>
            {modelState === 'loading' && (
              <p className="loader-line">
                Warming up the art brain… {modelProgress}%{modelAttempt && modelAttempt.index > 1 ? ` (try ${modelAttempt.index}/${modelAttempt.total})` : ''}
              </p>
            )}
            {modelState === 'error' && (
              <p className="loader-line">The full art brain couldn&apos;t load — keyword mode is on. Name a feeling (&ldquo;I&apos;m happy&rdquo;, &ldquo;I&apos;m furious&rdquo;) and the robot will still paint it.</p>
            )}
            {phase === 'listening' && (
              <p className="loader-line listening-line"><span className="pulse-dot" /> Listening — tap the mic when you&apos;re done</p>
            )}
            {!speechSupported && (
              <p className="loader-line">Voice input isn&apos;t available in this browser — typing works everywhere. For voice, use Chrome or Edge.</p>
            )}

            {notice && <p className="notice">{notice}</p>}

            <p className="fine-print">
              Runs entirely in your browser — your voice never leaves this page. First visit downloads a small AI model (a few MB, cached after that).
              {modelName && <span className="model-tag"> · model: {modelName.split('/')[1]}</span>}
              {modelName === BINARY_FALLBACK && <span className="model-warn"> (fallback model — nuance limited; naming a feeling out loud still paints the right face)</span>}
            </p>
            {modelName === BINARY_FALLBACK && modelFailures.length > 0 && (
              <p className="fine-print model-tag">{modelFailures.map((f, i) => <span key={i}>✗ {f}<br /></span>)}</p>
            )}
          </div>
        </div>
      </main>

      <footer className="footer">
        <div className="footer-inner">
          <p className="footer-text">Made by Voodoo Immersive</p>
          <p className="footer-mono">A browser demo of a concept that runs on dedicated hardware in venue installations.</p>
        </div>
      </footer>

      <style jsx>{`
        :global(*) { box-sizing: border-box; margin: 0; padding: 0; }
        :global(body) { background: #000; color: #ededed; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif; -webkit-font-smoothing: antialiased; font-size: 16px; }
        :global(a) { text-decoration: none; color: inherit; }

        .page { min-height: 100vh; display: flex; flex-direction: column; }

        .nav { position: sticky; top: 0; z-index: 100; background: rgba(0,0,0,0.8); backdrop-filter: blur(12px); border-bottom: 1px solid rgba(255,255,255,0.1); }
        .nav-inner { max-width: 900px; margin: 0 auto; padding: 0.75rem 2rem; display: flex; align-items: center; }
        .logo { height: 40px; width: auto; object-fit: contain; }

        .page-wrap { max-width: 900px; margin: 0 auto; padding: 3.5rem 2rem 4rem; width: 100%; }
        .page-header { text-align: center; margin-bottom: 2rem; }
        .label-tag { display: inline-block; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.08em; color: #b388ff; margin-bottom: 1rem; font-weight: 500; }
        .page-h1 { font-size: 3rem; font-weight: 700; letter-spacing: -0.05em; color: #ededed; line-height: 1.1; margin-bottom: 0.75rem; }
        .page-sub { color: #888; font-size: 1.05rem; line-height: 1.65; max-width: 54ch; margin: 0 auto; }

        /* STAGE */
        .stage { position: relative; height: 400px; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; overflow: hidden; background: linear-gradient(180deg, #0a0d11 0%, #10151a 78%, #171d24 78%, #12171d 100%); }
        .floor { position: absolute; left: 0; right: 0; bottom: 0; height: 22%; border-top: 1px solid rgba(255,255,255,0.07); }
        .wall { position: absolute; left: ${WALL_LEFT_PCT}%; right: ${100 - WALL_RIGHT_PCT}%; top: 7%; bottom: 24%; background: rgba(255,255,255,0.045); border: 1px solid rgba(255,255,255,0.12); border-radius: 6px; }
        .wall-canvas { position: absolute; inset: 0; width: 100%; height: 100%; }

        .intercom { position: absolute; left: 2.2%; bottom: 21%; opacity: 0.9; }
        .intercom.live .intercom-light { fill: #28c840; }
        .intercom.live svg { filter: drop-shadow(0 0 6px rgba(40,200,64,0.5)); }

        .robot-pos { position: absolute; bottom: 19%; transition: left 1.4s cubic-bezier(0.45, 0, 0.25, 1); will-change: left; }
        .robot-pos.stepping { transition-duration: 0.45s; }
        .robot { position: relative; animation: bob 3.2s ease-in-out infinite; transform-origin: center bottom; }
        .robot.walking { animation: bob 0.45s ease-in-out infinite; }
        .robot .eye { animation: blink 4.5s infinite; }
        .robot.attentive .eye { animation: none; }
        .robot.attentive .antenna-tip { fill: #7ee3ff; filter: drop-shadow(0 0 4px rgba(126,227,255,0.8)); animation: antennaPulse 0.9s ease-in-out infinite; }

        .robot .arm-left { transform-origin: 20px 53px; }
        .robot.waving .arm-left { animation: wave 1.15s ease-in-out infinite; }
        @keyframes wave { 0%, 100% { transform: rotate(150deg); } 50% { transform: rotate(207deg); } }

        .speech-bubble { position: absolute; bottom: 116px; left: 4px; background: #fff; color: #000; font-size: 0.72rem; font-weight: 600; padding: 0.42rem 0.7rem; border-radius: 10px; border-bottom-left-radius: 2px; white-space: nowrap; z-index: 5; animation: bubbleFloat 3.2s ease-in-out infinite; }
        .speech-bubble::after { content: ''; position: absolute; left: 13px; bottom: -6px; border: 6px solid transparent; border-top-color: #fff; border-bottom: 0; }
        @keyframes bubbleFloat { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }

        .robot .arm-right { transition: transform 0.35s ease; }
        .robot .spray-can { opacity: 0; transition: opacity 0.3s; }
        .robot.spraying .spray-can { opacity: 1; }
        .robot.shaking { animation: canshake 0.12s linear infinite; }
        .robot.shaking .spray-can { opacity: 1; }
        .robot.shaking .arm-right { transform: rotate(-30deg); }

        .robot .leg { transform-origin: center 87px; }
        .robot.walking .leg-l { animation: stepA 0.45s ease-in-out infinite; }
        .robot.walking .leg-r { animation: stepB 0.45s ease-in-out infinite; }

        .spray-puff { position: absolute; top: 26px; right: -18px; width: 14px; height: 14px; border-radius: 50%; background: rgba(255,255,255,0.35); filter: blur(4px); animation: puff 0.5s ease-out infinite; }

        @keyframes bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
        @keyframes blink { 0%, 46%, 50%, 100% { opacity: 1; } 48% { opacity: 0.1; } }
        @keyframes antennaPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        @keyframes canshake { 0%, 100% { transform: scaleX(1) translateY(0) rotate(0deg); } 25% { transform: scaleX(1) translateY(-2.5px) rotate(-2.5deg); } 75% { transform: scaleX(1) translateY(1.5px) rotate(2.5deg); } }
        @keyframes stepA { 0%, 100% { transform: rotate(14deg); } 50% { transform: rotate(-14deg); } }
        @keyframes stepB { 0%, 100% { transform: rotate(-14deg); } 50% { transform: rotate(14deg); } }
        @keyframes puff { 0% { transform: scale(0.4); opacity: 0.7; } 100% { transform: scale(1.6); opacity: 0; } }

        /* CONTROLS */
        .controls { text-align: center; margin-top: 2rem; display: grid; gap: 0.9rem; justify-items: center; }
        .status-line { font-size: 1.35rem; font-weight: 600; letter-spacing: -0.02em; color: #ededed; }
        .transcript { font-family: 'IBM Plex Mono', monospace; font-size: 0.9rem; color: #888; max-width: 60ch; line-height: 1.6; }
        .emotion-chip { display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.35rem 0.9rem; border: 1px solid; border-radius: 999px; font-size: 0.85rem; font-weight: 600; color: #ededed; text-transform: capitalize; }
        .chip-dot { width: 9px; height: 9px; border-radius: 50%; }

        .input-row { display: flex; gap: 0.5rem; align-items: stretch; width: 100%; max-width: 460px; }
        .feel-input { flex: 1; min-width: 0; padding: 0.75rem 1rem; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); border-radius: 999px; color: #ededed; font-size: 0.95rem; font-family: 'Inter', -apple-system, sans-serif; outline: none; transition: border-color 0.15s; }
        .feel-input:focus { border-color: rgba(255,255,255,0.35); }
        .feel-input::placeholder { color: #555; }
        .feel-input:disabled { opacity: 0.55; }
        .send-btn { padding: 0 1.2rem; border-radius: 999px; border: none; background: #fff; color: #000; font-size: 0.9rem; font-weight: 600; cursor: pointer; font-family: 'Inter', -apple-system, sans-serif; transition: all 0.15s; white-space: nowrap; }
        .send-btn:hover:not(:disabled) { background: #ededed; }
        .send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .mic-btn { width: 46px; height: 46px; flex-shrink: 0; border-radius: 50%; border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.08); color: #ededed; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: all 0.15s; align-self: center; }
        .mic-btn:hover:not(:disabled) { background: rgba(255,255,255,0.16); border-color: rgba(255,255,255,0.4); }
        .mic-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .mic-btn.live { background: #28c840; border-color: #28c840; color: #04180a; animation: micPulse 1.2s ease-in-out infinite; }
        @keyframes micPulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(40,200,64,0.5); } 50% { box-shadow: 0 0 0 9px rgba(40,200,64,0); } }
        .loader-line { display: inline-flex; align-items: center; gap: 0.5rem; font-size: 0.82rem; color: #888; }
        .listening-line { color: #28c840; }
        .pulse-dot { width: 9px; height: 9px; border-radius: 50%; background: #28c840; animation: listenPulse 1s ease-in-out infinite; }
        @keyframes listenPulse { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.5); opacity: 0.5; } }

        .support-note { max-width: 46ch; padding: 0.9rem 1.25rem; border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; color: #888; font-size: 0.9rem; line-height: 1.6; }
        .support-note strong { color: #ededed; }
        .notice { color: #ffb347; font-size: 0.875rem; max-width: 50ch; line-height: 1.5; }
        .fine-print { font-size: 0.75rem; color: #555; max-width: 56ch; line-height: 1.6; }
        .model-tag { font-family: 'IBM Plex Mono', monospace; font-size: 0.68rem; color: #444; }
        .model-warn { color: #8a6d3b; }

        .footer { margin-top: auto; border-top: 1px solid rgba(255,255,255,0.08); padding: 2.5rem 2rem; }
        .footer-inner { max-width: 900px; margin: 0 auto; text-align: center; display: grid; gap: 0.4rem; }
        .footer-text { color: #888; font-size: 0.85rem; font-weight: 600; }
        .footer-mono { font-family: 'IBM Plex Mono', monospace; font-size: 0.72rem; color: #444; }

        @media (max-width: 640px) {
          .page-wrap { padding: 2.5rem 1rem 3rem; }
          .page-h1 { font-size: 2.2rem; }
          .stage { height: 320px; }
          .status-line { font-size: 1.1rem; }
        }
      `}</style>
    </div>
  )
}
