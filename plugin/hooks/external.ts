// External workers: work running outside this session (another machine,
// another CLI, a cron job) that shows up in the office through a watched
// directory. Pure TypeScript: no `$` in here; ./register.tsx does the reading.
//
// The contract: one JSON file per worker in the workers directory
// (default ~/.claude/office-space/workers/), written by any script:
//
//   { "id": "nightly-backup", "name": "Backup bot", "status": "working",
//     "task": "Copying photos to the NAS", "updated": "2026-10-08T14:03:00Z",
//     "source": "cron", "note": "optional: what a human needs to do",
//     "scope": "~/projects/backup" }
//
// status is one of working | waiting | blocked | done | failed. Only `status`
// is required; `id` falls back to the file name, `updated` to the file's
// modification time (also used when `updated` is more than 5 minutes ahead).
// `scope` (optional string or array of absolute folders, `~` allowed) limits the worker to sessions whose
// working folder is inside one of them; a malformed scope skips the worker. The mod only ever reads the directory.

import type { AgentLike, AgentStatus } from './office'

export const DEFAULT_DIR = '~/.claude/office-space/workers'
export const DEFAULT_STALE_MINUTES = 15
export const LEAVE_AFTER_STALE = 4 // a worker this many staleness periods old has gone home
export const MAX_FILE_BYTES = 64 * 1024
export const MAX_WORKERS = 40
export const FUTURE_SKEW_MS = 5 * 60_000

export type ExternalStatus = 'working' | 'waiting' | 'blocked' | 'done' | 'failed'
const STATUSES: ReadonlySet<string> = new Set(['working', 'waiting', 'blocked', 'done', 'failed'])

export type ExternalWorker = {
  id: string
  name: string
  status: ExternalStatus
  task: string
  updated: number // ms since epoch
  source: string
  note?: string
  scope?: string[] // absolute folders (`~` allowed); absent = shown everywhere
}

/** What the office needs to draw a remote worker differently. */
export type RemoteInfo = {
  source: string
  need: 'waiting' | 'blocked' | null // a human is needed
  stale: boolean
  ageMin: number
  note?: string
}

const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff\ufff9-\uffff]+/g
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g

/**
 * Text that is safe to draw anywhere: control characters, zero-width and
 * bidirectional marks, noncharacters and lone surrogates become spaces, runs
 * of spaces collapse, the ends are trimmed. Emoji and accents are untouched.
 */
export function sanitize(s: string): string {
  let t = String(s)
  const wf = (t as { toWellFormed?: () => string }).toWellFormed
  t = typeof wf === 'function' ? wf.call(t) : t.replace(LONE_SURROGATE, ' ')
  return t.replace(UNSAFE, ' ').replace(/ {2,}/g, ' ').trim()
}

const clean = (v: unknown, max: number): string =>
  typeof v === 'string' || typeof v === 'number' ? sanitize(String(v)).slice(0, max).trim() : ''

/**
 * One file's text → a worker, or null when it is not a usable worker file.
 * Never throws: malformed JSON, wrong types and unknown statuses are null.
 */
export function parseWorker(text: string, file: string, mtimeMs = 0): ExternalWorker | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const status = clean(o.status, 16).toLowerCase()
  if (!STATUSES.has(status)) return null
  const id = clean(o.id, 64) || file.replace(/\.json$/i, '')
  if (!id) return null
  const parsed = typeof o.updated === 'string' || typeof o.updated === 'number' ? new Date(o.updated as string | number).getTime() : NaN
  // A timestamp more than 5 minutes ahead of this machine's clock cannot keep a worker alive forever: use the file's time.
  const updated = Number.isFinite(parsed) && parsed <= Date.now() + FUTURE_SKEW_MS ? parsed : mtimeMs
  if (!updated) return null
  const note = clean(o.note, 120)
  const scope = parseScope(o.scope)
  if (scope === null) return null // malformed scope: skip the worker rather than show it everywhere
  return {
    id,
    name: clean(o.name, 40) || id,
    status: status as ExternalStatus,
    task: clean(o.task, 120),
    updated,
    source: clean(o.source, 16) || 'remote',
    ...(note ? { note } : {}),
    ...(scope ? { scope } : {}),
  }
}

export const MAX_SCOPES = 16
const MAX_SCOPE_CHARS = 512

