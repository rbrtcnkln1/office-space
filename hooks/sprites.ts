// Sprite kit: palettes, roles and the pixel builders that draw every character.
// Everything here is plain data + pure functions, so it is safe to tweak.
//
// A sprite is a grid of palette keys ('.' = transparent). Characters are built
// from one shared body template, so every role has the same proportions, head
// size, outline and frame size (16 x 24 logical pixels).

export type Dir = 'down' | 'up' | 'left' | 'right'
export type Grid = string[][]
export type Palette = Record<string, string>

export type HairStyle = 'short' | 'spiky' | 'bun' | 'long' | 'cap' | 'bald' | 'curly' | 'bob'
export type PropIcon =
  | 'clipboard' | 'book' | 'code' | 'doc' | 'chart' | 'wrench' | 'cloud' | 'magnifier' | 'question' | 'bulb' | 'mug'

export type RoleId =
  | 'boss' | 'planner' | 'researcher' | 'coder' | 'writer' | 'analyst'
  | 'maintainer' | 'deployer' | 'reviewer' | 'skeptic' | 'optimist'

export type Role = {
  id: RoleId
  title: string
  hairStyle: HairStyle
  glasses: boolean
  prop: PropIcon
  // palette keys: H hair, h hair shade, S skin, s skin shade, C clothes,
  // c clothes shade, P pants, F shoes, K cap/accent, k accent shade
  colors: Partial<Palette>
}

// ---------- Shared palette (outline, eyes, props, furniture) ----------

export const BASE: Palette = {
  O: '#1a1622', // outline
  E: '#1a1622', // eyes
  G: '#1a1622', // glasses frame
  L: '#cfe8ff', // lens
  M: '#a0524a', // mouth
  W: '#f4f1e8', // paper / collar / highlight
  R: '#e05a4f', // error red
  Y: '#f4c542', // bulb / warning
  V: '#4fbf6a', // check green
  S: '#f2c28b',
  s: '#d99a62',
  H: '#4a2f1b',
  h: '#33200f',
  C: '#5a7d9a',
  c: '#41607a',
  P: '#2e3550',
  F: '#20202a',
  K: '#c0392b',
  k: '#8e2a20',
}

export const FURNITURE: Palette = {
  D: '#9a6434', // desk top
  d: '#c58a4f', // desk highlight
  q: '#6e4521', // desk front / legs
  T: '#2b2d3a', // monitor case
  t: '#3d4052', // monitor case light
  N: '#4fbf6a', // screen on (working)
  n: '#22382b', // screen idle
  X: '#9aa3b5', // keyboard / laptop
  x: '#6e7690', // keyboard shade
  Z: '#3b3f52', // chair
  z: '#2a2d3c', // chair shade
  g: '#4f8a4b', // plant
  j: '#2f6a35', // plant shade
  u: '#b6643a', // pot
  w: '#ffffff', // mug
}

// ---------- Roles (edit freely) ----------

