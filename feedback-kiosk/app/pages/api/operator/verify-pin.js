/** PIN check for the operator UI (5-tap corner gesture -> PIN pad). */
import { checkPin } from '../../../lib/operator-auth'

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  res.json({ ok: checkPin((req.body || {}).pin || '') })
}
