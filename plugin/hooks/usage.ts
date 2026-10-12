// Usage figures (context fill, plan limit windows, cost) as the office uses
// them: a tolerant reader for what `$.session.usage()` / `session.measure`
// give, and the plain-text summary behind /office-space-usage. Pure
// TypeScript: no `$`. A figure the host does not provide is left out, never
// guessed or zeroed.

export type Limit = { kind: string; pct: number; resetsAt?: number } // resetsAt: ms since epoch
export type UsageBoard = {
  ctxPct?: number // 0..100
  ctxTokens?: number
  ctxWindow?: number
  limits: Limit[]
  costUsd?: number
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)

/**
 * Whatever the host handed over -> the figures it actually has. Never throws;
 * anything malformed is simply absent. Null only when there is no object.
 */
export function toBoard(u: unknown): UsageBoard | null {
  const o = obj(u)
  if (!o) return null
  const board: UsageBoard = { limits: [] }
  const ctx = obj(o.context)
  if (ctx) {
    const tokens = num(ctx.tokens)
    const window = num(ctx.window)
    let pct = num(ctx.percent)
    if (pct === undefined && tokens !== undefined && window && window > 0) pct = (tokens / window) * 100
    if (pct !== undefined) board.ctxPct = Math.max(0, Math.min(100, Math.round(pct)))
    if (tokens !== undefined && tokens >= 0) board.ctxTokens = tokens
    if (window !== undefined && window > 0) board.ctxWindow = window
  }
  if (Array.isArray(o.rateLimits)) {
    for (const r of o.rateLimits.slice(0, 8)) {
      const l = obj(r)
      const pct = l ? num(l.percentUsed) : undefined
      if (!l || typeof l.kind !== 'string' || pct === undefined) continue
      const at = typeof l.resetsAt === 'string' ? new Date(l.resetsAt).getTime() : NaN
      board.limits.push({ kind: l.kind.slice(0, 40), pct: Math.max(0, pct), ...(Number.isFinite(at) ? { resetsAt: at } : {}) })
    }
  }
  const cost = obj(o.cost)
  const usd = cost ? num(cost.usd) : undefined
  if (usd !== undefined && usd >= 0) board.costUsd = usd
  return board
}

export const hasAnyUsage = (b: UsageBoard | null): boolean => !!b && (b.ctxPct !== undefined || b.ctxWindow !== undefined || b.limits.length > 0 || b.costUsd !== undefined)

/** The window a plan reports for a session (5 hours) and for a week. */
export const sessionLimit = (b: UsageBoard): Limit | undefined => b.limits.find(l => l.kind === 'five_hour')
export const weeklyLimit = (b: UsageBoard): Limit | undefined => b.limits.find(l => l.kind === 'seven_day')

export function limitLabel(kind: string): string {
  if (kind === 'five_hour') return 'Session limit (5 hours)'
  if (kind === 'seven_day') return 'Weekly limit'
  if (kind === 'spend_limit') return 'Spend limit'
  const t = kind.replace(/[^A-Za-z0-9]+/g, ' ').trim()
  return t ? `${t[0]?.toUpperCase()}${t.slice(1)} limit` : 'Limit'
}

/** 3h 50m, 2d 3h, 12m, under a minute. */
export function fmtSpan(ms: number): string {
  if (!Number.isFinite(ms) || ms < 60_000) return 'under a minute'
  const mins = Math.floor(ms / 60_000)
  const d = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  const m = mins % 60
  if (d) return `${d}d ${h}h`
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`
  return `${m}m`
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(Math.round(n))
}

const pctText = (p: number): string => `${Number.isInteger(p) ? p : p.toFixed(1)}%`

/** The /office-space-usage answer. Plain text, one line per figure the host has. */
export function usageText(b: UsageBoard | null, now: number): string {
  if (!hasAnyUsage(b) || !b) {
    return [
      'Usage',
      '  No usage figures yet. Context fill appears after the first reply; plan limits only appear on a subscription, after a reply that reports them.',
    ].join('\n')
  }
  const lines = ['Usage']
  if (b.ctxPct !== undefined) {
    const of = b.ctxTokens !== undefined && b.ctxWindow ? ` (${fmtTokens(b.ctxTokens)} of ${fmtTokens(b.ctxWindow)} tokens)` : ''
    lines.push(`  Context: ${pctText(b.ctxPct)} full${of}`)
  } else if (b.ctxWindow) {
    lines.push(`  Context: ${fmtTokens(b.ctxWindow)} token window, no reply measured yet`)
  }
  for (const l of b.limits) {
    const reset = l.resetsAt === undefined ? '' : l.resetsAt <= now ? ', reset time has passed' : `, resets in ${fmtSpan(l.resetsAt - now)}`
    lines.push(`  ${limitLabel(l.kind)}: ${pctText(l.pct)} used${reset}`)
  }
  if (b.costUsd !== undefined) lines.push(`  Cost this session: $${b.costUsd.toFixed(2)}`)
  return lines.join('\n')
}
