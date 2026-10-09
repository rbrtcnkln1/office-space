// The office: desk layout, worker/boss state machines, walking, the handoff
// queue, and the SVG renderer. Pure TypeScript: no `$` in here.
//
// Lifecycle of a worker (one background agent):
//   arrives through the door -> lines up at the Boss -> receives its assignment
//   -> walks to an empty desk and sits -> works -> stands, walks back to the
//   Boss, hands in the result -> walks out the door; the desk empties again.

import {
  BUBBLE_ASK, BUBBLE_DOTS, BUBBLE_STOP, CHECK, PACKET_ERR, PACKET_OK, ROLES, character, feetUp, grid, icon, outline, paletteFor, pushup, roleFor,
} from './sprites'
import type { Dir, Grid, Palette, RoleId } from './sprites'
import type { RemoteInfo } from './external'

// ---------- Tunables ----------

export const SCALE = 2 // CSS px per logical pixel at natural size
const MIN_DESKS = 5 // always at least this many desks
const SPARE_DESKS = 2 // keep this many empty desks for newcomers
const CELL_W = 64
const ROW_H = 50
const MARGIN = 24 // walking corridor down each side
const BOSS_W = 96
const TOP = 34 // title line + back wall with the door
const WALL_TOP = 10
const WALL_BOTTOM = 30
const BREAK_CHANCE_IDLE = 1 / 500 // per tick, per seated idle/waiting worker
const BREAK_CHANCE_BUSY = 1 / 2400 // per tick, per seated working worker
const SPEED = 4 // logical px per tick while walking (tick = 100ms)
const SLOW = 3 // failed workers trudge
const REACH_TICKS = 6
const REACT_TICKS = 10
const AMBIENT_CHANCE = 1 / 140

// A background agent that finishes goes 'idle' (resumable), so idle counts as done here.
export const ACTIVE = new Set(['pending', 'running', 'waiting'])
export const FLOOR = '#8ea1ba'

// ---------- Types ----------

export type AgentStatus = 'pending' | 'running' | 'waiting' | 'idle' | 'completed' | 'failed' | 'killed'
export type AgentLike = { id: string; name?: string; description: string; type: string; status: AgentStatus; remote?: RemoteInfo }

type Pt = { x: number; y: number } // sprite top-left, logical px
type WorkerState =
  | 'arriving' | 'queued' | 'briefed' | 'to-desk' | 'idle' | 'working' | 'waiting'
  | 'finishing' | 'walking-to-boss' | 'handoff' | 'leaving'

type Step =
  | { k: 'walk'; path: Pt[]; speed: number }
  | { k: 'queue' }
  | { k: 'reach'; ticks: number; err: boolean; toBoss: boolean; targetId?: string }
  | { k: 'receive'; ticks: number }
  | { k: 'pause'; ticks: number }
  | { k: 'activity'; kind: Activity; ticks: number }
  | { k: 'do'; fn: () => void }

export type Activity = 'cooler' | 'trash' | 'gym' | 'chat' | 'station'
export type Item = 'coffee' | 'tea' | 'water' | 'soda' | 'donut' | 'cookie'
const STATION_ITEMS: Item[] = ['coffee', 'coffee', 'tea', 'soda', 'donut', 'cookie']
const BOSS_ERRAND_CHANCE = 1 / 700 // per tick while the Boss is free
const SIP_TICKS = 70
const LOUNGE_AFTER = 30 // ticks of nothing to do before the Boss kicks back
const IDLE_WORDS = [
  'whistling', 'daydreaming', 'whimsically', 'wishing on a stapler', 'sleeping with eyes open',
  'twiddling thumbs', 'counting ceiling tiles', 'humming elevator music', 'pondering lunch',
  'admiring the plant', 'practicing finger guns', 'contemplating the void', 'reorganizing paperclips',
  'composing a haiku', 'dreaming of Fridays', 'spinning in the chair', 'thinking about synergy',
]
const NOTE_ROWS = ['..nn', '..nn', '..n.', '..n.', 'nnn.', 'nnn.']

const ITEM_ROWS: Record<Item, string[]> = {
  coffee: ['.cccc...', 'wwwwww..', 'wwwww.w.', 'wwwww.w.', 'wwwwww..', '.wwww...'],
  tea: ['..g.....', '.wgww...', 'wwwwww..', 'wwwww.w.', 'wwwwww..', '.wwww...'],
  water: ['b....b..', 'bBBBBb..', 'bBBBBb..', '.bBBb...', '.bbbb...'],
  soda: ['.XX.....', 'rrrr....', 'rWWr....', 'rrrr....', 'rWWr....', 'rrrr....'],
  donut: ['.pppp...', 'pp..pp..', 'tt..tt..', '.tttt...'],
  cookie: ['.tttt...', 'tytytt..', 'ttttyt..', '.tttt...'],
}

type Actor = { pos: Pt; facing: Dir; seated: boolean; plan: Step[]; walkFrame: number; reaching: boolean; carrying: boolean }

type Worker = Actor & {
  id: string
  name?: string
  label: string
  role: RoleId
  status: AgentStatus
  state: WorkerState
  desk: number // slot index, -1 when none
  seed: number
  ambientUntil: number
  seatedOnce: boolean
  ending: boolean
  hidden: boolean // behind the door
  activity: Activity | null
  item: Item | null // a drink or snack in hand
  sipUntil: number
  remote?: RemoteInfo // an external worker (see ./external.ts)
}

type Boss = Actor & {
  react: 'ack' | 'err' | null; reactUntil: number; ambientUntil: number; missions: string[]
  errand: boolean; atStation: boolean; item: Item | null; sipUntil: number; idleTicks: number
}

type Packet = { from: Pt; to: Pt; t: number; dur: number; err: boolean }

// ---------- Helpers ----------

function hash(s: string): number {
  let h = 0
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h
}
const short = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
// control characters are invalid in XML and would break the whole drawing
const esc = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)

/** Grid → one <path> per colour, each pixel run a tiny rect. Cached per key. */
const pathCache = new Map<string, string>()
function gridSvg(key: string, g: Grid, pal: Palette): string {
  const hit = pathCache.get(key)
  if (hit !== undefined) return hit
  const byColour = new Map<string, string[]>()
  g.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const k = row[x] as string
      if (k === '.') { x++; continue }
      let len = 1
      while (x + len < row.length && row[x + len] === k) len++
      const fill = pal[k] ?? '#ff00ff'
      const list = byColour.get(fill) ?? []
      list.push(`M${x} ${y}h${len}v1h-${len}z`)
      byColour.set(fill, list)
      x += len
    }
  })
  const out = [...byColour.entries()].map(([fill, d]) => `<path fill="${fill}" d="${d.join('')}"/>`).join('')
  if (pathCache.size > 600) pathCache.clear()
  pathCache.set(key, out)
  return out
}
/** The floor-tile seams, rebuilt only when the floor changes size. */
let seamsKey = ''
let seamsSvg = ''
function floorSeams(W: number, H: number): string {
  if (seamsKey === `${W}x${H}`) return seamsSvg
  const d: string[] = []
  for (let x = 16; x < W; x += 16) d.push(`M${x} 0h1v${H}h-1z`)
  for (let y = 16; y < H; y += 16) d.push(`M0 ${y}h${W}v1h-${W}z`)
  seamsKey = `${W}x${H}`
  seamsSvg = `<path fill="#97a9c1" d="${d.join('')}"/>`
  return seamsSvg
}
const place = (x: number, y: number, inner: string) => `<g transform="translate(${Math.round(x)} ${Math.round(y)})">${inner}</g>`

