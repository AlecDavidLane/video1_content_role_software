/** Operator export: CSV or JSON of every stored response (brief §6). */
import { allResponses } from '../../../lib/db'
import { requirePin } from '../../../lib/operator-auth'

function csvEscape(value) {
  if (value === null || value === undefined) return ''
  const s = String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export default function handler(req, res) {
  if (!requirePin(req, res)) return
  const rows = allResponses()
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  if ((req.query.format || 'csv') === 'json') {
    res.setHeader('Content-Disposition', `attachment; filename=feedback-${stamp}.json`)
    return res.json({ exported_at: new Date().toISOString(), responses: rows })
  }
  const cols = rows.length ? Object.keys(rows[0]) : ['response_id']
  const csv = [
    cols.join(','),
    ...rows.map((r) => cols.map((c) => csvEscape(r[c])).join(',')),
  ].join('\n')
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename=feedback-${stamp}.csv`)
  res.send(csv)
}
