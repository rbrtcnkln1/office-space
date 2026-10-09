// Drives the real Office renderer through scripted scenes and writes one SVG
// per frame (plus a caption list) for build.py to rasterize and assemble.
//
//   bun scripts/media/frames.ts [outDir] [sceneName ...]
//
// Math.random is replaced by a seeded generator before every scene, so the
// same code always produces the same frames.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Office } from '../../plugin/hooks/office'
import type { AgentLike } from '../../plugin/hooks/office'

const OUT = process.argv[2] ?? join(import.meta.dir, '.work', 'frames')
const ONLY = process.argv.slice(3)

function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Remote = NonNullable<AgentLike['remote']>

/** A scene: an office, a list of agents, and a recorder that captures one frame per tick. */
class Scene {
  office = new Office()
  agents: AgentLike[] = []
  frames: Array<{ svg: string; caption: string }> = []
  caption = ''
  constructor(public name: string, seed: number) {
    Math.random = seeded(seed)
  }
  sync() { this.office.sync(this.agents.map(a => ({ ...a }))) }
  set(id: string, patch: Partial<AgentLike> & { remote?: Partial<Remote> }) {
    const a = this.agents.find(x => x.id === id || x.id === `ext:${id}`)
    if (!a) throw new Error(`no agent ${id}`)
    const { remote, ...rest } = patch
    Object.assign(a, rest)
    if (remote && a.remote) a.remote = { ...a.remote, ...remote }
    this.sync()
  }
  add(a: AgentLike) { this.agents.push(a); this.sync() }
  remove(id: string) { this.agents = this.agents.filter(a => a.id !== id); this.sync() }
  /** Advance `ticks` ticks (100 ms each), capturing a frame after each one. */
  run(ticks: number, caption?: string) {
    if (caption !== undefined) this.caption = caption
    for (let i = 0; i < ticks; i++) {
      this.office.step()
      this.frames.push({ svg: this.office.render(2), caption: this.caption })
    }
  }
  /** Run until `cond` holds (max `limit` ticks). */
  until(cond: () => boolean, limit: number, caption?: string) {
    if (caption !== undefined) this.caption = caption
    for (let i = 0; i < limit && !cond(); i++) this.run(1)
  }
}

const job = (id: string, description: string, status: AgentLike['status'] = 'running'): AgentLike =>
  ({ id, description, type: 'general-purpose', status })

const remote = (id: string, description: string, source: string, status: AgentLike['status'] = 'running', r: Partial<Remote> = {}): AgentLike =>
  ({ id: `ext:${id}`, name: id, description, type: 'remote', status, remote: { source, need: null, stale: false, ageMin: 0, ...r } })

const scenes: Record<string, () => Scene> = {
  // a. Hire day: an empty office, three subagents arrive, get briefed, sit, type.
  'hire-day'() {
    const s = new Scene('hire-day', 11)
    s.sync()
    s.run(5, 'An empty office. The Boss is at the desk.')
    s.add(job('a1', 'Write the login tests'))
    s.add(job('a2', 'Review the pull request'))
    s.add(job('a3', 'Research card routing'))
    s.run(1, 'Three subagents start. They come in through the door...')
    s.until(() => s.office.queue.length > 1, 80)
    s.until(() => [...s.office.workers.values()].some(w => w.carrying), 80, '...line up at the Boss and get briefed...')
    s.until(() => [...s.office.workers.values()].every(w => w.seated), 160, '...then each walks to a desk and sits.')
    s.run(18, 'And they get to work.')
    return s
  },

  // b. Hand-in: workers finish, walk to the Boss, packets fly (one failed), they leave.
  'hand-in'() {
    const s = new Scene('hand-in', 5)
    s.agents = [job('a1', 'Write the login tests'), job('a2', 'Review the pull request'), job('a3', 'Research card routing')]
    s.sync()
    s.run(6, 'Three workers are at their desks.')
    s.set('a1', { status: 'completed' })
    s.run(8, 'They finish and walk over to hand in the result...')
    s.set('a2', { status: 'failed' })
    s.run(8)
    s.set('a3', { status: 'completed' })
    s.until(() => s.office.packets.some(p => p.err), 220)
    s.run(10, 'A failed job goes in red.')
    s.until(() => s.office.workers.size === 0, 220, '...and then everyone heads out the door.')
    s.run(14, 'Every good hand-in updates Employee of the Day.')
    return s
  },

  // c. Remote crew: external workers need a person; one goes stale and fades.
  'remote-crew'() {
    const s = new Scene('remote-crew', 3)
    s.agents = [
      remote('backup', 'Copy photos to the NAS', 'cron'),
      remote('report', 'Weekly report', 'laptop'),
      remote('deploy', 'Ship the release', 'ci'),
      remote('build', 'Nightly build', 'server'),
    ]
    s.sync()
    s.run(14, 'Jobs outside Claude Code sit at a desk too, with a teal badge.')
    s.set('backup', { status: 'waiting', remote: { need: 'blocked', note: 'Disk is full, free some space' } })
    s.run(30, 'Blocked: a red ! stays up and the summary counts "needs you".')
    s.set('report', { status: 'waiting', remote: { need: 'waiting', note: 'Approve the draft' } })
    s.run(30, 'Waiting for a decision: a white ? and a note.')
    s.set('deploy', { remote: { stale: true, ageMin: 20 } })
    s.run(34, 'No update for a while: the worker fades and shows its age.')
    return s
  },

  // d. Break room: coffee, push-ups, and a bored Boss.
  'break-room'() {
    const s = new Scene('break-room', 9)
    s.agents = [job('a1', 'Write the login tests'), job('a2', 'Review the pull request')]
    s.sync()
    const o = s.office as any
    s.run(4, 'Even busy workers need a break.')
    o.takeBreak(o.workers.get('a1'), 'station')
    o.takeBreak(o.workers.get('a2'), 'gym')
    s.run(1, 'One gets coffee. One does push-ups.')
    s.until(() => s.office.lounging(), 120)
    s.run(60, 'The Boss, with nothing to do, kicks back and whistles.')
    s.until(() => [...s.office.workers.values()].every(w => w.seated), 300, 'Everyone drifts back to their desks.')
    s.run(10, 'Back to work, coffee in hand.')
    return s
  },
}

mkdirSync(OUT, { recursive: true })
for (const [name, make] of Object.entries(scenes)) {
  if (ONLY.length && !ONLY.includes(name)) continue
  const s = make()
  const dir = join(OUT, name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  s.frames.forEach((f, i) => writeFileSync(join(dir, `${String(i).padStart(4, '0')}.svg`), f.svg))
  writeFileSync(join(dir, 'captions.json'), JSON.stringify(s.frames.map(f => f.caption)))
  console.log(`${name}: ${s.frames.length} frames`)
}