export const ROLES: Record<RoleId, Role> = {
  boss: { id: 'boss', title: 'The Boss', hairStyle: 'short', glasses: true, prop: 'mug',
    colors: { H: '#2b1d14', h: '#1a110b', C: '#2f3242', c: '#20222e', P: '#1d1f2a' } },
  planner: { id: 'planner', title: 'Planner', hairStyle: 'short', glasses: false, prop: 'clipboard',
    colors: { H: '#8a4b23', h: '#62331a', C: '#4f9a52', c: '#37753a' } },
  researcher: { id: 'researcher', title: 'Researcher', hairStyle: 'bun', glasses: false, prop: 'book',
    colors: { H: '#e0a54a', h: '#b07a2c', C: '#e08a3c', c: '#b4652a' } },
  coder: { id: 'coder', title: 'Coder', hairStyle: 'spiky', glasses: true, prop: 'code',
    colors: { H: '#2a2230', h: '#18131c', C: '#2c3550', c: '#1f2539' } },
  writer: { id: 'writer', title: 'Writer', hairStyle: 'long', glasses: false, prop: 'doc',
    colors: { H: '#3a2418', h: '#24160e', S: '#c68642', s: '#9c6530', C: '#d8c27a', c: '#b39e58' } },
  analyst: { id: 'analyst', title: 'Analyst', hairStyle: 'short', glasses: false, prop: 'chart',
    colors: { H: '#e8c04f', h: '#b8922c', C: '#3c6fc4', c: '#2a5196' } },
  maintainer: { id: 'maintainer', title: 'Maintainer', hairStyle: 'cap', glasses: false, prop: 'wrench',
    colors: { H: '#6b4426', h: '#4b2f19', C: '#3aa6b9', c: '#2a7f8e', K: '#d94141', k: '#a32f2f' } },
  deployer: { id: 'deployer', title: 'Deployer', hairStyle: 'curly', glasses: false, prop: 'cloud',
    colors: { H: '#3f8f4a', h: '#2c6a35', C: '#2f6b4a', c: '#204d35' } },
  reviewer: { id: 'reviewer', title: 'Reviewer', hairStyle: 'bob', glasses: false, prop: 'magnifier',
    colors: { H: '#e2572b', h: '#b23f1c', C: '#2f8f87', c: '#216a64' } },
  skeptic: { id: 'skeptic', title: 'Skeptic', hairStyle: 'bald', glasses: true, prop: 'question',
    colors: { H: '#8c8c96', h: '#6a6a74', S: '#e8b58a', s: '#c48d63', C: '#c8743a', c: '#9c5629' } },
  optimist: { id: 'optimist', title: 'Optimist', hairStyle: 'spiky', glasses: false, prop: 'bulb',
    colors: { H: '#f4d23c', h: '#c9a722', C: '#2d3f7a', c: '#1f2d5a' } },
}

// Which role an agent gets: first rule whose pattern matches its description
// or type wins; otherwise a stable pick from the fallback list.
export const ROLE_RULES: Array<{ role: RoleId; match: RegExp }> = [
  { role: 'deployer', match: /deploy|ship|push|release|promote|staging|merge/i },
  { role: 'reviewer', match: /review|verify|check|qa\b|test|smoke|go\/no-go/i },
  { role: 'researcher', match: /research|find|look ?up|investigat|explore|search|owner/i },
  { role: 'planner', match: /plan|triage|scope|roadmap|brainstorm/i },
  { role: 'writer', match: /write|one-?pager|doc|summary|compound|lesson|copy/i },
  { role: 'analyst', match: /analy|audit|data|report|metric|count|query/i },
  { role: 'maintainer', match: /fix|repair|env|sandbox|cleanup|maint|config|migrat/i },
  { role: 'coder', match: /implement|build|code|feature|refactor|#\d+/i },
  { role: 'skeptic', match: /risk|security|guard|gap|doubt/i },
  { role: 'optimist', match: /idea|ideate|improv|optimi[sz]e/i },
]
export const FALLBACK_ROLES: RoleId[] = ['coder', 'researcher', 'analyst', 'writer', 'planner', 'reviewer', 'maintainer', 'optimist', 'skeptic', 'deployer']

export function roleFor(text: string, seed: number): RoleId {
  for (const r of ROLE_RULES) if (r.match.test(text)) return r.role
  return FALLBACK_ROLES[seed % FALLBACK_ROLES.length] as RoleId
}

export function paletteFor(role: RoleId): Palette {
  return { ...BASE, ...FURNITURE, ...ROLES[role].colors } as Palette
}

// ---------- Grid helpers ----------

export const SPRITE_W = 16
export const SPRITE_H = 24

export function grid(w: number, h: number): Grid {
  return Array.from({ length: h }, () => Array.from({ length: w }, () => '.'))
}
function rect(g: Grid, x: number, y: number, w: number, h: number, k: string) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (g[j] && i >= 0 && i < (g[j] as string[]).length) (g[j] as string[])[i] = k
}
function dot(g: Grid, x: number, y: number, k: string) {
  rect(g, x, y, 1, 1, k)
}
const at = (g: Grid, x: number, y: number) => g[y]?.[x] ?? '.'

