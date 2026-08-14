// Face identities, stroke geometry and the English keyword lexicon for
// the Feedback Artist engine. Ported verbatim from
// reference/feedbackartist-upstream.js (comments preserved).

// ————————————————————————————————————————————————————————————————
// 5 spray-face identities. Colour and face agree: the model's labels
// collapse into these buckets and the robot sprays the matching face.
// ————————————————————————————————————————————————————————————————
export const FACES = {
  joy:       { display: 'joy',       chip: '#FFC94A', drip: 0.08, palette: ['#FFD54A', '#FFC107', '#FFB300', '#FFE082'] },
  calm:      { display: 'calm',      chip: '#7FD8BE', drip: 0.05, palette: ['#7FD8BE', '#4DB6AC', '#80CBC4', '#A8E6CF'] },
  sad:       { display: 'sad',       chip: '#64B5F6', drip: 0.5,  palette: ['#5885AF', '#64B5F6', '#4A7BA6', '#90CAF9'] },
  angry:     { display: 'angry',     chip: '#FF6B6B', drip: 0.12, palette: ['#FF3B30', '#E53935', '#FF6B6B', '#C62828'] },
  surprised: { display: 'surprised', chip: '#E040FB', drip: 0.08, palette: ['#B388FF', '#E040FB', '#FF4DA6', '#CE93D8'] },
}

// Model label → face bucket. Covers go_emotions (28 labels), the
// 6-emotion distilbert model, and the SST-2 binary fallback.
export const LABEL_TO_FACE = {
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
export function arcPts(cx, cy, rx, ry, a0, a1, n = 26) {
  const pts = []
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)])
  }
  return pts
}

export function linePts(x1, y1, x2, y2, n = 16) {
  const pts = []
  for (let i = 0; i <= n; i++) {
    pts.push([x1 + ((x2 - x1) * i) / n, y1 + ((y2 - y1) * i) / n])
  }
  return pts
}

// A tight inward spiral — sprays up as a solid filled dot/blob
export function blobPts(cx, cy, r) {
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
export const FACE_STROKES = {
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

// Deterministic first pass: if the visitor names the feeling outright,
// that always wins — every face stays reachable even if only the
// binary fallback model could load.
// (Upstream called this LEXICON; exported here as EN_LEXICON because it
// is the English keyword set — other locales supply their own lexicon
// as data to classifyWithLexicon.)
export const EN_LEXICON = {
  joy: ['happy', 'great', 'fantastic', 'wonderful', 'joy', 'joyful', 'excited', 'thrilled', 'brilliant', 'awesome', 'delighted', 'ecstatic', 'buzzing', 'cheerful', 'glad', 'good', 'lovely', 'stoked', 'chuffed'],
  calm: ['calm', 'relaxed', 'chilled', 'chill', 'peaceful', 'content', 'fine', 'okay', 'alright', 'mellow', 'serene', 'comfortable', 'cosy', 'rested', 'love', 'loved', 'loving'],
  sad: ['sad', 'unhappy', 'down', 'depressed', 'miserable', 'terrible', 'awful', 'tired', 'exhausted', 'gutted', 'heartbroken', 'lonely', 'upset', 'crying', 'hurt', 'disappointed', 'hopeless', 'drained', 'rubbish', 'blue'],
  angry: ['angry', 'furious', 'mad', 'annoyed', 'irritated', 'frustrated', 'livid', 'cross', 'raging', 'fuming', 'outraged', 'seething', 'hate', 'hacked off', 'pissed'],
  surprised: ['surprised', 'shocked', 'amazed', 'amazing', 'astonished', 'stunned', 'wow', 'whoa', 'unbelievable', 'unexpected', 'startled', 'incredible', "can't believe", 'scared', 'terrified', 'afraid', 'frightened', 'anxious', 'nervous', 'worried'],
}
