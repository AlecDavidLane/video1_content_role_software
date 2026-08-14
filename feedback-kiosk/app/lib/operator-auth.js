/** Operator PIN check. The hash+salt are deployed in the event config
 * (from a vaulted Ansible variable) - the PIN itself never lands on
 * disk. Empty hash = operator endpoints disabled (fail closed). */
import crypto from 'node:crypto'
import { loadConfig } from './config'

export function checkPin(pin) {
  const { config } = loadConfig()
  const { pin_hash: hash, pin_salt: salt } = config.operator
  if (!hash || !salt || typeof pin !== 'string') return false
  const candidate = crypto
    .createHash('sha256')
    .update(`${salt}:${pin}`)
    .digest('hex')
  return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(hash))
}

export function requirePin(req, res) {
  const pin = req.headers['x-operator-pin'] || req.query.pin || ''
  if (!checkPin(pin)) {
    res.status(401).json({ error: 'operator PIN required' })
    return false
  }
  return true
}
