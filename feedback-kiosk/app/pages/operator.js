/** Operator screen (brief §4): reached only via the 5-tap corner
 * gesture + PIN. Status, export, clear, restart. */
import { useEffect, useState } from 'react'

export default function Operator() {
  const [pin, setPin] = useState('')
  const [unlocked, setUnlocked] = useState(false)
  const [wrong, setWrong] = useState(false)
  const [health, setHealth] = useState(null)
  const [busy, setBusy] = useState('')

  const tryPin = async (candidate) => {
    const r = await fetch('/api/operator/verify-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: candidate }),
    }).then((x) => x.json()).catch(() => ({ ok: false }))
    if (r.ok) setUnlocked(true)
    else { setWrong(true); setPin('') }
  }

  const press = (d) => {
    setWrong(false)
    if (d === 'C') return setPin('')
    const next = (pin + d).slice(0, 8)
    setPin(next)
    if (next.length >= 6) tryPin(next)
  }

  useEffect(() => {
    if (!unlocked) return
    fetch('/api/health').then((r) => r.json()).then(setHealth).catch(() => {})
  }, [unlocked, busy])

  const doClear = async () => {
    if (!window.confirm('Delete every stored response? This cannot be undone.')) return
    setBusy('clearing')
    await fetch('/api/operator/clear', {
      method: 'POST',
      headers: { 'x-operator-pin': pin },
    })
    setBusy('')
  }

  if (!unlocked) {
    return (
      <main className="pinwrap">
        <h2>Operator PIN</h2>
        <div className={`dots${wrong ? ' wrong' : ''}`}>{'●'.repeat(pin.length) || ' '}</div>
        <div className="pad">
          {['1','2','3','4','5','6','7','8','9','C','0','←'].map((d) => (
            <button key={d} onClick={() => (d === '←' ? setPin(pin.slice(0, -1)) : press(d))}>{d}</button>
          ))}
        </div>
        <a href="/" className="back">Back to kiosk</a>
        <style jsx>{`
          .pinwrap { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; gap: 18px; }
          .dots { font-size: 2rem; letter-spacing: 10px; min-height: 2.4rem; }
          .wrong { color: #ff6b6b; }
          .pad { display: grid; grid-template-columns: repeat(3, 96px); gap: 12px; }
          .pad button { height: 84px; font-size: 1.8rem; background: var(--surface); color: var(--text); }
          .back { color: var(--text-dim); margin-top: 12px; }
        `}</style>
      </main>
    )
  }

  const q = `?pin=${encodeURIComponent(pin)}`
  return (
    <main className="op">
      <h1>Kiosk status</h1>
      {health && (
        <div className="grid">
          <Card label="Application" value={`v${health.app_version}`} ok={health.ok} />
          <Card label="Profile" value={`${health.event_id} (${health.config_version})`} ok={health.checks?.config?.ok} />
          <Card label="Locale" value={health.locale} ok />
          <Card label="Storage" value={health.checks?.database?.detail} ok={health.checks?.database?.ok} />
          <Card label="Model" value={health.checks?.model?.detail} ok={health.checks?.model?.ok} />
          <Card label="Responses" value={String(health.responses?.total ?? 0)} ok />
          <Card
            label="Last response"
            value={health.responses?.last_response ? `${health.responses.last_response.emotion} @ ${health.responses.last_response.ts_utc}` : 'none'}
            ok
          />
        </div>
      )}
      <div className="actions">
        <a className="btn" href={`/api/operator/export${q}&format=csv`}>Export CSV</a>
        <a className="btn" href={`/api/operator/export${q}&format=json`}>Export JSON</a>
        <button className="btn danger" onClick={doClear}>{busy === 'clearing' ? '…' : 'Clear all feedback'}</button>
        <a className="btn" href="/">Back to kiosk</a>
      </div>
      <p className="dim">Restart: the kiosk session relaunches automatically if the app or browser exits (systemd). Power-cycling the machine is always safe - feedback is stored on disk.</p>
      <style jsx>{`
        .op { padding: 40px; display: flex; flex-direction: column; gap: 24px; height: 100vh; overflow: auto; }
        h1 { margin: 0; }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; }
        .actions { display: flex; gap: 14px; flex-wrap: wrap; }
        .btn { display: inline-flex; align-items: center; justify-content: center; min-height: 64px;
          padding: 0 26px; background: var(--surface); color: var(--text); border-radius: 12px;
          text-decoration: none; font-size: 1.1rem; border: 1px solid #2a323c; }
        .danger { border-color: #a33; color: #ff8a80; background: none; }
        .dim { color: var(--text-dim); max-width: 720px; }
      `}</style>
    </main>
  )
}

function Card({ label, value, ok }) {
  return (
    <div style={{
      background: 'var(--surface)', borderRadius: 12, padding: '14px 18px',
      borderLeft: `4px solid ${ok ? 'var(--accent)' : '#ff6b6b'}`,
    }}>
      <div style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>{label}</div>
      <div style={{ fontSize: '1.05rem', overflowWrap: 'anywhere' }}>{value || '—'}</div>
    </div>
  )
}