/** Adds a 1px dark outline around every filled region (classic 16-bit look). */
export function outline(g: Grid): Grid {
  const out = g.map(r => [...r])
  for (let y = 0; y < g.length; y++) {
    for (let x = 0; x < (g[y] as string[]).length; x++) {
      if (at(g, x, y) !== '.') continue
      if (at(g, x - 1, y) !== '.' || at(g, x + 1, y) !== '.' || at(g, x, y - 1) !== '.' || at(g, x, y + 1) !== '.') {
        ;(out[y] as string[])[x] = 'O'
      }
    }
  }
  return out
}
export function mirror(g: Grid): Grid {
  return g.map(r => [...r].reverse())
}

// ---------- Character builder ----------

export type Pose = 'stand' | 'walk' | 'seat' | 'reach' | 'lounge'

export type CharOpts = {
  role: RoleId
  dir: Dir
  pose: Pose
  frame: number // walk: 0..3, seat: 0..3 typing / 0..1 idle, reach: 0..2
  typing?: boolean
  blink?: boolean
  nod?: boolean
}

function hair(g: Grid, style: HairStyle, dir: Dir) {
  // g is drawn facing right for side views; mirrored later for left.
  if (dir === 'up') {
    rect(g, 4, 2, 8, 7, 'H')
    rect(g, 9, 3, 3, 5, 'h')
    if (style === 'long' || style === 'bob') rect(g, 4, 9, 8, style === 'long' ? 3 : 1, 'H')
    if (style === 'bun') rect(g, 7, 0, 2, 2, 'H')
    if (style === 'spiky') { dot(g, 5, 1, 'H'); dot(g, 8, 1, 'H'); dot(g, 10, 1, 'H') }
    if (style === 'curly') { rect(g, 3, 1, 10, 8, 'H'); rect(g, 10, 3, 3, 5, 'h') }
    if (style === 'cap') { rect(g, 4, 1, 8, 3, 'K'); rect(g, 4, 4, 8, 1, 'k') }
    if (style === 'bald') { rect(g, 4, 2, 8, 4, 'S'); rect(g, 4, 6, 8, 3, 'H'); dot(g, 7, 3, 'W') }
    return
  }
  if (dir === 'down') {
    if (style === 'bald') {
      rect(g, 4, 5, 1, 3, 'H'); rect(g, 11, 5, 1, 3, 'H'); dot(g, 6, 3, 'W')
      return
    }
    if (style === 'cap') {
      rect(g, 4, 1, 8, 3, 'K'); rect(g, 3, 4, 10, 1, 'k'); rect(g, 4, 5, 1, 2, 'H'); rect(g, 11, 5, 1, 2, 'H')
      return
    }
    if (style === 'curly') {
      rect(g, 3, 1, 10, 4, 'H'); rect(g, 3, 5, 1, 4, 'H'); rect(g, 12, 5, 1, 4, 'H'); rect(g, 9, 2, 3, 2, 'h')
      return
    }
    rect(g, 4, 2, 8, 2, 'H')
    rect(g, 9, 3, 3, 1, 'h')
    rect(g, 4, 4, 1, 2, 'H')
    rect(g, 11, 4, 1, 1, 'H')
    if (style === 'spiky') { dot(g, 5, 1, 'H'); dot(g, 7, 1, 'H'); dot(g, 9, 1, 'H'); dot(g, 11, 1, 'H') }
    if (style === 'bun') rect(g, 7, 0, 2, 2, 'H')
    if (style === 'long') { rect(g, 4, 4, 1, 8, 'H'); rect(g, 11, 4, 1, 8, 'H'); rect(g, 3, 6, 1, 6, 'h'); rect(g, 12, 6, 1, 6, 'h') }
    if (style === 'bob') { rect(g, 4, 4, 1, 5, 'H'); rect(g, 11, 4, 1, 5, 'H'); rect(g, 5, 4, 3, 1, 'H') }
    return
  }
  // side (facing right)
  if (style === 'bald') { rect(g, 5, 5, 2, 3, 'H'); dot(g, 7, 3, 'W'); return }
  if (style === 'cap') { rect(g, 5, 1, 7, 3, 'K'); rect(g, 10, 4, 4, 1, 'k'); rect(g, 5, 4, 2, 3, 'H'); return }
  if (style === 'curly') { rect(g, 4, 1, 9, 4, 'H'); rect(g, 4, 5, 3, 4, 'H'); return }
  rect(g, 5, 2, 7, 2, 'H')
  rect(g, 5, 4, 2, 3, 'H')
  rect(g, 6, 4, 1, 3, 'h')
  if (style === 'spiky') { dot(g, 6, 1, 'H'); dot(g, 8, 1, 'H'); dot(g, 10, 1, 'H') }
  if (style === 'bun') rect(g, 4, 2, 2, 2, 'H')
  if (style === 'long') rect(g, 4, 4, 3, 8, 'H')
  if (style === 'bob') rect(g, 4, 4, 3, 5, 'H')
}

