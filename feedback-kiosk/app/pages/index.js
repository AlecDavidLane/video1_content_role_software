/** The Feedback Artist kiosk (brief §3): idle → input → processing →
 * result → reset. Full screen, touch first, no website chrome. Any
 * failure lands back in typed input - never an error screen. */
import Head from 'next/head'
import { useCallback, useEffect, useRef, useState } from 'react'
import ArtistStage from '../components/ArtistStage'
import TouchKeyboard from '../components/TouchKeyboard'
import { classifyText } from '../lib/emotion'

export default function Kiosk() {
  const [cfg, setCfg] = useState(null)
  const [cfgError, setCfgError] = useState(null)
  const [mode, setMode] = useState('idle') // idle | input | processing | result
  const [text, setText] = useState('')
  const [nudge, setNudge] = useState(false)
  const [face, setFace] = useState(null)
  const [processingLine, setProcessingLine] = useState(0)
  const [taps, setTaps] = useState(0)
  const timerRef = useRef(null)

  // -- config ---------------------------------------------------------
  useEffect(() => {
    fetch('/api/kiosk-config')
      .then((r) => (r.ok ? r.json() : r.json().then((e) => Promise.reject(e))))
      .then(setCfg)
      .catch((e) => setCfgError(e))
  }, [])
  const S = cfg?.strings || {}

  // -- timers: idle/input/result all fall back to idle ------------------
  const arm = useCallback((seconds, fn) => {
    clearTimeout(timerRef.current)
    if (seconds > 0) timerRef.current = setTimeout(fn, seconds * 1000)
  }, [])

  const resetToIdle = useCallback(() => {
    // Clear all transient visitor state (brief §3 Reset / §6 privacy).
    setText('')
    setFace(null)
    setNudge(false)
    setMode('idle')
  }, [])

  useEffect(() => {
    if (!cfg) return
    if (mode === 'input') arm(cfg.timeouts.input_seconds, resetToIdle)
    else if (mode === 'result') arm(cfg.timeouts.result_seconds, resetToIdle)
    else clearTimeout(timerRef.current)
    return () => clearTimeout(timerRef.current)
  }, [mode, cfg, arm, resetToIdle])

  // -- rating flow: 1..5 straight onto the five faces --------------------
  const submitRating = useCallback((index) => {
    const rating = cfg.input.rating
    const chosenFace = rating.faces[index]
    setFace(chosenFace)
    setMode('processing')
    fetch('/api/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `${index + 1}/5 (${rating.labels[index]})`,
        emotion: chosenFace,
        confidence: 1,
        engine: 'rating',
        input_method: 'typed',
      }),
    }).catch(() => {})
  }, [cfg])

  // -- text flow ---------------------------------------------------------
  const submit = useCallback(async () => {
    const trimmed = text.trim()
    if (!trimmed) return setNudge(true)
    setMode('processing')
    setProcessingLine(0)
    const lineTimer = setInterval(
      () => setProcessingLine((n) => n + 1),
      1400
    )
    try {
      const result = await classifyText(trimmed, cfg.locale)
      setFace(result.face)
      // Persist fire-and-forget: storage failure must not break the show.
      fetch('/api/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: trimmed,
          emotion: result.face,
          confidence: result.confidence,
          engine: result.engine,
          input_method: 'typed',
        }),
      }).catch(() => {})
    } catch {
      setFace('calm')
    } finally {
      clearInterval(lineTimer)
    }
  }, [text, cfg])

  const onKey = useCallback((k) => {
    setNudge(false)
    setText((t) => (k === '\b' ? t.slice(0, -1) : (t + k).slice(0, 500)))
  }, [])

  // -- operator gesture: 5 taps top-left within 3s ---------------------
  const cornerTap = useCallback(() => {
    setTaps((n) => {
      if (n + 1 >= 5) {
        window.location.href = '/operator'
        return 0
      }
      return n + 1
    })
    setTimeout(() => setTaps(0), 3000)
  }, [])

  if (cfgError) {
    return (
      <main className="center">
        <h1>Feedback kiosk</h1>
        <p style={{ color: 'var(--text-dim)', maxWidth: 640 }}>
          This kiosk is not configured yet (operator: check
          /etc/feedback-kiosk/config.json and /api/health).
        </p>
      </main>
    )
  }
  if (!cfg) return <main className="center" />

  const accent = cfg.branding.accent || 'var(--accent)'
  // Dark accents (e.g. the awards purple) need light button text.
  const accentText = (() => {
    const m = /^#([0-9a-f]{6})$/i.exec(accent)
    if (!m) return '#04211b'
    const n = parseInt(m[1], 16)
    const lum = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)
    return lum < 140 ? '#ffffff' : '#04211b'
  })()
  const privacy = cfg.privacy.store_text ? S.privacy_notice : S.privacy_notice_totals_only

  return (
    <>
      <Head><title>{cfg.event.name}</title></Head>
      <main
        className="kiosk"
        style={cfg.branding.background ? { backgroundImage: `url(${cfg.branding.background})`, backgroundSize: 'cover' } : undefined}
      >
        <div className="corner" onPointerDown={cornerTap} />

        <header className="top">
          {cfg.branding.logo && <img src={cfg.branding.logo} alt="" className="logo" />}
          <div>
            <h1 style={{ color: accent }}>{cfg.event.name}</h1>
            {cfg.event.subtitle && <p className="sub">{cfg.event.subtitle}</p>}
          </div>
          {cfg.branding.sponsor_mark && <img src={cfg.branding.sponsor_mark} alt="" className="sponsor" />}
        </header>

        <section className="stage">
          <ArtistStage
            phase={mode === 'processing' ? (face ? 'painting' : 'thinking') : mode === 'result' ? 'done' : 'idle'}
            face={face}
            bubbleText={mode === 'idle' ? S.robot_bubble : ''}
            onDone={() => setMode('result')}
          />
        </section>

        {mode === 'idle' && (
          <section className="panel">
            <p className="hint">{S.idle_hint}</p>
            <button className="big" style={{ background: accent, color: accentText }} onClick={() => setMode('input')}>
              {S.start_button}
            </button>
          </section>
        )}

        {mode === 'input' && cfg.input.mode === 'rating' && (
          <section className="panel">
            <h2>{S.input_title}</h2>
            <div className="ratings">
              {cfg.input.rating.labels.map((label, i) => (
                <button
                  key={i}
                  className="rate"
                  style={{ borderColor: accent }}
                  onClick={() => submitRating(i)}
                >
                  {cfg.input.rating.style === 'stars' ? (
                    <>
                      <span className="stars" style={{ color: accent }}>{'★'.repeat(i + 1)}</span>
                      <span className="rate-label">{label}</span>
                    </>
                  ) : (
                    <span className="rate-label big-label">{label}</span>
                  )}
                </button>
              ))}
            </div>
            <button className="quiet" onClick={resetToIdle}>{S.cancel_button}</button>
          </section>
        )}

        {mode === 'input' && cfg.input.mode === 'text' && (
          <section className="panel">
            <h2>{S.input_title}</h2>
            <div className={`entry${nudge ? ' nudge' : ''}`}>
              {text || <span className="placeholder">{nudge ? S.input_empty_nudge : S.input_placeholder}</span>}
            </div>
            <TouchKeyboard locale={cfg.locale} onKey={onKey} onDone={submit} doneLabel={S.submit_button} />
            <button className="quiet" onClick={resetToIdle}>{S.cancel_button}</button>
          </section>
        )}

        {mode === 'processing' && (
          <section className="panel">
            <h2>{(S.processing_lines || [])[processingLine % (S.processing_lines?.length || 1)]}</h2>
          </section>
        )}

        {mode === 'result' && (
          <section className="panel">
            <h2>{S.result_title}</h2>
            <p className="hint">{S.thank_you}</p>
            <button className="big" style={{ background: accent, color: accentText }} onClick={resetToIdle}>
              {S.new_visitor_button}
            </button>
          </section>
        )}

        <footer className="privacy">{privacy}</footer>

        <style jsx>{`
          .kiosk { display: flex; flex-direction: column; height: 100vh; padding: 24px 40px; gap: 8px; }
          .center { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; }
          .corner { position: fixed; top: 0; left: 0; width: 90px; height: 90px; z-index: 50; }
          .top { display: flex; align-items: center; gap: 24px; }
          .logo { height: 56px; }
          .sponsor { height: 44px; margin-left: auto; }
          h1 { margin: 0; font-size: 2.2rem; }
          .sub { margin: 2px 0 0; color: var(--text-dim); }
          .stage { flex: 1; min-height: 0; }
          .panel { display: flex; flex-direction: column; align-items: center; gap: 14px; padding-bottom: 6px; }
          h2 { margin: 0; font-size: 1.7rem; }
          .hint { color: var(--text-dim); font-size: 1.2rem; margin: 0; }
          .big { font-size: 1.6rem; font-weight: 700; color: #04211b; padding: 0 46px; height: 76px; }
          .quiet { background: none; color: var(--text-dim); font-size: 1rem; }
          .entry { width: min(1100px, 100%); min-height: 64px; background: var(--surface);
            border: 1px solid #2a323c; border-radius: 12px; padding: 14px 18px;
            font-size: 1.5rem; line-height: 1.4; }
          .placeholder { color: var(--text-dim); }
          .nudge { border-color: ${'#ffb74d'}; }
          .privacy { color: var(--text-dim); font-size: 0.85rem; text-align: center; }
          .ratings { display: flex; gap: 16px; justify-content: center; flex-wrap: wrap; width: 100%; }
          .rate { display: flex; flex-direction: column; align-items: center; justify-content: center;
            gap: 6px; min-width: 150px; min-height: 96px; padding: 12px 20px;
            background: var(--surface); border: 2px solid; border-radius: 16px; color: var(--text); }
          .rate:active { transform: scale(0.97); }
          .stars { font-size: 1.7rem; letter-spacing: 2px; }
          .rate-label { color: var(--text-dim); font-size: 1rem; }
          .big-label { color: var(--text); font-size: 1.25rem; font-weight: 600; }
        `}</style>
      </main>
    </>
  )
}