/**
 * A worker's `scope` field → absolute-looking folder strings, undefined when
 * absent, null when malformed (wrong type, empty, too many, not absolute).
 */
export function parseScope(v: unknown): string[] | undefined | null {
  if (v === undefined) return undefined
  const list = typeof v === 'string' ? [v] : Array.isArray(v) ? v : null
  if (!list || list.length === 0 || list.length > MAX_SCOPES) return null
  const out: string[] = []
  for (const item of list) {
    if (typeof item !== 'string') return null
    const t = item.trim()
    if (!t || t.length > MAX_SCOPE_CHARS || !(t === '~' || t.startsWith('~/') || t.startsWith('/'))) return null
    out.push(t)
  }
  return out
}

/** `~` → home, then fold `.`/`..`/repeated slashes and drop trailing slashes. */
export function normalizePath(p: string, home?: string): string {
  let d = p.trim()
  if (d === '~' || d.startsWith('~/')) d = (home ?? '') + d.slice(1)
  const parts: string[] = []
  for (const seg of d.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return '/' + parts.join('/')
}

/** The scope folders a worker names, expanded (not yet resolved through links). */
export const scopePaths = (scope: string[], home?: string): string[] => scope.map(s => normalizePath(s, home))

/**
 * Should a worker with this scope be shown in a session working in `cwd`?
 * No scope: yes. Scope but no known cwd (or no home for a `~` scope): no, fail
 * closed. Otherwise cwd must equal a scope folder or sit under it, on a
 * path-segment boundary. `real` maps a folder to its link-resolved path
 * (pass the same function for cwd and scope entries); default is identity.
 */
export function inScope(
  scope: string[] | undefined,
  cwd: string | undefined,
  home?: string,
  real: (p: string) => string = p => p,
): boolean {
  if (!scope) return true
  if (!cwd || !cwd.startsWith('/')) return false
  const here = real(normalizePath(cwd))
  for (const s of scope) {
    if ((s === '~' || s.startsWith('~/')) && !home) continue
    const root = real(normalizePath(s, home))
    if (root === '/' || here === root || here.startsWith(root + '/')) return true
  }
  return false
}

const STATUS_MAP: Record<ExternalStatus, AgentStatus> = {
  working: 'running',
  waiting: 'waiting',
  blocked: 'waiting',
  done: 'completed',
  failed: 'failed',
}

/**
 * Workers → the office's agent rows. Duplicated ids keep the newest entry;
 * entries older than LEAVE_AFTER_STALE × staleness are left out (so they walk
 * out); entries older than the staleness are marked stale (drawn faded).
 */
export function toAgents(workers: ExternalWorker[], now: number, staleMinutes = DEFAULT_STALE_MINUTES): AgentLike[] {
  const staleMs = Math.max(1, staleMinutes) * 60_000
  const newest = new Map<string, ExternalWorker>()
  for (const w of workers) {
    const had = newest.get(w.id)
    if (!had || w.updated > had.updated) newest.set(w.id, w)
  }
  const out: AgentLike[] = []
  for (const w of [...newest.values()].sort((a, b) => b.updated - a.updated)) {
    if (w.updated > now + FUTURE_SKEW_MS) continue // never let a future time pin a worker to the desk
    const age = Math.max(0, now - w.updated)
    if (age > staleMs * LEAVE_AFTER_STALE) continue
    const need = w.status === 'waiting' || w.status === 'blocked' ? w.status : null
    out.push({
      id: `ext:${w.id}`,
      name: w.name,
      description: w.task || w.name,
      type: 'remote',
      status: STATUS_MAP[w.status],
      remote: { source: w.source, need, stale: age > staleMs, ageMin: Math.floor(age / 60_000), ...(w.note ? { note: w.note } : {}) },
    })
    if (out.length >= MAX_WORKERS) break
  }
  return out
}

/** `~/x` → `<home>/x`; trailing slashes dropped. */
export function expandDir(dir: string, home: string | undefined): string {
  let d = dir.trim() || DEFAULT_DIR
  if (d === '~' || d.startsWith('~/')) d = (home ?? '') + d.slice(1)
  return d.length > 1 ? d.replace(/\/+$/, '') : d
}

/** Which directory entries are worker files: *.json, not hidden (temp files from atomic writes). */
export const isWorkerFile = (name: string) => /\.json$/i.test(name) && !name.startsWith('.')
