// ArtistStage — the reusable Feedback Artist stage: a robot character
// that thinks, walks to the wall and spray-paints one of five emotion
// faces. Ported from reference/feedbackartist-upstream.js with all page
// chrome stripped (nav/header/footer, controls, model loading, speech
// recognition, diagnostics). No network access: the optional pre-baked
// artworks are same-origin static assets (/art/<face>.webp) with the
// stroke-painting engine as fallback.
//
// Props:
//   phase: 'idle' | 'thinking' | 'painting' | 'done'
//     idle     → robot waits at home, waving (upstream idle/listening home pose)
//     thinking → robot goes attentive, antenna pulsing (upstream thinking)
//     painting → runs the full upstream choreography: walking → painting
//                (can-shake + spray) → returning, then settles into done
//     done     → robot at home admiring the work (upstream done)
//   face: 'joy' | 'calm' | 'sad' | 'angry' | 'surprised' — which face to spray
//   onDone: called once when the painting sequence (including the walk
//           home) has completed
//   reducedMotion: skip the choreography — the finished piece is stamped
//                  onto the wall in one go and onDone fires quickly;
//                  CSS animations/transitions are disabled too.

import { useEffect, useRef, useState } from 'react'
import { FACES, FACE_STROKES } from '../lib/faces'

// Clear the wall between visitors. Flip to false to build an
// accumulating mural instead.
const CLEAR_WALL_BETWEEN_SESSIONS = true

// Robot choreography positions, as % of stage width.
const ROBOT_HOME_X = 5
const WALL_LEFT_PCT = 34
const WALL_RIGHT_PCT = 94

// The upstream stage was authored at a fixed 400px height with an
// 82×110 robot; the whole robot is scaled by (stage height / 400) so
// the scene reads the same from a phone preview to a 1080p kiosk.
const BASE_STAGE_H = 400

// Spray intensity stand-in for the upstream classifier confidence
// (intensity = 0.55 + score * 0.45 inside the spray engine).
const DEFAULT_SCORE = 0.8

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

// Stage/robot CSS, ported from the upstream styled-jsx block with an
// `fa-` prefix (this <style> tag is global, not scoped).
const STYLES = `
  .fa-stage { position: relative; width: 100%; height: 100%; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; overflow: hidden; background: linear-gradient(180deg, #0a0d11 0%, #10151a 78%, #171d24 78%, #12171d 100%); }
  .fa-floor { position: absolute; left: 0; right: 0; bottom: 0; height: 22%; border-top: 1px solid rgba(255,255,255,0.07); }
  .fa-wall { position: absolute; left: ${WALL_LEFT_PCT}%; right: ${100 - WALL_RIGHT_PCT}%; top: 7%; bottom: 24%; background: rgba(255,255,255,0.045); border: 1px solid rgba(255,255,255,0.12); border-radius: 6px; }
  .fa-wall-canvas { position: absolute; inset: 0; width: 100%; height: 100%; }

  .fa-robot-pos { position: absolute; bottom: 19%; transition: left 1.4s cubic-bezier(0.45, 0, 0.25, 1); will-change: left; }
  .fa-robot-pos.fa-stepping { transition-duration: 0.45s; }
  .fa-robot { position: relative; animation: fa-bob 3.2s ease-in-out infinite; transform-origin: center bottom; }
  .fa-robot.fa-walking { animation: fa-bob 0.45s ease-in-out infinite; }
  .fa-robot .fa-eye { animation: fa-blink 4.5s infinite; }
  .fa-robot.fa-attentive .fa-eye { animation: none; }
  .fa-robot.fa-attentive .fa-antenna-tip { fill: #7ee3ff; filter: drop-shadow(0 0 4px rgba(126,227,255,0.8)); animation: fa-antennaPulse 0.9s ease-in-out infinite; }

  .fa-robot .fa-arm-left { transform-origin: 20px 53px; }
  .fa-robot.fa-waving .fa-arm-left { animation: fa-wave 1.15s ease-in-out infinite; }
  @keyframes fa-wave { 0%, 100% { transform: rotate(150deg); } 50% { transform: rotate(207deg); } }

  .fa-speech-bubble { position: absolute; bottom: 116px; left: 4px; background: #fff; color: #000; font-size: 0.72rem; font-weight: 600; padding: 0.42rem 0.7rem; border-radius: 10px; border-bottom-left-radius: 2px; white-space: nowrap; z-index: 5; animation: fa-bubbleFloat 3.2s ease-in-out infinite; }
  .fa-speech-bubble::after { content: ''; position: absolute; left: 13px; bottom: -6px; border: 6px solid transparent; border-top-color: #fff; border-bottom: 0; }
  @keyframes fa-bubbleFloat { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }

  .fa-robot .fa-arm-right { transition: transform 0.35s ease; }
  .fa-robot .fa-spray-can { opacity: 0; transition: opacity 0.3s; }
  .fa-robot.fa-spraying .fa-spray-can { opacity: 1; }
  .fa-robot.fa-shaking { animation: fa-canshake 0.12s linear infinite; }
  .fa-robot.fa-shaking .fa-spray-can { opacity: 1; }
  .fa-robot.fa-shaking .fa-arm-right { transform: rotate(-30deg); }

  .fa-robot .fa-leg { transform-origin: center 87px; }
  .fa-robot.fa-walking .fa-leg-l { animation: fa-stepA 0.45s ease-in-out infinite; }
  .fa-robot.fa-walking .fa-leg-r { animation: fa-stepB 0.45s ease-in-out infinite; }

  .fa-spray-puff { position: absolute; top: 26px; right: -18px; width: 14px; height: 14px; border-radius: 50%; background: rgba(255,255,255,0.35); filter: blur(4px); animation: fa-puff 0.5s ease-out infinite; }

  @keyframes fa-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
  @keyframes fa-blink { 0%, 46%, 50%, 100% { opacity: 1; } 48% { opacity: 0.1; } }
  @keyframes fa-antennaPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
  @keyframes fa-canshake { 0%, 100% { transform: scaleX(1) translateY(0) rotate(0deg); } 25% { transform: scaleX(1) translateY(-2.5px) rotate(-2.5deg); } 75% { transform: scaleX(1) translateY(1.5px) rotate(2.5deg); } }
  @keyframes fa-stepA { 0%, 100% { transform: rotate(14deg); } 50% { transform: rotate(-14deg); } }
  @keyframes fa-stepB { 0%, 100% { transform: rotate(-14deg); } 50% { transform: rotate(14deg); } }
  @keyframes fa-puff { 0% { transform: scale(0.4); opacity: 0.7; } 100% { transform: scale(1.6); opacity: 0; } }

  .fa-stage.fa-reduced *, .fa-stage.fa-reduced *::after { animation: none !important; transition: none !important; }
`