// ---------- Furniture grids ----------

function deskGrid(width: number): Grid {
  const g = grid(width, 14)
  for (let x = 0; x < width; x++) { (g[0] as string[])[x] = 'd'; (g[1] as string[])[x] = 'D'; for (let y = 2; y < 6; y++) (g[y] as string[])[x] = 'q' }
  for (let y = 6; y < 13; y++) { (g[y] as string[])[2] = 'q'; (g[y] as string[])[3] = 'q'; (g[y] as string[])[width - 3] = 'q'; (g[y] as string[])[width - 4] = 'q' }
  return outline(pad1(g))
}
function chairGrid(): Grid {
  const g = grid(14, 12)
  for (let y = 0; y < 9; y++) for (let x = 0; x < 14; x++) (g[y] as string[])[x] = x > 10 ? 'z' : 'Z'
  for (let y = 9; y < 12; y++) { (g[y] as string[])[6] = 'z'; (g[y] as string[])[7] = 'z' }
  return outline(pad1(g))
}
function monitorGrid(screen: 'on' | 'off' | 'err' | 'done', frame: number, code: boolean): Grid {
  const g = grid(12, 12)
  for (let y = 0; y < 9; y++) for (let x = 0; x < 12; x++) (g[y] as string[])[x] = 'T'
  const s = screen === 'on' ? 'N' : screen === 'err' ? 'R' : 'n'
  for (let y = 1; y < 8; y++) for (let x = 1; x < 11; x++) (g[y] as string[])[x] = s
  if (screen === 'on') {
    for (let r = 0; r < 3; r++) {
      const len = 2 + ((frame * 3 + r * 5) % (code ? 7 : 5))
      for (let x = 2; x < 2 + len && x < 10; x++) (g[2 + r * 2] as string[])[x] = code && (x + r + frame) % 3 === 0 ? 'Y' : 'W'
    }
  }
  if (screen === 'done') { (g[4] as string[])[4] = 'V'; (g[5] as string[])[5] = 'V'; (g[4] as string[])[6] = 'V'; (g[3] as string[])[7] = 'V' }
  for (let y = 9; y < 11; y++) { (g[y] as string[])[5] = 't'; (g[y] as string[])[6] = 't' }
  for (let x = 3; x < 9; x++) (g[11] as string[])[x] = 't'
  return outline(pad1(g))
}
function keyboardGrid(): Grid {
  const g = grid(12, 2)
  for (let x = 0; x < 12; x++) { (g[0] as string[])[x] = 'X'; (g[1] as string[])[x] = 'x' }
  return g
}
function laptopGrid(open: boolean): Grid {
  const g = grid(16, 9)
  if (open) {
    for (let y = 0; y < 7; y++) for (let x = 1; x < 15; x++) (g[y] as string[])[x] = y === 0 || x === 1 || x === 14 ? 'x' : 'X'
    ;(g[3] as string[])[7] = 'W'; (g[3] as string[])[8] = 'W'
  }
  for (let x = 0; x < 16; x++) (g[7] as string[])[x] = 'X'
  for (let x = 0; x < 16; x++) (g[8] as string[])[x] = 'x'
  return outline(pad1(g))
}
function plantGrid(): Grid {
  const rows = ['..g.g.', '.gjggg', 'gggjg.', '.gjgg.', '..uu..', '.uuuu.', '.uuuu.']
  const g = grid(6, 7)
  rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch !== '.') (g[y] as string[])[x] = ch }))
  return outline(pad1(g))
}
function pad1(g: Grid): Grid {
  const w = (g[0]?.length ?? 0) + 2
  const out = grid(w, g.length + 2)
  g.forEach((r, y) => r.forEach((ch, x) => { (out[y + 1] as string[])[x + 1] = ch }))
  return out
}

const FURN_PAL = paletteFor('boss')
const STATIC = {
  desk: gridSvg('desk', deskGrid(54), FURN_PAL),
  bossDesk: gridSvg('bossdesk', deskGrid(86), FURN_PAL),
  chair: gridSvg('chair', chairGrid(), FURN_PAL),
  keyboard: gridSvg('kb', keyboardGrid(), FURN_PAL),
  plant: gridSvg('plant', plantGrid(), FURN_PAL),
}

// ---------- The office ----------

export class Office {
  workers = new Map<string, Worker>()
  desks: Array<string | null> = Array.from({ length: MIN_DESKS }, () => null)
  cols = MIN_DESKS
  boss: Boss
  queue: string[] = []
  packets: Packet[] = []
  tick = 0
  bossWorking = false
  private initialized = false

  constructor() {
    const seat = this.bossSeat()
    this.boss = { pos: seat, facing: 'down', seated: true, plan: [], walkFrame: 0, reaching: false, carrying: false, react: null, reactUntil: 0, ambientUntil: 0, missions: [], errand: false, atStation: false, item: null, sipUntil: 0, idleTicks: 0 }
  }

  // ----- geometry -----
  get rows() { return Math.ceil(this.desks.length / this.cols) }
  get width() { return MARGIN * 2 + this.cols * CELL_W }
  get height() { return this.rowY(this.rows - 1) + 46 }
  bossX() { return MARGIN + 6 } // left, right by the door
  bossY() { return TOP }
  bossSeat(): Pt { return { x: this.bossX() + 40, y: this.bossY() } }
  frontY() { return this.bossY() + 20 } // standing right at the boss desk
  aisleY() { return this.bossY() + 24 } // the walkway between the boss and row 1
  rowY(r: number) { return this.bossY() + 48 + r * ROW_H }
  cell(slot: number) { const r = Math.floor(slot / this.cols); const c = slot % this.cols; return { x: MARGIN + c * CELL_W, y: this.rowY(r), r, c } }
  seatOf(slot: number): Pt { const c = this.cell(slot); return { x: c.x + 18, y: c.y } }
  gapX(slot: number) { return this.cell(slot).x - 6 }
  frontOf(slot: number) { return this.cell(slot).y + 22 }
  corridorX(slot: number) { return this.cell(slot).c < this.cols / 2 ? 4 : this.width - 20 }
  door(): Pt { return { x: 6, y: WALL_BOTTOM - 20 } } // standing in the doorway
  doorOpen = 0 // 0 closed .. 3 wide open
  // the break area, top right
  bossRight() { return this.bossX() + BOSS_W }
  areaSpot(kind: Activity, side = 0): Pt {
    const W = this.width
    if (kind === 'cooler') return { x: W - 58, y: 30 }
    if (kind === 'station') return { x: this.stationX() + 2, y: 30 }
    if (kind === 'trash') return { x: W - 98, y: 32 }
    if (kind === 'gym') return { x: this.bossRight() + 10, y: 40 }
    const t = this.tableX()
    return side === 0 ? { x: t - 15, y: 30 } : { x: t + 27, y: 30 }
  }
  tableX() { return Math.round((this.bossRight() + this.width - 100) / 2) - 14 }
  stationX() { return this.tableX() + 36 } // coffee station: machine, snacks, mini fridge
  eotd = new Map<RoleId, number>() // hand-ins per role today
  eotdDirty = false
  spot(i: number): Pt {
    // the line forms to the Boss's right, away from the door
    const base = this.bossX() + 40
    return { x: Math.min(this.width - 20, base + i * 18), y: i === 0 ? this.frontY() : this.aisleY() }
  }

