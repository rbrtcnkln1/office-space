// Pixel art for the decor catalog (./decor.ts): the furniture and posters as
// pixel grids, and the floor patterns as SVG. Pure (no `$`). ./office.ts turns
// the grids into SVG the same way it does for every other piece of furniture.
//
// Each grid is drawn without an outline; `itemGrid` pads it by one pixel and
// adds the dark outline, so its size is exactly the `w` x `h` the catalog
// declares for the piece.

import { BASE, grid, outline } from './sprites'
import type { Grid, Palette } from './sprites'
import { ITEMS, itemOf } from './decor'
import type { FloorDef } from './decor'

export const DECOR_PAL: Palette = {
  ...BASE,
  a: '#2b3a52', b: '#5b7aa6', n: '#cfd3dc', N: '#8e95a5', r: '#c93b3b', q: '#962a2a',
  y: '#f0c43c', g: '#4fb85a', p: '#f27bb5', u: '#4f8fe0', o: '#e8802c', m: '#d6408f',
  d: '#6b4426', D: '#8a5a30', t: '#b5653a', T: '#8a4a28', f: '#3f9b4a', j: '#2c7a3a',
  z: '#c07a3a', Z: '#94581f', x: '#d99a55', B: '#2a3f8f', X: '#1d2c66',
  w: '#7ec8e3', i: '#a8e0f2', e: '#e4cf9a', v: '#5b2a8c', Q: '#ff7a3c', I: '#9aa3b5',
}

/** How many animation frames a piece has (1 = still). */
export const FRAMES: Record<string, number> = {
  'vending-machine': 4, 'arcade-cabinet': 4, 'lava-lamp': 4, 'fish-tank': 6,
}

const R = (g: Grid, x: number, y: number, w: number, h: number, k: string) => {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (g[j] && i >= 0 && i < (g[j] as string[]).length) (g[j] as string[])[i] = k
}
const D = (g: Grid, x: number, y: number, k: string) => R(g, x, y, 1, 1, k)
const rows = (g: Grid, y: number, list: string[]) => list.forEach((r, j) => [...r].forEach((ch, i) => { if (ch !== '.') D(g, i, y + j, ch) }))

function pad1(g: Grid): Grid {
  const w = (g[0]?.length ?? 0) + 2
  const out = grid(w, g.length + 2)
  g.forEach((r, y) => r.forEach((ch, x) => { (out[y + 1] as string[])[x + 1] = ch }))
  return out
}

function vending(f: number): Grid {
  const g = grid(16, 24)
  R(g, 0, 0, 16, 24, 'r')
  R(g, 15, 0, 1, 24, 'q'); R(g, 0, 22, 16, 2, 'q')
  R(g, 1, 1, 14, 2, 'W')
  for (let x = 3; x < 14; x += 2) D(g, x, 1, x % 4 === 3 ? 'u' : 'o')
  R(g, 1, 4, 10, 9, 'a')
  const shelf = [['o', 'y', 'g', 'u', 'p'], ['u', 'p', 'o', 'g', 'y'], ['g', 'o', 'y', 'p', 'u']]
  shelf.forEach((cols, s) => {
    cols.forEach((c, i) => R(g, 1 + i * 2, 4 + s * 3, 2, 2, c))
    R(g, 1, 6 + s * 3, 10, 1, 'n')
  })
  D(g, 1, 4, 'b'); D(g, 2, 5, 'b')
  R(g, 12, 4, 3, 9, 'n')
  R(g, 12, 4, 3, 3, 'a')
  D(g, 13, 5, f % 2 ? 'Y' : 'V')
  D(g, 13, 8, 'R'); D(g, 13, 10, 'u'); R(g, 13, 12, 1, 1, 'O')
  R(g, 1, 14, 10, 6, 'q'); R(g, 2, 15, 8, 4, 'O'); R(g, 2, 15, 8, 1, 'N')
  R(g, 12, 14, 3, 6, 'N'); D(g, 13, 16, 'O')
  if (f === 3) { D(g, 5, 17, 'p'); D(g, 6, 17, 'p'); D(g, 5, 18, 'p'); D(g, 6, 18, 'p') } // a snack drops
  D(g, 1, 23, 'O'); D(g, 14, 23, 'O')
  return g
}

