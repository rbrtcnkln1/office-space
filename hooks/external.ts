// External workers: work running outside this session (another machine,
// another CLI, a cron job) that shows up in the office through a watched
// directory. Pure TypeScript: no `$` in here; ./register.tsx does the reading.
//
// The contract: one JSON file per worker in the workers directory
// (default ~/.claude/office-space/workers/), written by any script:
//
//   { "id": "nightly-backup", "name": "Backup bot", "status": "working",
//     "task": "Copying photos to the NAS", "updated": "2026-10-08T14:03:00Z",
//     "source": "cron", "note": "optional: what a human needs to do" }
//
// status is one of working | waiting | blocked | done | failed. Only `status`
// is required; `id` falls back to the file name, `updated` to the file's
// modification time. The mod only ever reads the directory.

import type { AgentLike, AgentStatus } from './office'

export const DEFAULT_DIR = '~/.claude/office-space/workers'
export const DEFAULT_STALE_MINUTES = 15
export const LEAVE_AFTER_STALE = 4 // a worker this many staleness periods old has gone home
export const MAX_FILE_BYTES = 64 * 1024
export const MAX_WORKERS = 40

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
}

/** What the office needs to draw a remote worker differently. */
export type RemoteInfo = {
  source: string
  need: 'waiting' | 'blocked' | null // a human is needed
  stale: boolean
  ageMin: number
  note?: string
}

const clean = (v: unknown, max: number): string =>
  typeof v === 'string' || typeof v === 'number' ? String(v).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max) : ''

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
  const updated = Number.isFinite(parsed) ? parsed : mtimeMs
  if (!updated) return null
  const note = clean(o.note, 120)
  return {
    id,
    name: clean(o.name, 40) || id,
    status: status as ExternalStatus,
    task: clean(o.task, 120),
    updated,
    source: clean(o.source, 16) || 'remote',
    ...(note ? { note } : {}),
  }
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