  /** Grows the floor to keep spare desks; shrinks only when nobody is walking. */
  private layout() {
    const holding = [...this.workers.values()].filter(w => w.desk >= 0).length
    const want = Math.max(MIN_DESKS, holding + SPARE_DESKS)
    const walking = [...this.workers.values()].some(w => w.plan.length) || this.boss.plan.length > 0
    if (want < this.desks.length && walking) return
    if (want === this.desks.length) return
    // 1 row of 5, then rows of 5 (zooming out), then widen past 3 rows
    const rows = Math.min(3, Math.ceil(want / MIN_DESKS))
    const cols = Math.max(MIN_DESKS, Math.ceil(want / rows))
    const total = rows * cols
    const occupied = this.desks.map((id, i) => ({ id, i })).filter(d => d.id)
    if (occupied.some(d => d.i >= total)) return // never yank a desk out from under someone
    const next: Array<string | null> = Array.from({ length: total }, (_, i) => this.desks[i] ?? null)
    this.desks = next
    this.cols = cols
    this.boss.pos = this.boss.seated ? this.bossSeat() : this.boss.pos
  }

  // ----- agents in -----
  sync(agents: AgentLike[]) {
    const seen = new Set<string>()
    for (const a of agents) {
      seen.add(a.id)
      const label = a.description || a.name || a.type || a.id
      let w = this.workers.get(a.id)
      if (!w) {
        if (!ACTIVE.has(a.status)) continue // already finished before we saw it: nobody to draw
        const seed = hash(a.id + label)
        w = {
          id: a.id, name: a.name, label, role: roleFor(`${label} ${a.type}`, seed), status: a.status, state: 'idle', desk: -1, seed,
          pos: this.door(), facing: 'right', seated: false, plan: [], walkFrame: 0, reaching: false, carrying: false,
          ambientUntil: 0, seatedOnce: false, ending: false, hidden: false, activity: null, item: null, sipUntil: 0,
          ...(a.remote ? { remote: a.remote } : {}),
        }
        this.workers.set(a.id, w)
        if (!this.claimDesk(w)) { this.workers.delete(a.id); continue }
        if (this.initialized) this.arrive(w)
        else this.sitDown(w) // already working when the office opened
      }
      const before = w.status
      w.status = a.status
      w.name = a.name
      w.label = label
      if (a.remote) w.remote = a.remote
      if (ACTIVE.has(before) && !ACTIVE.has(a.status)) this.finish(w)
      if (w.seated && !w.plan.length) w.state = this.seatedState(w)
    }
    for (const [id, w] of [...this.workers.entries()]) {
      if (seen.has(id)) continue
      if (!w.remote) this.dismiss(id)
      else if (!w.ending) { w.status = 'killed'; this.finish(w) } // file gone or long stale: walk out quietly
    }
    this.layout()
    this.initialized = true
  }

  private claimDesk(w: Worker): boolean {
    let slot = this.desks.indexOf(null)
    if (slot < 0) {
      this.desks.push(...Array.from({ length: Math.max(1, SPARE_DESKS) }, () => null))
      this.layout()
      slot = this.desks.indexOf(null)
      if (slot < 0) return false
    }
    this.desks[slot] = w.id
    w.desk = slot
    return true
  }

  private seatedState(w: Worker): WorkerState {
    if (w.status === 'running') return 'working'
    return w.status === 'waiting' ? 'waiting' : 'idle'
  }

  private sitDown(w: Worker) {
    w.pos = this.seatOf(w.desk)
    w.seated = true
    w.seatedOnce = true
    w.facing = 'down'
    w.state = this.seatedState(w)
    if (w.item) w.sipUntil = this.tick + SIP_TICKS
  }

  private dismiss(id: string) {
    const w = this.workers.get(id)
    if (w && w.desk >= 0) this.desks[w.desk] = null
    this.workers.delete(id)
    this.queue = this.queue.filter(q => q !== id)
  }

  /** Path from the aisle (at the walker's x) to a desk's chair. */
  private toDesk(fromX: number, slot: number): Pt[] {
    const aisle = this.aisleY()
    const cor = this.corridorX(slot)
    const front = this.frontOf(slot)
    const gap = this.gapX(slot)
    return [{ x: fromX, y: aisle }, { x: cor, y: aisle }, { x: cor, y: front }, { x: gap, y: front }, { x: gap, y: this.seatOf(slot).y }, this.seatOf(slot)]
  }
  /** Path from a desk's chair up to the aisle. */
  private fromDesk(slot: number): Pt[] {
    const seat = this.seatOf(slot)
    const gap = this.gapX(slot)
    const front = this.frontOf(slot)
    const cor = this.corridorX(slot)
    return [{ x: gap, y: seat.y }, { x: gap, y: front }, { x: cor, y: front }, { x: cor, y: this.aisleY() }]
  }

  // ----- lifecycle: a new worker comes in for an assignment -----
  private arrive(w: Worker) {
    w.state = 'arriving'
    w.pos = this.door()
    w.seated = false
    w.hidden = true
    // one at a time through the door
    const ahead = [...this.workers.values()].filter(o => o !== w && o.state === 'arriving' && o.hidden).length
    if (w.remote) {
      // already has its assignment from elsewhere: straight to a desk, no briefing
      w.plan = [
        { k: 'pause', ticks: 4 + ahead * 12 },
        { k: 'do', fn: () => { w.hidden = false; w.facing = 'down'; w.state = 'to-desk' } },
        { k: 'walk', path: [{ x: this.door().x, y: this.aisleY() }, ...this.toDesk(this.door().x, w.desk)], speed: SPEED },
        { k: 'do', fn: () => this.sitDown(w) },
      ]
      return
    }
    this.queue.push(w.id)
    w.plan = [
      { k: 'pause', ticks: 4 + ahead * 12 }, // the door swings open
      { k: 'do', fn: () => { w.hidden = false; w.facing = 'down' } },
      { k: 'walk', path: [{ x: this.door().x, y: this.aisleY() }], speed: SPEED },
      { k: 'queue' },
      { k: 'receive', ticks: REACH_TICKS },
      { k: 'do', fn: () => {
        this.queue.shift()
        this.react('ack')
        w.state = 'to-desk'
        w.carrying = true
        w.plan.unshift({ k: 'walk', path: this.toDesk(w.pos.x, w.desk), speed: SPEED })
      } },
      { k: 'do', fn: () => { w.carrying = false; this.sitDown(w) } },
    ]
  }