function face(g: Grid, role: Role, dir: Dir, blink: boolean) {
  if (dir === 'up') return
  if (dir === 'down') {
    if (role.glasses) {
      rect(g, 5, 5, 3, 1, 'G'); rect(g, 8, 5, 3, 1, 'G')
      dot(g, 5, 6, 'G'); dot(g, 6, 6, blink ? 'G' : 'L'); dot(g, 7, 6, 'G')
      dot(g, 8, 6, 'G'); dot(g, 9, 6, blink ? 'G' : 'L'); dot(g, 10, 6, 'G')
    } else {
      dot(g, 6, 6, blink ? 's' : 'E'); dot(g, 9, 6, blink ? 's' : 'E')
    }
    if (role.id === 'optimist') rect(g, 6, 8, 4, 1, 'M')
    else if (role.id === 'skeptic') { dot(g, 7, 8, 'M'); dot(g, 9, 4, 'h') }
    else rect(g, 7, 8, 2, 1, 'M')
    return
  }
  if (role.glasses) { rect(g, 9, 5, 3, 1, 'G'); dot(g, 9, 6, 'G'); dot(g, 10, 6, blink ? 'G' : 'L'); dot(g, 11, 6, 'G'); rect(g, 7, 6, 2, 1, 'G') }
  else dot(g, 10, 6, blink ? 's' : 'E')
  dot(g, 12, 7, 'S')
  dot(g, 10, 8, 'M')
}

