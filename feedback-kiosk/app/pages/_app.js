import '../styles/globals.css'
import { useEffect } from 'react'

export default function App({ Component, pageProps }) {
  // Kiosk lockdown (brief §4): no context menu, no pinch zoom, no
  // text-selection drag, no accidental browser navigation.
  useEffect(() => {
    const block = (e) => e.preventDefault()
    const blockZoomKeys = (e) => {
      if ((e.ctrlKey || e.metaKey) && ['+', '-', '=', '0'].includes(e.key)) e.preventDefault()
    }
    const blockWheelZoom = (e) => { if (e.ctrlKey) e.preventDefault() }
    document.addEventListener('contextmenu', block)
    document.addEventListener('dragstart', block)
    document.addEventListener('keydown', blockZoomKeys)
    document.addEventListener('wheel', blockWheelZoom, { passive: false })
    return () => {
      document.removeEventListener('contextmenu', block)
      document.removeEventListener('dragstart', block)
      document.removeEventListener('keydown', blockZoomKeys)
      document.removeEventListener('wheel', blockWheelZoom)
    }
  }, [])
  return <Component {...pageProps} />
}