  // ----- lifecycle: a worker hands in its work and leaves -----
  private finish(w: Worker) {
    if (w.ending) return
    w.ending = true
    const err = w.status === 'failed'
    const quiet = w.status === 'killed'
    const speed = err ? SLOW : SPEED
    const leave = (): Step => ({ k: 'walk', path: [{ x: w.pos.x, y: this.aisleY() }, { x: this.door().x, y: this.aisleY() }, this.door()], speed })
    const steps: Step[] = [
      { k: 'do', fn: () => { w.state = 'finishing' } },
      { k: 'pause', ticks: 4 },
      { k: 'do', fn: () => {
        const slot = w.desk
        w.seated = false
        w.state = quiet ? 'leaving' : 'walking-to-boss'
        w.carrying = !quiet
        if (!quiet) this.queue.push(w.id)
        w.plan.unshift({ k: 'walk', path: this.fromDesk(slot), speed })
        if (slot >= 0) this.desks[slot] = null
        w.desk = -1
      } },
    ]
    if (!quiet) {
      steps.push(
        { k: 'queue' },
        { k: 'reach', ticks: REACH_TICKS, err, toBoss: true },
        { k: 'do', fn: () => {
          this.queue.shift()
          this.react(err ? 'err' : 'ack')
          if (!err) { this.eotd.set(w.role, (this.eotd.get(w.role) ?? 0) + 1); this.eotdDirty = true }
          w.state = 'leaving'
          w.carrying = false
          w.plan.unshift(leave())
        } },
      )
    } else {
      steps.push({ k: 'do', fn: () => { w.plan.unshift(leave()) } })
    }
    steps.push(
      { k: 'do', fn: () => { w.hidden = true } },
      { k: 'pause', ticks: 4 }, // the door swings shut behind them
      { k: 'do', fn: () => { this.workers.delete(w.id) } },
    )
    w.plan.push(...steps)
  }

  // ----- lifecycle: the boss walks a message over -----
  deliver(to: string) {
    const w = [...this.workers.values()].find(o => o.id === to || o.name === to || o.name?.split('@')[0] === to)
    if (w) this.boss.missions.push(w.id)
  }

  private startMission(id: string) {
    const w = this.workers.get(id)
    const b = this.boss
    if (!w || w.desk < 0 || !w.seated) return
    const c = this.cell(w.desk)
    const seat = this.bossSeat()
    const side = { x: this.bossRight() + 2, y: seat.y }
    const aisle = this.aisleY()
    const cor = this.corridorX(w.desk)
    const front = { x: c.x + 24, y: this.frontOf(w.desk) }
    b.seated = false
    b.carrying = true
    b.plan = [
      { k: 'walk', path: [side, { x: side.x, y: aisle }, { x: cor, y: aisle }, { x: cor, y: front.y }, front], speed: SPEED + 1 },
      { k: 'do', fn: () => { b.facing = 'up' } },
      { k: 'reach', ticks: REACH_TICKS, err: false, toBoss: false, targetId: w.id },
      { k: 'do', fn: () => { b.carrying = false; w.ambientUntil = this.tick + 12 } },
      { k: 'walk', path: [{ x: cor, y: front.y }, { x: cor, y: aisle }, { x: side.x, y: aisle }, side, seat], speed: SPEED + 1 },
      { k: 'do', fn: () => { b.seated = true; b.facing = 'down' } },
    ]
  }

  /** A worker gets up, does something in the break area, and comes back. */
  private takeBreak(w: Worker, kind: Activity, side = 0, ticks = 0) {
    const slot = w.desk
    const spot = this.areaSpot(kind, side)
    const aisle = this.aisleY()
    const dur = ticks || (kind === 'gym' ? 50 : kind === 'trash' ? 20 : kind === 'chat' ? 60 : kind === 'station' ? 24 : 40)
    const item: Item | null = kind === 'cooler' ? 'water' : kind === 'station' ? (STATION_ITEMS[Math.floor(Math.random() * STATION_ITEMS.length)] as Item) : null
    w.seated = false
    w.plan = [
      { k: 'walk', path: [...this.fromDesk(slot), { x: spot.x, y: aisle }, spot], speed: SPEED },
      { k: 'do', fn: () => { w.facing = kind === 'cooler' ? 'right' : kind === 'chat' ? (side === 0 ? 'right' : 'left') : 'up' } },
      { k: 'activity', kind, ticks: dur },
      { k: 'do', fn: () => { if (item) w.item = item } },
      { k: 'do', fn: () => { w.plan.unshift({ k: 'walk', path: this.toDesk(w.pos.x, w.desk), speed: SPEED }) } },
      { k: 'do', fn: () => this.sitDown(w) },
    ]
  }

  lounging(): boolean { return this.boss.idleTicks > LOUNGE_AFTER }
  idleWord(): string { return IDLE_WORDS[Math.floor(this.tick / 150) % IDLE_WORDS.length] as string }

  /** The Boss gets up for a drink or a snack and brings it back to his desk. */
  private bossErrand(item: Item) {
    const b = this.boss
    const kind: Activity = item === 'water' ? 'cooler' : 'station'
    const spot = this.areaSpot(kind)
    const seat = this.bossSeat()
    const side = { x: this.bossRight() + 2, y: seat.y }
    const aisle = this.aisleY()
    b.seated = false
    b.errand = true
    b.plan = [
      { k: 'walk', path: [side, { x: side.x, y: aisle }, { x: spot.x, y: aisle }, spot], speed: SPEED },
      { k: 'do', fn: () => { b.facing = kind === 'cooler' ? 'right' : 'up'; b.atStation = true } },
      { k: 'pause', ticks: 26 },
      { k: 'do', fn: () => { b.atStation = false; b.item = item } },
      { k: 'walk', path: [{ x: spot.x, y: aisle }, { x: side.x, y: aisle }, side, seat], speed: SPEED },
      { k: 'do', fn: () => {
        b.seated = true
        b.errand = false
        b.facing = 'down'
        b.sipUntil = this.tick + SIP_TICKS
        if (b.carrying) { b.carrying = false; this.react('ack') } // filed the work someone handed him on the way
      } },
    ]
  }

  /** One subagent messaging another: both meet at the meeting table. */
  collab(fromId: string, to: string) {
    const a = this.workers.get(fromId)
    const b = [...this.workers.values()].find(o => o.id === to || o.name === to || o.name?.split('@')[0] === to)
    for (const [w, side] of [[a, 0], [b, 1]] as const) {
      if (w && w.seated && !w.plan.length && !w.ending && w.desk >= 0) this.takeBreak(w, 'chat', side, 60)
    }
  }

  private react(kind: 'ack' | 'err') {
    this.boss.react = kind
    this.boss.reactUntil = this.tick + REACT_TICKS
  }