function arcade(f: number): Grid {
  const g = grid(14, 24)
  R(g, 1, 0, 12, 3, 'm')
  for (let x = 2; x < 12; x += 2) D(g, x, 1, (x / 2 + f) % 2 ? 'Y' : 'W')
  R(g, 0, 3, 14, 10, 'B'); R(g, 13, 3, 1, 21, 'X')
  R(g, 2, 4, 10, 8, 'a')
  const x0 = 3 + (f % 3)
  R(g, x0, 6, 3, 1, 'g'); D(g, x0 + 1, 5, 'g'); D(g, x0, 7, 'g'); D(g, x0 + 2, 7, 'g')
  D(g, 6, 10, 'y'); D(g, 7, 11 - (f % 2), 'y')
  D(g, 3, 4, 'W'); D(g, 10, 8, 'W')
  R(g, 0, 13, 14, 2, 'n'); D(g, 3, 12, 'R'); D(g, 3, 13, 'N'); D(g, 8, 13, 'Y'); D(g, 10, 13, 'V')
  R(g, 1, 15, 12, 7, 'B'); R(g, 4, 17, 6, 3, 'X'); D(g, 5, 18, 'Y'); D(g, 8, 18, 'Y')
  R(g, 1, 22, 12, 2, 'X')
  return g
}

function couch(): Grid {
  const g = grid(34, 12)
  R(g, 2, 0, 30, 6, 'z'); R(g, 2, 0, 30, 1, 'x')
  R(g, 0, 3, 4, 8, 'z'); R(g, 0, 3, 4, 1, 'x')
  R(g, 30, 3, 4, 8, 'z'); R(g, 30, 3, 4, 1, 'x')
  R(g, 4, 6, 26, 5, 'x'); R(g, 4, 10, 26, 1, 'Z')
  for (let y = 6; y < 10; y++) D(g, 17, y, 'Z')
  R(g, 4, 5, 26, 1, 'Z')
  R(g, 6, 3, 4, 4, 'p'); D(g, 6, 6, 'm'); D(g, 9, 6, 'm')
  D(g, 1, 11, 'd'); D(g, 32, 11, 'd')
  return g
}

function fern(): Grid {
  const g = grid(10, 16)
  rows(g, 0, [
    '....jf....',
    '..f.jf.f..',
    '.ffjjfjff.',
    'fjffjffjff',
    'fj.fjf.jf.',
    'f..fjf..f.',
    '...fjf....',
    '...jjj....',
    '....j.....',
    '....j.....',
    '....j.....',
  ])
  R(g, 1, 11, 8, 2, 't'); R(g, 2, 13, 6, 3, 't'); R(g, 1, 12, 8, 1, 'T'); R(g, 2, 15, 6, 1, 'T')
  return g
}

function cactus(): Grid {
  const g = grid(8, 16)
  R(g, 2, 2, 4, 9, 'f'); R(g, 5, 2, 1, 9, 'j'); R(g, 3, 1, 2, 1, 'f')
  R(g, 0, 5, 2, 1, 'f'); R(g, 0, 3, 1, 3, 'f'); R(g, 1, 5, 2, 1, 'f')
  R(g, 6, 6, 2, 1, 'f'); R(g, 7, 4, 1, 3, 'f'); R(g, 5, 6, 2, 1, 'j')
  D(g, 3, 0, 'p'); D(g, 4, 0, 'p'); D(g, 3, 4, 'W'); D(g, 4, 7, 'W')
  R(g, 1, 11, 6, 2, 't'); R(g, 2, 13, 4, 3, 't'); R(g, 1, 12, 6, 1, 'T'); R(g, 2, 15, 4, 1, 'T')
  return g
}

function lavaLamp(f: number): Grid {
  const g = grid(10, 18)
  R(g, 4, 0, 2, 1, 'I')
  R(g, 3, 1, 4, 9, 'v'); R(g, 4, 1, 2, 1, 'v')
  R(g, 3, 10, 4, 2, 'I'); R(g, 2, 12, 6, 1, 'N')
  const y1 = 8 - ((f * 2) % 7)
  const y2 = 2 + ((f * 2) % 6)
  R(g, 4, y1, 2, 2, 'Q'); R(g, 4, y2, 2, 1, 'Q'); D(g, 3, 3 + (f % 3), 'Q')
  D(g, 3, 2, 'p')
  R(g, 0, 13, 10, 2, 'd'); R(g, 0, 13, 10, 1, 'D')
  R(g, 1, 15, 1, 3, 'd'); R(g, 8, 15, 1, 3, 'd')
  return g
}

