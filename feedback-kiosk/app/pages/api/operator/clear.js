/** Operator: erase all stored feedback (explicit retention/erase
 * procedure, brief §6). */
import { clearResponses } from '../../../lib/db'
import { requirePin } from '../../../lib/operator-auth'

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  if (!requirePin(req, res)) return
  clearResponses()
  res.json({ cleared: true })
}