/** One character frame, outlined, 16 x 24. */
export function character(o: CharOpts): Grid {
  const role = ROLES[o.role]
  const g = grid(SPRITE_W, SPRITE_H)
  const side = o.dir === 'left' || o.dir === 'right'
  const bob = o.nod ? 1 : 0

  // head
  if (side) rect(g, 5, 2 + bob, 7, 8, 'S')
  else { rect(g, 4, 2 + bob, 8, 8, 'S'); if (o.dir === 'down') rect(g, 11, 4 + bob, 1, 6, 's') }
  const hg = grid(SPRITE_W, SPRITE_H)
  hair(hg, role.hairStyle, o.dir === 'left' ? 'right' : o.dir)
  for (let y = 0; y < SPRITE_H; y++) for (let x = 0; x < SPRITE_W; x++) if (at(hg, x, y) !== '.') (g[Math.min(SPRITE_H - 1, y + bob)] as string[])[x] = at(hg, x, y)
  const fg = grid(SPRITE_W, SPRITE_H)
  face(fg, role, o.dir === 'left' ? 'right' : o.dir, !!o.blink)
  for (let y = 0; y < SPRITE_H; y++) for (let x = 0; x < SPRITE_W; x++) if (at(fg, x, y) !== '.') (g[Math.min(SPRITE_H - 1, y + bob)] as string[])[x] = at(fg, x, y)

  // torso
  if (side) {
    rect(g, 6, 10, 5, 6, 'C'); rect(g, 6, 11, 1, 5, 'c')
  } else {
    rect(g, 4, 10, 8, 6, 'C'); rect(g, 10, 11, 2, 5, 'c')
    if (o.dir === 'down') { dot(g, 7, 10, 'W'); dot(g, 8, 10, 'W') }
  }

  const f = o.frame % 4
  // arms + legs per pose
  if (o.pose === 'lounge') {
    // leaning back, hands behind the head, whistling
    rect(g, 2, 4, 2, 7, 'C'); rect(g, 12, 4, 2, 7, 'C') // arms up
    rect(g, 3, 3, 1, 2, 'S'); rect(g, 12, 3, 1, 2, 'S') // hands behind the head
    rect(g, 6, 8, 4, 1, 'S') // clear the usual mouth
    dot(g, 8, 8, 'M') // a little 'o' for whistling
    rect(g, 4, 16, 8, 2, 'P') // lap, hidden by the desk
  } else if (o.pose === 'seat') {
    // forearms forward onto the desk; typing alternates hands
    const lUp = o.typing && f === 0
    const rUp = o.typing && f === 2
    rect(g, 3, 11, 1, 4, 'C'); rect(g, 12, 11, 1, 4, 'C')
    rect(g, 4, lUp ? 14 : 15, 2, 1, 'S')
    rect(g, 10, rUp ? 14 : 15, 2, 1, 'S')
    rect(g, 4, 16, 8, 2, 'P') // lap, hidden by desk
  } else if (o.pose === 'reach') {
    if (side) {
      rect(g, 9, 11, 1, 2, 'C'); rect(g, 10, 12, 3, 1, 'C'); rect(g, 13, 12, 1, 1, 'S')
    } else if (o.dir === 'up') {
      rect(g, 3, 11, 1, 4, 'C'); rect(g, 12, 8, 1, 4, 'C'); dot(g, 12, 7, 'S')
    } else {
      rect(g, 3, 11, 1, 4, 'C'); dot(g, 3, 15, 'S'); rect(g, 12, 11, 1, 2, 'C'); rect(g, 12, 13, 2, 1, 'S')
    }
    legs(g, side, 0)
  } else {
    const walking = o.pose === 'walk'
    const phase = walking ? f : 0
    if (side) {
      const handX = phase === 1 ? 10 : phase === 3 ? 6 : 8
      rect(g, 8, 11, 1, 3, 'C'); dot(g, handX, 14, 'S'); if (handX !== 8) dot(g, (handX + 8) / 2, 13, 'C')
    } else {
      const lHand = phase === 1 ? 14 : 15
      const rHand = phase === 3 ? 14 : 15
      rect(g, 3, 11, 1, lHand - 11, 'C'); dot(g, 3, lHand, 'S')
      rect(g, 12, 11, 1, rHand - 11, 'C'); dot(g, 12, rHand, 'S')
    }
    legs(g, side, phase)
  }

  const out = outline(g)
  return o.dir === 'left' ? mirror(out) : out
}

function legs(g: Grid, side: boolean, phase: number) {
  if (side) {
    if (phase === 1) { rect(g, 9, 16, 2, 4, 'P'); rect(g, 9, 20, 3, 1, 'F'); rect(g, 6, 16, 2, 3, 'P'); rect(g, 5, 19, 3, 1, 'F') }
    else if (phase === 3) { rect(g, 6, 16, 2, 4, 'P'); rect(g, 6, 20, 3, 1, 'F'); rect(g, 9, 16, 2, 3, 'P'); rect(g, 9, 19, 3, 1, 'F') }
    else { rect(g, 7, 16, 3, 4, 'P'); rect(g, 7, 20, 4, 1, 'F') }
    return
  }
  const lLift = phase === 1 ? 1 : 0
  const rLift = phase === 3 ? 1 : 0
  rect(g, 5, 16, 3, 4 - lLift, 'P'); rect(g, 5, 20 - lLift, 3, 1, 'F')
  rect(g, 8, 16, 3, 4 - rLift, 'P'); rect(g, 8, 20 - rLift, 3, 1, 'F')
}