function fishTank(f: number): Grid {
  const g = grid(24, 20)
  R(g, 0, 0, 24, 13, 'i'); R(g, 1, 1, 22, 11, 'w'); R(g, 0, 0, 24, 1, 'N')
  R(g, 1, 10, 22, 2, 'e')
  R(g, 3, 6, 1, 5, 'f'); D(g, 4, 7, 'j'); D(g, 2, 8, 'f')
  R(g, 19, 7, 1, 4, 'f'); D(g, 20, 8, 'j'); D(g, 18, 9, 'f')
  R(g, 11, 8, 4, 3, 'N'); D(g, 12, 8, 'a'); D(g, 13, 7, 'N')
  const fx = 4 + ((f * 3) % 13)
  R(g, fx, 4, 3, 2, 'o'); D(g, fx + (f % 2 ? 3 : -1), 4, 'o'); D(g, fx + 2, 4, 'O')
  const fy = 3 + ((f + 2) % 3)
  R(g, 17 - ((f * 2) % 9), fy + 2, 2, 1, 'p'); D(g, 19 - ((f * 2) % 9), fy + 2, 'p')
  D(g, 13, 8 - (f % 5), 'W'); D(g, 14, 4 + (f % 3), 'W')
  R(g, 1, 13, 22, 7, 'd'); R(g, 1, 13, 22, 1, 'D'); R(g, 3, 15, 8, 5, 'a'); R(g, 13, 15, 8, 5, 'a')
  return g
}

function poster(kind: 'mountain' | 'cat' | 'rocket' | 'sunset'): Grid {
  const g = grid(12, 14)
  R(g, 0, 0, 12, 14, 'W')
  const x = 1; const y = 1 // the picture is 10 x 12 inside the paper margin
  if (kind === 'mountain') {
    R(g, x, y, 10, 12, 'i')
    R(g, x + 6, y + 1, 2, 2, 'Y')
    for (let r = 0; r < 8; r++) R(g, x + 3 - r, y + 4 + r, 1 + r * 2, 1, r < 2 ? 'W' : 'N')
    for (let r = 0; r < 5; r++) R(g, x + 7 - r, y + 7 + r, 1 + r * 2, 1, 'X')
    R(g, x, y + 11, 10, 1, 'j')
  } else if (kind === 'cat') {
    R(g, x, y, 10, 12, 'e')
    R(g, x + 1, y + 3, 8, 6, 'o'); D(g, x + 1, y + 2, 'o'); D(g, x + 8, y + 2, 'o'); D(g, x + 2, y + 2, 'T'); D(g, x + 7, y + 2, 'T')
    D(g, x + 2, y + 5, 'O'); D(g, x + 3, y + 5, 'O'); D(g, x + 6, y + 5, 'O'); D(g, x + 7, y + 5, 'O')
    D(g, x + 4, y + 7, 'p'); D(g, x + 5, y + 7, 'p'); D(g, x + 4, y + 8, 'O'); D(g, x + 5, y + 8, 'O')
    R(g, x + 2, y + 10, 6, 1, 'd')
  } else if (kind === 'rocket') {
    R(g, x, y, 10, 12, 'X')
    for (const [sx, sy] of [[1, 1], [8, 2], [3, 4], [8, 7], [1, 8], [6, 1]] as const) D(g, x + sx, y + sy, 'W')
    R(g, x + 4, y + 3, 2, 5, 'W'); D(g, x + 4, y + 2, 'r'); D(g, x + 5, y + 2, 'r'); R(g, x + 4, y + 1, 2, 1, 'r')
    D(g, x + 4, y + 4, 'u'); D(g, x + 3, y + 7, 'r'); D(g, x + 6, y + 7, 'r'); D(g, x + 3, y + 8, 'r'); D(g, x + 6, y + 8, 'r')
    R(g, x + 4, y + 8, 2, 2, 'Y'); D(g, x + 4, y + 10, 'o')
  } else {
    R(g, x, y, 10, 3, 'y'); R(g, x, y + 3, 10, 3, 'o'); R(g, x, y + 6, 10, 3, 'q'); R(g, x, y + 9, 10, 3, 'X')
    R(g, x + 3, y + 4, 4, 2, 'Y'); R(g, x + 2, y + 6, 6, 1, 'Y'); R(g, x + 3, y + 5, 4, 1, 'Y')
    R(g, x, y + 9, 10, 1, 'u'); R(g, x + 1, y + 7, 8, 1, 'o')
  }
  return g
}