  // ----- per tick -----
  step(): boolean {
    this.tick += 1
    let moving = this.packets.length > 0 || this.boss.reactUntil > this.tick
    const b = this.boss
    if (!b.plan.length && b.seated && b.missions.length && !this.someoneAtFront()) this.startMission(b.missions.shift() as string)
    if (this.run(b, false)) moving = true
    for (const w of [...this.workers.values()]) if (this.run(w, true)) moving = true
    for (const p of this.packets) p.t += 1
    this.packets = this.packets.filter(p => p.t <= p.dur)
    if (Math.random() < AMBIENT_CHANCE) {
      const seated = [...this.workers.values()].filter(w => w.seated)
      const pick = seated[Math.floor(Math.random() * seated.length)]
      if (pick) pick.ambientUntil = this.tick + 14
    }
    if (Math.random() < AMBIENT_CHANCE / 2 && b.seated) b.ambientUntil = this.tick + 14
    // the Boss's drink runs
    if (b.seated && !b.plan.length && !b.missions.length && !this.queue.length && b.sipUntil < this.tick && Math.random() < BOSS_ERRAND_CHANCE) {
      const pick = (['coffee', 'coffee', 'water', 'tea', 'soda', 'donut'] as const)[Math.floor(Math.random() * 6)] as Item
      this.bossErrand(pick)
    }
    if (b.item && b.seated && b.sipUntil < this.tick) b.item = null
    const free = b.seated && !b.plan.length && !this.bossWorking && !b.item && !this.queue.length && !(b.reactUntil > this.tick)
    b.idleTicks = free ? b.idleTicks + 1 : 0
    if (this.lounging() && this.tick % 3 === 0) moving = true // keep the notes floating
    for (const w of this.workers.values()) if (w.item && w.seated && w.sipUntil < this.tick) w.item = null
    // breaks: seated workers wander to the break area now and then
    for (const w of this.workers.values()) {
      if (!w.seated || w.plan.length || w.ending || w.desk < 0) continue
      const chance = w.status === 'running' ? BREAK_CHANCE_BUSY : BREAK_CHANCE_IDLE
      if (Math.random() < chance) this.takeBreak(w, (['cooler', 'trash', 'gym', 'station', 'station'] as const)[Math.floor(Math.random() * 5)] as Activity)
    }
    // the door opens for anyone in the doorway
    const d = this.door()
    const near = [...this.workers.values()].some(w => w.hidden || (Math.abs(w.pos.x - d.x) < 10 && w.pos.y < this.aisleY() - 4))
    const target = near ? 3 : 0
    if (this.doorOpen !== target) { this.doorOpen += Math.sign(target - this.doorOpen); moving = true }
    if (!moving) this.layout()
    return moving
  }

  private someoneAtFront(): boolean {
    const first = this.queue[0]
    return !!first && !!this.workers.get(first)
  }

  /** Advances one actor's plan; true while it is visibly moving. */
  private run(a: Actor, isWorker: boolean): boolean {
    const s = a.plan[0]
    if (!s) return false
    if (s.k === 'pause') {
      if (--s.ticks <= 0) a.plan.shift()
      return true
    }
    if (s.k === 'do') {
      a.plan.shift()
      s.fn()
      return true
    }
    if (s.k === 'walk') {
      const target = s.path[0]
      if (!target) { a.plan.shift(); return true }
      a.reaching = false
      const dx = target.x - a.pos.x
      const dy = target.y - a.pos.y
      if (dx === 0 && dy === 0) { s.path.shift(); return true }
      if (dx !== 0) { a.facing = dx > 0 ? 'right' : 'left'; a.pos = { x: a.pos.x + Math.sign(dx) * Math.min(Math.abs(dx), s.speed), y: a.pos.y } }
      else { a.facing = dy > 0 ? 'down' : 'up'; a.pos = { x: a.pos.x, y: a.pos.y + Math.sign(dy) * Math.min(Math.abs(dy), s.speed) } }
      a.walkFrame = (a.walkFrame + 1) % 4
      return true
    }
    if (s.k === 'queue' && isWorker) {
      const w = a as Worker
      const idx = this.queue.indexOf(w.id)
      const target = this.spot(Math.max(0, idx))
      if (w.pos.x !== target.x || w.pos.y !== target.y) {
        a.plan.unshift({ k: 'walk', path: [{ x: w.pos.x, y: this.aisleY() }, { x: target.x, y: this.aisleY() }, target], speed: SPEED })
        return true
      }
      if (w.state !== 'arriving' && w.state !== 'walking-to-boss') w.state = w.state
      w.facing = 'up'
      const b = this.boss
      if (idx === 0 && b.seated && !b.plan.length) {
        a.plan.shift()
        w.state = w.state === 'arriving' ? 'briefed' : 'handoff'
      } else if (idx === 0 && w.state === 'walking-to-boss' && b.errand && b.atStation) {
        // the Boss is at the coffee station: go hand it to him there
        a.plan.shift()
        w.state = 'handoff'
        const meet = { x: Math.min(this.width - 20, b.pos.x + 16), y: b.pos.y }
        a.plan.unshift({ k: 'walk', path: [{ x: w.pos.x, y: this.aisleY() }, { x: meet.x, y: this.aisleY() }, meet], speed: SPEED }, { k: 'do', fn: () => { w.facing = 'left' } })
        return true
      } else if (w.state === 'arriving' || w.state === 'walking-to-boss') {
        // waiting in line keeps the same state; nothing moves
      }
      return false
    }
    if (s.k === 'activity' && isWorker) {
      const w = a as Worker
      w.activity = s.kind
      if (s.kind === 'trash' && s.ticks > 14) { w.reaching = true; w.facing = 'right' }
      else w.reaching = false
      if (--s.ticks <= 0) { a.plan.shift(); w.activity = null; w.reaching = false }
      return true
    }
    if (s.k === 'receive' && isWorker) {
      if (!a.reaching) {
        a.reaching = true
        const bs = this.bossSeat()
        this.packets.push({ from: { x: bs.x + 6, y: bs.y + 10 }, to: { x: a.pos.x + 8, y: a.pos.y + 8 }, t: 0, dur: s.ticks, err: false })
      }
      if (--s.ticks <= 0) { a.plan.shift(); a.reaching = false }
      return true
    }
    if (s.k === 'reach') {
      if (!a.reaching) {
        a.reaching = true
        const from = { x: a.pos.x + 8, y: a.pos.y + 6 }
        let to: Pt
        if (s.toBoss) {
          const bb = this.boss
          const at = bb.seated ? this.bossSeat() : bb.pos
          to = { x: at.x + 6, y: at.y + 10 }
          if (!bb.seated) bb.carrying = true // he'll walk it back to his desk
        }
        else { const w = s.targetId ? this.workers.get(s.targetId) : undefined; to = w ? { x: w.pos.x + 6, y: w.pos.y + 10 } : from }
        this.packets.push({ from, to, t: 0, dur: s.ticks, err: s.err })
      }
      if (--s.ticks <= 0) { a.plan.shift(); a.reaching = false }
      return true
    }
    return false
  }

