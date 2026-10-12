// Usage as office objects (see ./usage.ts for the figures): an in-tray on the
// Boss's desk for context fill, a wall clock for the session limit and a wall
// calendar for the weekly one. Pure SVG strings in logical pixels; a figure
// the host does not give is simply not drawn.

import { fmtSpan, sessionLimit, weeklyLimit } from './usage'
import type { Limit, UsageBoard } from './usage'

const FONT = 'font-family="ui-monospace,Menlo,monospace"'
const WEEKDAY = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

const heat = (pct: number): string => (pct >= 90 ? '#d9483b' : pct >= 70 ? '#e8b923' : '#3fae5a')
const num = (n: number): string => String(Math.round(n * 10) / 10)

/**
 * Wall clock (session limit) and wall calendar (weekly limit), hung on the
 * back wall from `x`. The clock's ring fills with the share used and its hands
 * show the reset time; the calendar shows the share used and the reset day.
 */
export function usageWall(b: UsageBoard | null, x: number, wallTop: number, now: number): string {
  if (!b) return ''
  const o: string[] = []
  const s = sessionLimit(b)
  const w = weeklyLimit(b)
  if (s) o.push(clock(s, x + 7, wallTop + 9, now))
  if (w) o.push(calendar(w, x + (s ? 48 : 0), wallTop + 1))
  return o.join('')
}

function clock(l: Limit, cx: number, cy: number, now: number): string {
  const pct = Math.max(0, Math.min(100, l.pct))
  const R = 5.4
  const C = 2 * Math.PI * R
  const o: string[] = []
  o.push(`<circle cx="${cx}" cy="${cy}" r="7" fill="#3a3f4f"/><circle cx="${cx}" cy="${cy}" r="6" fill="#f4f1e8"/>`)
  o.push(`<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="#d6d2c4" stroke-width="1.4"/>`)
  if (pct > 0) o.push(`<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${heat(l.pct)}" stroke-width="1.4" stroke-dasharray="${num((C * pct) / 100)} ${num(C)}" transform="rotate(-90 ${cx} ${cy})"/>`)
  if (l.resetsAt !== undefined) {
    const d = new Date(l.resetsAt)
    const mAng = (d.getMinutes() / 60) * 2 * Math.PI
    const hAng = (((d.getHours() % 12) + d.getMinutes() / 60) / 12) * 2 * Math.PI
    o.push(`<line x1="${cx}" y1="${cy}" x2="${num(cx + Math.sin(mAng) * 4)}" y2="${num(cy - Math.cos(mAng) * 4)}" stroke="#22304a" stroke-width="0.7"/>`)
    o.push(`<line x1="${cx}" y1="${cy}" x2="${num(cx + Math.sin(hAng) * 2.6)}" y2="${num(cy - Math.cos(hAng) * 2.6)}" stroke="#22304a" stroke-width="0.9"/>`)
  }
  o.push(`<rect x="${cx - 0.6}" y="${cy - 0.6}" width="1.2" height="1.2" fill="#22304a"/>`)
  const left = l.resetsAt === undefined ? '' : l.resetsAt <= now ? 'reset' : l.resetsAt - now < 60_000 ? '<1m' : fmtSpan(l.resetsAt - now).replace(' ', '')
  o.push(`<text x="${cx + 9}" y="${cy - 1}" ${FONT} font-size="3.4" font-weight="700" fill="#14202f">${Math.round(l.pct)}%</text>`)
  if (left) o.push(`<text x="${cx + 9}" y="${cy + 3.2}" ${FONT} font-size="2.8" fill="#14202f">${esc(left)}</text>`)
  return o.join('')
}

function calendar(l: Limit, x: number, y: number): string {
  const pct = Math.max(0, l.pct)
  const o: string[] = []
  o.push(`<rect x="${x}" y="${y}" width="17" height="18" fill="#3a3f4f"/><rect x="${x + 0.5}" y="${y + 0.5}" width="16" height="17" fill="#f4f1e8"/>`)
  o.push(`<rect x="${x + 0.5}" y="${y + 0.5}" width="16" height="4.4" fill="#c0392b"/>`)
  o.push(`<text x="${x + 8.5}" y="${y + 3.9}" text-anchor="middle" ${FONT} font-size="2.8" font-weight="700" fill="#ffffff">WEEK</text>`)
  o.push(`<text x="${x + 8.5}" y="${y + 11}" text-anchor="middle" ${FONT} font-size="5.2" font-weight="700" fill="#14202f">${Math.round(pct)}%</text>`)
  if (l.resetsAt !== undefined) o.push(`<text x="${x + 8.5}" y="${y + 14.4}" text-anchor="middle" ${FONT} font-size="2.4" fill="#33445f">reset ${WEEKDAY[new Date(l.resetsAt).getDay()] ?? ''}</text>`)
  o.push(`<rect x="${x + 1.5}" y="${y + 15.4}" width="14" height="1.2" fill="#d6d2c4"/><rect x="${x + 1.5}" y="${y + 15.4}" width="${num(Math.min(100, pct) * 0.14)}" height="1.2" fill="${heat(pct)}"/>`)
  return o.join('')
}

/** The in-tray (context fill): a paper stack that grows with the window and turns red near full. */
export function usageTray(b: UsageBoard | null, x: number, y: number): string {
  if (!b || b.ctxPct === undefined) return ''
  const pct = b.ctxPct
  const sheets = Math.max(1, Math.min(6, Math.ceil(pct / 17)))
  const o: string[] = []
  o.push(`<rect x="${x}" y="${y}" width="14" height="4" fill="#5b3b20"/><rect x="${x + 1}" y="${y + 1}" width="12" height="2" fill="#7a5230"/>`)
  for (let i = 0; i < sheets; i++) {
    const top = i === sheets - 1
    o.push(`<rect x="${x + 2 + (i % 2 ? 0.5 : 0)}" y="${y - 1 - i}" width="10" height="1" fill="${top ? (pct >= 90 ? '#f0b3ad' : pct >= 75 ? '#f7e3a1' : '#fffdf5') : '#e6e2d3'}"/>`)
  }
  o.push(`<text x="${x + 7}" y="${y + 7.4}" text-anchor="middle" ${FONT} font-size="3" font-weight="700" fill="#f4f1e8">${pct}%</text>`)
  return o.join('')
}

const esc = (s: string): string => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)