/** A piece as an outlined grid of exactly the size the catalog declares. `frame` picks the animation frame. */
export function itemGrid(id: string, frame = 0): Grid | undefined {
  const f = Math.abs(Math.floor(frame)) % (FRAMES[id] ?? 1)
  let g: Grid
  switch (id) {
    case 'vending-machine': g = vending(f); break
    case 'arcade-cabinet': g = arcade(f); break
    case 'couch': g = couch(); break
    case 'potted-fern': g = fern(); break
    case 'cactus': g = cactus(); break
    case 'lava-lamp': g = lavaLamp(f); break
    case 'fish-tank': g = fishTank(f); break
    case 'poster-mountain': g = poster('mountain'); break
    case 'poster-cat': g = poster('cat'); break
    case 'poster-rocket': g = poster('rocket'); break
    case 'poster-sunset': g = poster('sunset'); break
    default: return undefined
  }
  return outline(pad1(g))
}

export function itemDeclared(id: string): { w: number; h: number } | undefined {
  const it = itemOf(id)
  return it ? { w: it.w, h: it.h } : undefined
}
export const ALL_ITEM_IDS: readonly string[] = ITEMS.map((i) => i.id)

// ----- floors -----

const hashXY = (x: number, y: number) => ((x * 73856093) ^ (y * 19349663)) >>> 0
const cache = new Map<string, string>()

/** The floor as SVG: the base color, then the pattern on top. Cached per floor and size. */
export function floorSvg(f: FloorDef, W: number, H: number): string {
  const key = `${f.id}-${W}x${H}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  const d: string[] = []
  if (f.pattern === 'tiles') {
    for (let x = 16; x < W; x += 16) d.push(`M${x} 0h1v${H}h-1z`)
    for (let y = 16; y < H; y += 16) d.push(`M0 ${y}h${W}v1h-${W}z`)
  } else if (f.pattern === 'checker') {
    for (let y = 0; y * 16 < H; y++) for (let x = 0; x * 16 < W; x++) if ((x + y) % 2) d.push(`M${x * 16} ${y * 16}h16v16h-16z`)
  } else if (f.pattern === 'planks') {
    for (let y = 0; y * 8 < H; y++) {
      d.push(`M0 ${y * 8 + 7}h${W}v1h-${W}z`)
      const off = (hashXY(y, 3) % 40)
      for (let x = off; x < W; x += 40) d.push(`M${x} ${y * 8}h1v7h-1z`)
    }
  } else {
    for (let y = 0; y < H; y += 4) for (let x = 0; x < W; x += 4) {
      const h = hashXY(x, y)
      if (h % 3 === 0) d.push(`M${x + (h >> 3) % 3} ${y + (h >> 5) % 3}h1v1h-1z`)
    }
  }
  const out = `<rect width="${W}" height="${H}" fill="${f.base}"/><path fill="${f.alt}" d="${d.join('')}"/>`
  if (cache.size > 40) cache.clear()
  cache.set(key, out)
  return out
}

// ---------- Pizza party (see Office.startParty in ./office.ts) ----------

export const PIZZA_PAL: Palette = {
  ...BASE,
  a: '#d9a566', A: '#b9844a', r: '#d94141', h: '#f2c14e', e: '#b83a2e', t: '#c58a4f', c: '#8a5a30',
}

/** The open box on the table: stage 0 is a whole pie, 1 and 2 are slices going, 3 is empty (crumbs only). Padded and outlined. */
export function pizzaOpenGrid(stage: number): Grid {
  const s = Math.max(0, Math.min(3, Math.floor(stage)))
  const g = grid(14, 5)
  rows(g, 0, ['.AAAAAAAAAAAA.', 'aaaaaaaaaaaaaa', 'ahhehhhhehhhha', 'ahhhhehhhhehha', 'aaaaaaaaaaaaaa'])
  const eaten = s === 0 ? 0 : s === 1 ? 4 : s === 2 ? 9 : 12
  for (let x = 13 - eaten; x <= 12; x++) for (let y = 2; y <= 3; y++) D(g, x, y, 'a')
  if (s === 3) { D(g, 3, 2, 'c'); D(g, 8, 3, 'c'); D(g, 11, 2, 'c') }
  return outline(pad1(g))
}

/** Two closed boxes stacked, carried in from the door. Padded and outlined. */
export function pizzaBoxesGrid(): Grid {
  const one = ['aaaaaaaa', 'aarrraaa', 'AAAAAAAA']
  const g = grid(8, 6)
  rows(g, 0, one)
  rows(g, 3, one)
  return outline(pad1(g))
}