export default function ArtistStage({ phase = 'idle', face = null, onDone, reducedMotion = false, bubbleText = '' }) {
  // Internal choreography phase, a superset of the phase prop:
  // idle | thinking | walking | painting | returning | done
  const [internalPhase, setInternalPhase] = useState('idle')
  const [robotX, setRobotX] = useState(ROBOT_HOME_X)
  const [facing, setFacing] = useState(1) // 1 = right, -1 = left
  const [aimDeg, setAimDeg] = useState(0) // spray-arm angle while painting
  const [shaking, setShaking] = useState(false) // rattling the can
  const [stageScale, setStageScale] = useState(1)

  const stageRef = useRef(null)
  const wallRef = useRef(null)
  const canvasRef = useRef(null)
  const robotRef = useRef(null)
  const runIdRef = useRef(0)
  const artImagesRef = useRef({})
  const scaleRef = useRef(1)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  // ——— Scale the robot with the stage so the scene is
  // resolution-independent (kiosk runs it near-fullscreen at 1080p).
  useEffect(() => {
    const stage = stageRef.current
    if (!stage || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver((entries) => {
      const h = entries[0] && entries[0].contentRect ? entries[0].contentRect.height : 0
      if (!h) return
      const s = Math.max(0.35, h / BASE_STAGE_H)
      scaleRef.current = s
      setStageScale(s)
    })
    ro.observe(stage)
    return () => ro.disconnect()
  }, [])

  // Pre-baked artwork per emotion; starts downloading the moment the
  // emotion is known so it's usually ready by the time the robot
  // reaches the wall. Falls back to stroke-painting if it isn't.
  // (Same-origin static asset — nothing leaves the machine.)
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

  // Warm the artwork as soon as the caller knows the face (upstream did
  // this when classification finished, during the "hmm" beat).
  useEffect(() => {
    if (typeof window !== 'undefined' && face && FACES[face]) loadArtwork(face)
  }, [face])

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

  // Convert a canvas x-coordinate to the robot stage position that puts
  // its spray can just left of that point. (The 118px reach offset was
  // authored at BASE_STAGE_H, so it scales with the robot.)
  function robotXForCanvasX(canvasX) {
    const stage = stageRef.current
    const wall = wallRef.current
    if (!stage || !wall) return WALL_LEFT_PCT + 5
    const stageRect = stage.getBoundingClientRect()
    const wallRect = wall.getBoundingClientRect()
    const robotLeftPx = wallRect.left - stageRect.left + canvasX - 118 * scaleRef.current
    return Math.max(2, Math.min(86, (robotLeftPx / stageRect.width) * 100))
  }

  // ——— Drive the choreography from the phase prop.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    runIdRef.current++ // cancel any in-flight run when the phase changes
    if (phase === 'painting' && face && FACES[face]) {
      const runId = runIdRef.current
      paintSession(face, runId)
    } else if (phase === 'thinking') {
      setInternalPhase('thinking')
    } else if (phase === 'done') {
      setInternalPhase('done')
    } else {
      // idle: reset the stage for the next visitor
      setInternalPhase('idle')
      setRobotX(ROBOT_HOME_X)
      setFacing(1)
      setAimDeg(0)
      setShaking(false)
      if (CLEAR_WALL_BETWEEN_SESSIONS) clearWall()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, face])

  // Invalidate in-flight animation work on unmount.
  useEffect(() => () => { runIdRef.current++ }, [])

  function finishRun(runId) {
    if (runId !== runIdRef.current) return
    setInternalPhase('done')
    if (onDoneRef.current) onDoneRef.current()
  }

  async function paintSession(key, runId) {
    const spec = FACES[key]
    const score = DEFAULT_SCORE
    const rng = mulberry32(hashString(key) ^ (Date.now() & 0xffffffff))
    if (CLEAR_WALL_BETWEEN_SESSIONS) clearWall()
    const surface = prepareCanvas()
    if (!surface) return

    // Face box: centred on the wall, sized to fill it confidently
    const S = Math.min(surface.width * 0.42, surface.height * 0.46)
    const faceCx = surface.width / 2
    const faceCy = surface.height * 0.52

    // Reduced motion: no walk, no spray choreography — stamp the
    // finished piece and report done.
    if (reducedMotion) {
      const art = loadArtwork(key)
      await Promise.race([art.promise, sleep(800)])
      if (runId !== runIdRef.current) return
      if (art.ready) {
        stampArtwork(surface, art.img)
      } else {
        for (const group of ['eyes', 'mouth', 'extra']) {
          for (const stroke of FACE_STROKES[key].filter((s) => s.g === group)) {
            stampStroke(surface, stroke, spec, score, S, faceCx, faceCy, rng)
          }
        }
      }
      await sleep(150)
      finishRun(runId)
      return
    }

    // Walk to the wall
    setInternalPhase('walking')
    setFacing(1)
    setRobotX(robotXForCanvasX(faceCx - 0.42 * S))
    await sleep(1500)
    if (runId !== runIdRef.current) return

    setInternalPhase('painting')

    // Preferred path: spray-reveal the pre-baked artwork. Give the
    // (local) image a moment to decode; otherwise stroke-paint as fallback.
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

    // Walk home
    setInternalPhase('returning')
    setFacing(-1)
    setRobotX(ROBOT_HOME_X)
    await sleep(1600)
    if (runId !== runIdRef.current) return
    setFacing(1)
    finishRun(runId)
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

  // ——— Reduced-motion variants: identical output, drawn in one pass.
  function stampArtwork(surface, img) {
    const { ctx, width, height } = surface
    const scale = Math.max(width / img.width, height / img.height)
    const dw = img.width * scale
    const dh = img.height * scale
    ctx.drawImage(img, (width - dw) / 2, (height - dh) / 2, dw, dh)
  }

  // Synchronous version of sprayStroke's particle pass (no rAF, no jet).
  function stampStroke(surface, stroke, spec, score, S, faceCx, faceCy, rng) {
    const { ctx, width, height } = surface
    const base = stroke.pts.map(([x, y]) => [faceCx + x * S, faceCy + y * S])
    const offX = gauss(rng) * S * 0.022
    const offY = gauss(rng) * S * 0.022
    const amp = S * (0.008 + rng() * 0.013)
    const freq = 2 + rng() * 3
    const ph = rng() * Math.PI * 2

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

    for (let painted = 0; painted <= len; painted += 2.2) {
      const [px, py] = pointAt(painted)
      for (let i = 0; i < Math.round(3 * density); i++) {
        dot(px + gauss(rng) * wCore * 0.45, py + gauss(rng) * wCore * 0.45,
          coreR * (0.6 + rng() * 0.8), 0.16 * intensity * density)
      }
      for (let i = 0; i < 2; i++) {
        dot(px + gauss(rng) * wCore * 1.7, py + gauss(rng) * wCore * 1.7,
          coreR * (1.1 + rng() * 1.2), 0.035 * density)
      }
    }
    if (rng() < spec.drip) {
      const d = rng() * len
      const [dx, dy] = pointAt(d)
      const dripLen = 18 + rng() * 55
      for (let k = 0; k < dripLen; k += 2.2) {
        dot(dx + gauss(rng) * 0.9, dy + k, 1.05, 0.14 * (1 - k / dripLen))
      }
    }
    ctx.globalAlpha = 1
  }

  // ——— Derived robot state
  const spraying = internalPhase === 'painting'
  const walking = internalPhase === 'walking' || internalPhase === 'returning'
  const attentive = internalPhase === 'thinking'
  const resting = internalPhase === 'idle' || internalPhase === 'done'

  return (
    <div className={`fa-stage${reducedMotion ? ' fa-reduced' : ''}`} ref={stageRef}>
      <style>{STYLES}</style>

      <div className="fa-wall" ref={wallRef}>
        <canvas ref={canvasRef} className="fa-wall-canvas" />
      </div>
      <div className="fa-floor" />

      {/* THE ROBOT */}
      <div
        className={`fa-robot-pos${spraying ? ' fa-stepping' : ''}`}
        style={{
          left: `${robotX}%`,
          transform: `scale(${stageScale})`,
          transformOrigin: 'left bottom',
        }}
        ref={robotRef}
      >
        {resting && bubbleText && <div className="fa-speech-bubble">{bubbleText}</div>}
        <div
          className={`fa-robot${walking ? ' fa-walking' : ''}${spraying ? ' fa-spraying' : ''}${shaking ? ' fa-shaking' : ''}${resting ? ' fa-waving' : ''}${attentive ? ' fa-attentive' : ''}`}
          style={{ transform: `scaleX(${facing})` }}
        >
          {spraying && <div className="fa-spray-puff" />}
          <svg viewBox="0 0 90 120" width="82" height="110" aria-hidden="true">
            {/* antenna */}
            <line x1="45" y1="18" x2="45" y2="6" stroke="#8a939c" strokeWidth="2.5" />
            <circle className="fa-antenna-tip" cx="45" cy="5" r="4" fill="#555" />
            {/* head */}
            <rect x="26" y="16" width="38" height="28" rx="9" fill="#c9d1d9" />
            <rect x="31" y="22" width="28" height="16" rx="6" fill="#10151a" />
            <circle className="fa-eye" cx="40" cy="30" r="3.2" fill="#7ee3ff" />
            <circle className="fa-eye" cx="50" cy="30" r="3.2" fill="#7ee3ff" />
            {/* body */}
            <rect x="24" y="47" width="42" height="38" rx="10" fill="#aeb8c2" />
            <rect x="31" y="54" width="28" height="12" rx="4" fill="#87919b" />
            <circle cx="45" cy="76" r="4" fill="#7ee3ff" opacity="0.75" />
            {/* left arm (back arm — hangs, or waves at the audience) */}
            <g className="fa-arm-left">
              <rect x="16" y="51" width="8" height="24" rx="4" fill="#98a2ac" />
              <circle cx="20" cy="75" r="5" fill="#87919b" />
            </g>
            {/* right arm (front arm, holds the can, aims at the work) */}
            <g className="fa-arm-right" style={{ transform: `rotate(${spraying ? aimDeg : 0}deg)`, transformOrigin: '68px 55px' }}>
              <rect x="66" y="51" width="22" height="8" rx="4" fill="#98a2ac" />
              <g className="fa-spray-can">
                <rect x="82" y="38" width="10" height="16" rx="2" fill="#ff5f57" />
                <rect x="84" y="34" width="6" height="5" rx="1" fill="#e8edf2" />
              </g>
            </g>
            {/* legs */}
            <g className="fa-leg fa-leg-l">
              <rect x="30" y="85" width="9" height="22" rx="4" fill="#98a2ac" />
              <rect x="27" y="105" width="15" height="7" rx="3.5" fill="#6f7982" />
            </g>
            <g className="fa-leg fa-leg-r">
              <rect x="51" y="85" width="9" height="22" rx="4" fill="#98a2ac" />
              <rect x="48" y="105" width="15" height="7" rx="3.5" fill="#6f7982" />
            </g>
          </svg>
        </div>
      </div>
    </div>
  )
}