// ---------- Props, bubbles, packets (8 x 8 unless noted) ----------

const ICONS: Record<PropIcon, string[]> = {
  clipboard: ['..qq....', '.WWWW...', '.WxxW...', '.WWWW...', '.WxxW...', '.WWWW...', '........', '........'],
  book: ['........', '.RRRR...', '.WWWW...', '.CCCC...', '.WWWW...', '.VVVV...', '........', '........'],
  code: ['........', 'N.NN....', '.N.NNN..', 'NN.N....', '.NNN.N..', '........', '........', '........'],
  doc: ['.WWWW...', '.WxxW...', '.WWWW...', '.WxxW...', '.WWWW...', '........', '........', '........'],
  chart: ['......C.', '....C.C.', '..C.C.C.', '..C.C.C.', 'C.C.C.C.', 'xxxxxxx.', '........', '........'],
  wrench: ['.X.X....', '.XXX....', '..X.....', '..X.....', '..X.....', '..X.....', '........', '........'],
  cloud: ['..WWW...', '.WWWWW..', 'WWWWWWW.', 'WWWWWWW.', '...C....', '..CCC...', '...C....', '........'],
  magnifier: ['.TTT....', 'T.L.T...', 'TL..T...', 'T...T...', '.TTTq...', '....qq..', '.....qq.', '........'],
  question: ['.RRR....', 'R...R...', '...R....', '..R.....', '..R.....', '........', '..R.....', '........'],
  bulb: ['.YYY....', 'YYYYY...', 'YYWYY...', 'YYYYY...', '.YYY....', '.xxx....', '..x.....', '........'],
  mug: ['........', 'wwww....', 'wwwww...', 'www.w...', 'wwwww...', 'wwww....', '........', '........'],
}

export function icon(p: PropIcon): Grid {
  return outline(padded(ICONS[p]))
}
function padded(rows: string[]): Grid {
  const g = grid(10, 10)
  rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch !== '.') (g[y + 1] as string[])[x + 1] = ch }))
  return g
}

export const CHECK: Grid = outline(padded(['......V.', '.....VV.', 'V...VV..', 'VV.VV...', '.VVV....', '..V.....', '........', '........']))
export const PACKET_OK: Grid = outline(padded(['WWWW', 'WxxW', 'WWWW', 'WxxW', 'WWWW']))
export const PACKET_ERR: Grid = outline(padded(['RRRR', 'RWWR', 'RRRR', 'RWWR', 'RRRR']))
export const BUBBLE_DOTS: Grid = outline(padded(['WWWWWW', 'WEWEWE'.replace(/E/g, 'x'), 'WWWWWW', '.W....']))

/** A worker doing a push-up, side view (22 x 10), arms straight (up) or bent. */
export function pushup(role: RoleId, up: boolean): Grid {
  const r = ROLES[role]
  const g = grid(22, 10)
  const o = up ? 0 : 2
  rect(g, 1, 5 + o / 2, 6, 2, 'P') // legs
  rect(g, 0, 7, 2, 1, 'F') // feet
  rect(g, 7, 3 + o, 9, 3, 'C') // body
  rect(g, 16, 1 + o, 5, 5, 'S') // head
  rect(g, 16, 1 + o, 5, 2, r.hairStyle === 'bald' ? 'S' : r.hairStyle === 'cap' ? 'K' : 'H')
  dot(g, 19, 3 + o, 'E')
  rect(g, 14, 6 + o, 2, 3 - o, 'S') // arm to the floor
  return outline(g)
}

/** The Boss's crossed feet propped up on the desk (12 x 5), pointing left. */
export function feetUp(role: RoleId): Grid {
  void role
  const g = grid(12, 5)
  rect(g, 4, 1, 8, 2, 'P') // shins
  rect(g, 0, 0, 4, 3, 'F') // shoes
  rect(g, 0, 3, 4, 1, 'X') // light soles so they read on the desk
  rect(g, 2, 2, 3, 2, 'F')
  return outline(g)
}
