// Drives the real Office renderer through scripted scenes and writes one SVG
// per frame (plus a caption list) for build.py to rasterize and assemble.
//
//   bun scripts/media/frames.ts [outDir] [sceneName ...]
//
// Math.random is replaced by a seeded generator before every scene, so the
// same code always produces the same frames.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { Office, portraitSvg } from '../../plugin/hooks/office'
import type { AgentLike } from '../../plugin/hooks/office'
import { DEFAULT_LOOK } from '../../plugin/hooks/catalog'
import type { BossLook } from '../../plugin/hooks/catalog'
import { gridProblem, libraryMap, makePart, resolveParts } from '../../plugin/hooks/parts'
import type { PartSlot } from '../../plugin/hooks/parts'
import { PRESETS } from '../../plugin/hooks/theme'
import type { Team } from '../../plugin/hooks/team'
import type { OfficeLook } from '../../plugin/hooks/decor'

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

  // e. Explainer: the README's top GIF. Captions starting with "@" are cards
  //    (title / end) that build.py draws over a darkened office frame.
  explainer() {
    const s = new Scene('explainer', 21)
    const o = s.office as any
    /** Show a caption for at least `min` ticks; first run until `cond` holds (max `limit`). */
    const beat = (caption: string, min: number, cond?: () => boolean, limit = 300) => {
      const start = s.frames.length
      s.caption = caption
      if (cond) s.until(cond, limit, caption)
      const left = min - (s.frames.length - start)
      if (left > 0) s.run(left, caption)
    }
    s.sync()
    beat('@title', 84)
    // 2. hire
    s.add(job('a1', 'Write the login tests'))
    s.add(job('a2', 'Review the pull request'))
    s.add(job('a3', 'Research card routing'))
    beat('Subagents start: they walk in, get briefed', 60, () => [...s.office.workers.values()].every(w => w.seated), 300)
    // 3. work (+ coffee)
    o.takeBreak(o.workers.get('a2'), 'station')
    beat('They sit down and work while you keep chatting', 96)
    // 4. hand-in
    s.set('a1', { status: 'completed' })
    s.run(8, 'Done? They hand the result back to the Boss')
    s.set('a2', { status: 'failed' })
    s.run(8)
    s.set('a3', { status: 'completed' })
    beat('Done? They hand the result back to the Boss', 70, () => s.office.workers.size === 0, 260)
    // 5. remote
    s.add(remote('backup', 'Copy photos to the NAS', 'cron'))
    s.add(remote('report', 'Weekly report', 'laptop'))
    s.add(remote('build', 'Nightly build', 'server'))
    beat('Jobs on other machines can clock in too', 80)
    // 6. blocked
    s.set('backup', { status: 'waiting', remote: { need: 'blocked', note: 'Disk is full, free some space' } })
    beat('Red ! = a human is needed', 80)
    beat('@end', 110)
    return s
  },

  // f. Boss makeover: the Boss cycles through looks. Left is always the default
  //    Boss, right is the new look, with a little puff of smoke at each change.
  //    The drawn cowboy hat is the hand-made example in examples/drawn-parts.json.
  'boss-makeover'() {
    const s = new Scene('boss-makeover', 31)
    const raw = JSON.parse(readFileSync(new URL('../../examples/drawn-parts.json', import.meta.url), 'utf8')) as { name: string; slot: PartSlot; rows: string[] }[]
    const parts = raw.map(p => {
      const why = gridProblem(p.slot, p.rows)
      if (why) throw new Error(`${p.name}: ${why}`)
      return makePart(p.name, p.slot, p.rows)
    })
    const lib = libraryMap(parts)
    const id = (name: string) => (parts.find(p => p.name === name) as { id: string }).id
    const fig = (look: BossLook) => {
      const p = resolveParts(look.parts, lib)
      return { role: 'boss' as const, look, ...(p ? { parts: p } : {}) }
    }
    const looks: { look: BossLook; caption: string }[] = [
      { look: { ...DEFAULT_LOOK }, caption: 'The Boss, as shipped.' },
      { look: { hair: 'frosted', hairColor: 'pink', outfit: 'early-2000s', accessory: 'headphones' }, caption: '/office-space-boss pink frosted hair and a track jacket' },
      { look: { hair: 'short', hairColor: 'gray', outfit: 'tee', accessory: 'headphones', top: 'white', bottom: 'denim' }, caption: '/office-space-boss silver hair, a white tee, jeans, headphones' },
      { look: { hair: 'short', hairColor: 'gray', outfit: 'tee', accessory: 'headphones', top: 'white', bottom: 'denim', parts: { hat: id('cowboy hat'), shoes: id('white sneakers') } }, caption: '/office-space-boss a cowboy hat  (Draw it)' },
    ]
    const SCALE = 14
    const puff = (n: number) => {
      const cx = 36, cy = 14
      const dots = [[-6, -2], [6, -3], [-4, 6], [5, 5], [0, -8], [-8, 3], [8, 2]]
      return dots.map(([dx, dy], i) => `<circle cx="${cx + (dx as number) * (0.5 + n * 0.35)}" cy="${cy + (dy as number) * (0.5 + n * 0.35)}" r="${1.2 + n * 0.9 - (i % 2) * 0.5}" fill="#fff" opacity="${0.95 - n * 0.2}"/>`).join('')
    }
    const frame = (look: BossLook, caption: string, smoke = -1) => {
      let svg = portraitSvg([fig(DEFAULT_LOOK), fig(look)], SCALE)
      if (smoke >= 0) svg = svg.replace('</svg>', `${puff(smoke)}</svg>`)
      s.frames.push({ svg, caption })
    }
    looks.forEach((l, i) => {
      if (i > 0) for (let n = 0; n < 4; n++) frame(l.look, l.caption, n)
      for (let n = 0; n < (i === 0 ? 20 : 26); n++) frame(l.look, l.caption)
    })
    for (let n = 0; n < 4; n++) frame(DEFAULT_LOOK, '/office-space-boss reset', n)
    for (let n = 0; n < 16; n++) frame(DEFAULT_LOOK, '/office-space-boss reset')
    return s
  },

  // g. Office makeover: decorate step by step, then a worker visits the vending machine.
  'office-makeover'() {
    const s = new Scene('office-makeover', 17)
    const o = s.office as any
    s.agents = [job('a1', 'Build the new feature'), job('a2', 'Write the docs'), job('a3', 'Review the open pull request')]
    s.sync()
    for (let i = 0; i < 90; i++) s.office.step()
    const look: OfficeLook = { wall: 'slate', floor: 'slate-tiles', items: {} }
    const apply = (caption: string, patch: Partial<OfficeLook>, items: Record<string, string> = {}, ticks = 14) => {
      s.office.decor = { ...look, ...patch, items: { ...look.items, ...items } }
      Object.assign(look, s.office.decor)
      s.run(ticks, caption)
    }
    s.run(16, 'The plain office.')
    apply('/office-space-office teal walls', { wall: 'teal' })
    apply('/office-space-office an oak plank floor', { floor: 'oak-planks' })
    apply('/office-space-office a vending machine', {}, { break: 'vending-machine' })
    apply('/office-space-office an arcade cabinet', {}, { 'bottom-1': 'arcade-cabinet' })
    apply('/office-space-office a couch', {}, { 'bottom-3': 'couch' })
    apply('/office-space-office a lava lamp', {}, { 'bottom-4': 'lava-lamp' })
    apply('/office-space-office a fish tank', {}, { 'bottom-5': 'fish-tank' }, 20)
    apply('And a rocket poster by the door', {}, { 'wall-door': 'poster-rocket' }, 14)
    const w = o.workers.get('a2')
    o.takeBreak(w, 'vending')
    s.run(2, 'The vending machine works: workers walk over on breaks...')
    s.until(() => w.activity === 'vending', 120)
    s.run(26, '...feed it a coin...')
    s.until(() => !!w.item, 80, '...and come back with a snack.')
    s.until(() => w.seated, 200)
    s.run(24, '...and come back with a snack.')
    return s
  },

  // h. Themes: the same office flips between the three built-in presets.
  themes() {
    const s = new Scene('themes', 23)
    const o = s.office as any
    const t = (id: string, description: string) => ({ id, description, type: 'general-purpose', status: 'running' }) as AgentLike
    s.agents = [t('a1', 'Build the new feature'), t('a2', 'Write the docs'), t('a3', 'Review the open pull request'), t('a4', 'Research card routing'), t('a5', 'Plan the roadmap')]
    s.sync()
    for (let i = 0; i < 100; i++) s.office.step()
    s.run(18, 'The plain office.')
    for (const p of PRESETS) {
      o.bossLook = p.boss
      s.office.setTeam(p.team as Team | undefined)
      s.office.decor = p.office
      s.run(46, `/office-space-theme load ${p.name}`)
    }
    o.bossLook = undefined
    s.office.setTeam(undefined)
    s.office.decor = undefined
    s.run(30, '/office-space-theme reset')
    return s
  },

  // i. Team: roles renamed and restyled, long tasks wrapping under the desks.
  team() {
    const s = new Scene('team', 41)
    const t = (id: string, description: string) => ({ id, description, type: 'general-purpose', status: 'running' }) as AgentLike
    s.agents = [
      t('c1', 'Implement the new payments feature with saved cards and receipts'),
      t('c2', 'Write the welcome guide for new teammates joining this month'),
      t('c3', 'Review the open pull request'),
      t('c4', 'Research card routing across regions'),
      t('c5', 'Plan the roadmap'),
    ]
    s.sync()
    for (let i = 0; i < 110; i++) s.office.step()
    const team: Team = { titles: {}, looks: {} }
    const set = (caption: string, f: (t: Team) => void, ticks = 36) => {
      f(team)
      s.office.setTeam(JSON.parse(JSON.stringify(team)))
      s.run(ticks, caption)
    }
    s.run(20, 'The built-in team.')
    set('/office-space-team call the Coder "Mx. Bytes"', t => { t.titles.coder = 'Mx. Bytes' })
    set('/office-space-team give the Writer a cardigan and a scarf', t => { t.titles.writer = 'Scribe'; t.looks.writer = { outfit: 'cardigan', accessory: 'scarf' } })
    set('/office-space-team Coder: curly pink hair, navy hoodie, headphones', t => { t.looks.coder = { hair: 'curly', hairColor: 'pink', outfit: 'hoodie', top: 'navy', accessory: 'headphones' } })
    set('/office-space-team the Reviewer: blue hair and a cap', t => { t.titles.reviewer = 'Nitpicker'; t.looks.reviewer = { hairColor: 'blue', accessory: 'cap' } })
    s.run(50, 'Long tasks wrap onto two lines under each desk.')
    set('/office-space-team Researcher: purple top, denim trousers', t => { t.looks.researcher = { outfit: 'tee', top: 'purple', bottom: 'denim' } })
    set('/office-space-team call the Planner "Librarian", give them a bob', t => { t.titles.planner = 'Librarian'; t.looks.planner = { hair: 'bob', outfit: 'lab-coat' } }, 50)
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
