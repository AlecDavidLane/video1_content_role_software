/** Integrated on-screen keyboard (brief §4): a public kiosk cannot
 * assume a physical keyboard or a working OS virtual keyboard. Touch
 * targets ≥56px, per-locale layout (es-ES gets ñ and accented vowels).
 */
import { useState } from 'react'

const LAYOUTS = {
  'en-GB': [
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', "'"],
    ['SHIFT', 'z', 'x', 'c', 'v', 'b', 'n', 'm', 'BACK'],
  ],
  'es-ES': [
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'ñ'],
    ['SHIFT', 'z', 'x', 'c', 'v', 'b', 'n', 'm', 'BACK'],
    ['á', 'é', 'í', 'ó', 'ú', 'ü', '¿', '?', '¡', '!'],
  ],
}
const PUNCT_ROW = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', ',', '.', '!', '?']

export default function TouchKeyboard({ locale = 'en-GB', onKey, onDone, doneLabel = 'OK' }) {
  const [shift, setShift] = useState(false)
  const rows = LAYOUTS[locale] || LAYOUTS['en-GB']

  const press = (key) => {
    if (key === 'SHIFT') return setShift((s) => !s)
    if (key === 'BACK') return onKey('\b')
    onKey(shift ? key.toUpperCase() : key)
    if (shift) setShift(false)
  }

  return (
    <div className="kb" role="group" aria-label="keyboard">
      <div className="kb-row">
        {PUNCT_ROW.map((k) => (
          <button key={k} className="kb-key" onPointerDown={(e) => { e.preventDefault(); onKey(k) }}>{k}</button>
        ))}
      </div>
      {rows.map((row, i) => (
        <div className="kb-row" key={i}>
          {row.map((k) => (
            <button
              key={k}
              className={`kb-key${k === 'SHIFT' || k === 'BACK' ? ' kb-wide' : ''}${k === 'SHIFT' && shift ? ' kb-active' : ''}`}
              onPointerDown={(e) => { e.preventDefault(); press(k) }}
            >
              {k === 'SHIFT' ? '⇧' : k === 'BACK' ? '⌫' : shift ? k.toUpperCase() : k}
            </button>
          ))}
        </div>
      ))}
      <div className="kb-row">
        <button className="kb-key kb-space" onPointerDown={(e) => { e.preventDefault(); onKey(' ') }}> </button>
        <button className="kb-key kb-done" onPointerDown={(e) => { e.preventDefault(); onDone() }}>{doneLabel}</button>
      </div>
      <style jsx>{`
        .kb { display: flex; flex-direction: column; gap: 8px; width: 100%; max-width: 1100px; margin: 0 auto; }
        .kb-row { display: flex; gap: 8px; justify-content: center; }
        .kb-key {
          flex: 1; max-width: 104px; height: 64px; font-size: 1.5rem;
          background: var(--surface); color: var(--text);
          border: 1px solid #2a323c; border-radius: 10px;
        }
        .kb-key:active { background: var(--accent); color: #04211b; }
        .kb-wide { max-width: 140px; }
        .kb-active { background: var(--accent); color: #04211b; }
        .kb-space { max-width: none; flex: 6; }
        .kb-done { flex: 2; max-width: 260px; background: var(--accent); color: #04211b; font-weight: 700; }
      `}</style>
    </div>
  )
}