  // ----- drawing -----
  /** @param minAspect stretch the floor down to at least height = width * minAspect */
  render(scale: number = SCALE, minAspect = 0): string {
    const W = this.width
    const H = Math.max(this.height, Math.round(W * minAspect))
    const out: string[] = []
    out.push(`<rect width="${W}" height="${H}" fill="${FLOOR}"/>`)
    out.push(floorSeams(W, H))
    out.push(this.backWall())
    // title
    out.push(`<text x="4" y="8" font-family="ui-monospace,Menlo,monospace" font-size="6" font-weight="700" fill="#c0392b">◆ OFFICE SPACE</text>`)
    out.push(`<text x="60" y="8" font-family="ui-monospace,Menlo,monospace" font-size="5" fill="#2b3550">${esc(this.summary())}</text>`)

    const drawables: Array<{ z: number; svg: string }> = []
    const add = (z: number, svg: string) => drawables.push({ z, svg })
    const f = this.tick

    // boss desk
    const bx = this.bossX()
    const by = this.bossY()
    const b = this.boss
    add(by + 9, place(bx + 41, by + 9, STATIC.chair))
    add(by + 28, place(bx + 4, by + 15, STATIC.bossDesk))
    add(by + 28.1, place(bx + 52, by + 8, gridSvg('laptop', laptopGrid(true), FURN_PAL)))
    add(by + 28.1, place(bx + 8, by + 8, STATIC.plant))
    add(by + 28.1, place(bx + 70, by + 7, gridSvg('mug', icon('mug'), FURN_PAL)))
    out.push(`<text x="${bx + 4 + 44}" y="${by + 36}" text-anchor="middle" font-family="ui-monospace,Menlo,monospace" font-size="4" font-weight="700" fill="#2b3550">THE BOSS</text>`)

    if (b.seated) {
      const typing = this.bossWorking && !(b.reactUntil > f)
      const frame = typing ? Math.floor(f / 2) % 4 : 0
      const nod = b.reactUntil > f && Math.floor(f / 3) % 2 === 0
      if (this.lounging()) {
        const seat = this.bossSeat()
        add(by + 16, this.charSvg('boss', 'down', 'lounge', 0, false, (f + 7) % 47 < 3, false, { x: seat.x, y: seat.y + 1 }))
        add(by + 28.3, place(seat.x - 11, by + 11, gridSvg('feet-up', feetUp('boss'), { ...paletteFor('boss'), X: '#c9ccd6' })))
        // whistled notes drift up and away
        for (let i = 0; i < 2; i++) {
          const t = (f + i * 9) % 18
          const ng = grid(4, NOTE_ROWS.length)
          NOTE_ROWS.forEach((r, y) => [...r].forEach((ch, x) => { if (ch !== '.') (ng[y] as string[])[x] = ch }))
          add(999, place(seat.x + 12 + Math.floor(t / 3), seat.y - 2 - t, gridSvg('note', ng, { n: '#22304a' })))
        }
      } else {
        add(by + 16, this.charSvg('boss', 'down', 'seat', frame, typing, (f + 7) % 47 < 2, nod, this.bossSeat()))
      }
    } else {
      add(b.pos.y + 20.5, this.charSvg('boss', b.facing, b.reaching ? 'reach' : 'walk', b.walkFrame, false, false, false, b.pos))
    }
    const bAt = b.seated ? this.bossSeat() : b.pos
    if (b.reactUntil > f && b.react) {
      add(999, place(bAt.x + 13, bAt.y - 9, gridSvg(`react-${b.react}`, b.react === 'ack' ? CHECK : icon('question'), FURN_PAL)))
    } else if (b.atStation && Math.floor(f / 8) % 2) {
      add(999, place(bAt.x + 12, bAt.y - 7, gridSvg('dots', BUBBLE_DOTS, FURN_PAL)))
    } else if (b.ambientUntil > f && b.seated && !b.item) {
      add(999, place(bAt.x + 13, bAt.y - 9, gridSvg('amb-mug', icon('mug'), FURN_PAL)))
    }
    if (b.item) add(b.seated ? by + 17 : b.pos.y + 20.7, this.itemSvg(b.item, bAt, b.seated, f))

    // desks
    for (let slot = 0; slot < this.desks.length; slot++) {
      const c = this.cell(slot)
      const wid = this.desks[slot]
      const w = wid ? this.workers.get(wid) : undefined
      const here = w && w.seated ? w : undefined
      add(c.y + 9, place(c.x + 19, c.y + 9, STATIC.chair))
      add(c.y + 28, place(c.x + 4, c.y + 15, STATIC.desk))
      add(c.y + 28.1, place(c.x + 21, c.y + 15, STATIC.keyboard))
      const screen = !here || here.remote?.stale ? 'off' : here.status === 'running' ? 'on' : here.state === 'finishing' ? 'done' : 'off'
      const mf = Math.floor(f / 2) % 4
      add(c.y + 28.1, place(c.x + 38, c.y + 3, gridSvg(`mon-${screen}-${here?.role === 'coder'}-${screen === 'on' ? mf : 0}`, monitorGrid(screen, mf, here?.role === 'coder'), FURN_PAL)))
      if (!here) continue
      const role = ROLES[here.role]
      const rm = here.remote
      const fade = (svg: string) => (rm?.stale ? `<g opacity="0.4">${svg}</g>` : svg)
      add(c.y + 28.2, fade(place(c.x + 4, c.y + 6, gridSvg(`prop-${role.prop}`, icon(role.prop), paletteFor(here.role)))))
      if (rm) {
        // the remote badge on the desk front
        const tag = esc(short(rm.source.toUpperCase(), 10))
        const tw = Math.round(tag.length * 2.4 + 4)
        add(c.y + 28.3, `<rect x="${c.x + 6}" y="${c.y + 21}" width="${tw}" height="5" fill="${rm.stale ? '#7d8796' : '#1f8a7a'}"/><text x="${c.x + 8}" y="${c.y + 25}" font-family="ui-monospace,Menlo,monospace" font-size="3.6" font-weight="700" fill="#ffffff">${tag}</text>`)
      }
      // label: status dot + role centred under the desk, the task right below
      const mid = c.x + 32
      const titleW = role.title.length * 3
      out.push(`<rect x="${Math.round(mid - titleW / 2 - 5)}" y="${c.y + 31}" width="3" height="3" fill="${this.dot(here)}"/>`)
      out.push(`<text x="${mid}" y="${c.y + 35}" text-anchor="middle" font-family="ui-monospace,Menlo,monospace" font-size="5" font-weight="700" fill="#22304a">${esc(role.title)}</text>`)
      const sub = rm?.stale ? `stale ${rm.ageMin}m · ${here.label}` : rm?.need && rm.note ? rm.note : here.label
      out.push(`<text x="${mid}" y="${c.y + 41}" text-anchor="middle" font-family="ui-monospace,Menlo,monospace" font-size="4" fill="${rm?.need && !rm.stale ? '#8e2a20' : '#33445f'}">${esc(short(sub, 30))}</text>`)
      const seat = this.seatOf(slot)
      const typing = here.status === 'running'
      const frame = typing ? Math.floor((f + here.seed) / 2) % 4 : Math.floor((f + here.seed) / 6) % 2
      add(c.y + 16, fade(this.charSvg(here.role, 'down', 'seat', frame, typing && !rm?.stale, (f + here.seed) % 53 < 2, !typing && frame === 1, seat)))
      if (here.item) add(c.y + 17, this.itemSvg(here.item, seat, true, f + here.seed))
      if (rm?.need) {
        // a human is needed: the bubble stays up (bobbing), never hidden by ambient props
        const bob = Math.floor(f / 6) % 2
        add(999, fade(place(seat.x + 12, seat.y - 10 - bob, gridSvg(`need-${rm.need}`, rm.need === 'blocked' ? BUBBLE_STOP : BUBBLE_ASK, FURN_PAL))))
      } else if (here.ambientUntil > f) add(999, place(seat.x + 13, seat.y - 9, gridSvg(`amb-${role.prop}`, icon(role.prop), paletteFor(here.role))))
      else if (here.state === 'waiting' && Math.floor(f / 8) % 2) add(999, place(seat.x + 12, seat.y - 7, gridSvg('dots', BUBBLE_DOTS, FURN_PAL)))
    }

    // break area furniture
    for (const d of this.breakArea()) add(d.z, d.svg)

    // walking (and breaking) workers
    for (const w of this.workers.values()) {
      if (w.seated || w.hidden) continue
      if (w.activity === 'gym') {
        const up = Math.floor(f / 4) % 2 === 0
        const m = this.areaSpot('gym')
        add(m.y + 20.5, place(m.x - 2, m.y + 12, gridSvg(`pushup-${w.role}-${up}`, pushup(w.role, up), paletteFor(w.role))))
        if (Math.floor(f / 8) % 2) add(999, place(m.x + 14, m.y - 2, gridSvg('flex', icon('bulb'), FURN_PAL)))
        continue
      }
      const pose = w.reaching ? 'reach' : w.activity || w.plan[0]?.k === 'queue' ? 'stand' : 'walk'
      add(w.pos.y + 20.5, this.charSvg(w.role, w.facing, pose, w.walkFrame, false, false, false, w.pos))
      if ((w.activity === 'cooler' || w.activity === 'station') && Math.floor(f / 10) % 2) add(999, place(w.pos.x + 12, w.pos.y - 7, gridSvg('dots', BUBBLE_DOTS, FURN_PAL)))
      if (w.item) add(w.pos.y + 20.7, this.itemSvg(w.item, w.pos, false, f))
      if (w.activity === 'chat' && Math.floor((f + w.seed) / 7) % 2) add(999, place(w.pos.x + 10, w.pos.y - 7, gridSvg('dots', BUBBLE_DOTS, FURN_PAL)))
      if (w.carrying && !w.reaching) {
        const err = w.status === 'failed'
        add(w.pos.y + 20.6, place(w.pos.x + (w.facing === 'left' ? 0 : 11), w.pos.y + 11, gridSvg(err ? 'pk-err' : 'pk-ok', err ? PACKET_ERR : PACKET_OK, FURN_PAL)))
      }
    }
    if (!b.seated && b.carrying && !b.reaching) add(b.pos.y + 20.6, place(b.pos.x + 11, b.pos.y + 11, gridSvg('pk-ok', PACKET_OK, FURN_PAL)))

    for (const p of this.packets) {
      const t = Math.min(1, p.t / p.dur)
      const x = Math.round(p.from.x + (p.to.x - p.from.x) * t)
      const y = Math.round(p.from.y + (p.to.y - p.from.y) * t - Math.sin(t * Math.PI) * 6)
      add(998, place(x, y, gridSvg(p.err ? 'pk-err' : 'pk-ok', p.err ? PACKET_ERR : PACKET_OK, FURN_PAL)))
    }

    drawables.sort((a, b2) => a.z - b2.z)
    for (const d of drawables) out.push(d.svg)
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W * scale}" height="${H * scale}" shape-rendering="crispEdges" style="image-rendering:pixelated">${out.join('')}</svg>`
  }

  /** Back wall: windows, the door (animated), the Employee of the Day sign. */
  private backWall(): string {
    const W = this.width
    const o: string[] = []
    o.push(`<rect x="0" y="${WALL_TOP}" width="${W}" height="${WALL_BOTTOM - WALL_TOP}" fill="#6f86a3"/>`)
    o.push(`<rect x="0" y="${WALL_BOTTOM - 2}" width="${W}" height="2" fill="#4e6380"/>`)
    // windows
    for (const wx of [this.bossX() + 36, this.tableX() - 4]) {
      o.push(`<rect x="${wx}" y="${WALL_TOP + 3}" width="24" height="13" fill="#38566f"/><rect x="${wx + 1}" y="${WALL_TOP + 4}" width="22" height="11" fill="#a9c4dc"/><rect x="${wx + 11}" y="${WALL_TOP + 4}" width="2" height="11" fill="#38566f"/><rect x="${wx + 1}" y="${WALL_TOP + 9}" width="22" height="1" fill="#38566f"/>`)
    }
    // the door
    const pw = Math.max(1, 18 - this.doorOpen * 6)
    o.push(`<rect x="3" y="${WALL_TOP + 2}" width="22" height="${WALL_BOTTOM - WALL_TOP - 2}" fill="#5b3b20"/>`)
    o.push(`<rect x="5" y="${WALL_TOP + 4}" width="18" height="${WALL_BOTTOM - WALL_TOP - 4}" fill="#231f2b"/>`)
    o.push(`<rect x="5" y="${WALL_TOP + 4}" width="${pw}" height="${WALL_BOTTOM - WALL_TOP - 4}" fill="#9a6434"/>`)
    if (pw > 6) o.push(`<rect x="${5 + pw - 3}" y="${WALL_TOP + 12}" width="1" height="2" fill="#f4c542"/>`)
    o.push(`<rect x="4" y="${WALL_BOTTOM}" width="20" height="2" fill="#6d597a"/>`)
    // Employee of the Day
    const sx = W - 104
    const sy = WALL_TOP + 1
    o.push(`<rect x="${sx}" y="${sy}" width="44" height="18" fill="#c9a227"/><rect x="${sx + 1}" y="${sy + 1}" width="42" height="16" fill="#f4f1e8"/>`)
    o.push(`<text x="${sx + 22}" y="${sy + 5}" text-anchor="middle" font-family="ui-monospace,Menlo,monospace" font-size="3.2" font-weight="700" fill="#8e2a20">EMPLOYEE OF</text>`)
    o.push(`<text x="${sx + 22}" y="${sy + 8.5}" text-anchor="middle" font-family="ui-monospace,Menlo,monospace" font-size="3.2" font-weight="700" fill="#8e2a20">THE DAY</text>`)
    const best = [...this.eotd.entries()].sort((a, b) => b[1] - a[1])[0]
    if (best) {
      const [role, n] = best
      const face = character({ role, dir: 'down', pose: 'stand', frame: 0 }).slice(0, 10).map(r => r.slice(3, 13))
      o.push(place(sx + 3, sy + 8, `<g transform="scale(0.8)">${gridSvg(`eotd-${role}`, face, paletteFor(role))}</g>`))
      o.push(`<text x="${sx + 13}" y="${sy + 12.5}" font-family="ui-monospace,Menlo,monospace" font-size="3" font-weight="700" fill="#22304a">${esc(ROLES[role].title)}</text>`)
      o.push(`<text x="${sx + 13}" y="${sy + 16}" font-family="ui-monospace,Menlo,monospace" font-size="3" fill="#33445f">${n} handed in</text>`)
    } else {
      o.push(`<text x="${sx + 22}" y="${sy + 14}" text-anchor="middle" font-family="ui-monospace,Menlo,monospace" font-size="3" fill="#33445f">nobody yet</text>`)
    }
    return o.join('')
  }

  /** A drink or snack: in hand while walking, raised to sip while seated. */
  private itemSvg(item: Item, at: Pt, seated: boolean, f: number): string {
    const rows = ITEM_ROWS[item]
    const gr = grid(8, rows.length)
    rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch !== '.') (gr[y] as string[])[x] = ch }))
    const pal = { ...FURN_PAL, c: '#5b3a1f', w: '#ffffff', g: '#4f8a4b', b: '#7ec8e3', B: '#cfe9f2', r: '#d94141', W: '#f4f1e8', X: '#9aa3b5', p: '#f29fc4', t: '#c58a4f', y: '#5b3a1f' }
    const svg = gridSvg(`item-${item}`, outline(pad1(gr)), pal)
    if (!seated) return place(at.x + 11, at.y + 10, svg)
    const sip = Math.floor(f / 12) % 3 === 0 // lift to the mouth now and then
    return place(at.x + (sip ? 9 : 12), at.y + (sip ? 6 : 11), svg)
  }

  /** Water cooler, trash can, meeting table and gym mat, as z-sorted drawables. */
  private breakArea(): Array<{ z: number; svg: string }> {
    const W = this.width
    const d: Array<{ z: number; svg: string }> = []
    const g = (key: string, rows: string[]) => {
      const gr = grid(rows[0]?.length ?? 0, rows.length)
      rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch !== '.') (gr[y] as string[])[x] = ch }))
      return gridSvg(key, outline(pad1(gr)), { ...FURN_PAL, b: '#7ec8e3', B: '#cfe9f2', s: '#9aa3b5', S: '#cfd3dc', m: '#6d597a', k: '#4a4f5e' })
    }
    // water cooler
    d.push({ z: 48, svg: place(W - 40, 30, g('cooler', ['.bbbb.', '.BbbB.', '.bbbb.', '..bb..', 'SSSSSS', 'SskkSS', 'SSSSSS', 'SSSSSS', 'SSSSSS', 'SSSSSS', 'S....S', 'S....S'])) })
    // trash can
    d.push({ z: 52, svg: place(W - 80, 44, g('trash', ['kkkkkk', 'ssssss', 'sSsSsS', 'sSsSsS', 'sSsSsS', 'ssssss'])) })
    // meeting table + stools
    const t = this.tableX()
    d.push({ z: 52, svg: place(t, 44, g('table', ['dddddddddddddddddddddddd', 'DDDDDDDDDDDDDDDDDDDDDDDD', '.q....................q.', '.q....................q.', '.q....................q.'])) })
    // coffee station: machine, snack basket, mini fridge
    d.push({ z: 47, svg: place(this.stationX(), 30, g('station', ['TTTT...YYY....KK', 'TRTT..YuYuY...KK', 'TTTT..uuuuu...KK', 'T..T.w.uuu....KK', 'dddddddddddddddd', 'DDDDDDDDDDDDDDDD', 'qqqqqqqqqqqqqqqq', 'qqqqqqqqqqqqqqqq', 'qqqqqqqqqqqqqqqq', 'q..............q'])) })
    // gym mat
    d.push({ z: 40, svg: place(this.bossRight() + 6, 61, g('mat', ['mmmmmmmmmmmmmmmmmmmmmmmm', 'mmmmmmmmmmmmmmmmmmmmmmmm'])) })
    return d
  }

  private charSvg(role: RoleId, dir: Dir, pose: 'stand' | 'walk' | 'seat' | 'reach' | 'lounge', frame: number, typing: boolean, blink: boolean, nod: boolean, pos: Pt): string {
    const key = `c-${role}-${dir}-${pose}-${frame}-${typing}-${blink}-${nod}`
    return place(pos.x, pos.y, gridSvg(key, character({ role, dir, pose, frame, typing, blink, nod }), paletteFor(role)))
  }

  dot(w: Worker): string {
    if (w.status === 'failed') return '#d9483b'
    if (w.remote?.stale && !w.ending) return '#b4b9c4'
    if (w.remote?.need === 'blocked' && !w.ending) return '#e8692b'
    if (w.remote?.need === 'waiting' && !w.ending) return '#e8b923'
    if (w.ending) return '#e8b923'
    if (w.status === 'running') return '#3c7be0'
    if (w.status === 'completed' || w.status === 'idle') return '#3fae5a'
    return '#8a8f9c'
  }

  summary(): string {
    const ws = [...this.workers.values()]
    const working = ws.filter(w => w.seated && w.status === 'running').length
    const coming = ws.filter(w => !w.seatedOnce).length
    const leaving = ws.filter(w => w.ending).length
    const needed = ws.filter(w => w.remote?.need && !w.remote.stale && !w.ending).length
    const b = this.boss
    const bossNote = b.errand ? (b.item ? `boss is bringing back a ${b.item}` : 'boss is on a drink run')
      : !b.seated ? 'boss is walking a message over'
      : b.item ? `boss is enjoying a ${b.item}`
      : this.lounging() ? `boss is idly ${this.idleWord()}`
      : this.bossWorking ? 'boss is busy' : 'boss is idle'
    if (!ws.length) return `no one at work · ${bossNote}`
    return [needed ? `${needed} need${needed === 1 ? 's' : ''} you` : '', working ? `${working} working` : '', coming ? `${coming} arriving` : '', leaving ? `${leaving} handing in` : '', bossNote].filter(Boolean).join(' · ')
  }

  textLines(): Array<{ dot: string; title: string; label: string }> {
    return [...this.workers.values()].map(w => ({ dot: this.dot(w), title: ROLES[w.role].title, label: w.remote ? this.remoteLabel(w, w.remote) : w.label }))
  }

  private remoteLabel(w: Worker, r: RemoteInfo): string {
    const tail = r.stale ? ` (stale ${r.ageMin}m)` : r.need ? ` — ${r.need.toUpperCase()}${r.note ? `: ${r.note}` : ''}` : ''
    return `[${r.source}] ${w.label}${tail}`
  }
}
