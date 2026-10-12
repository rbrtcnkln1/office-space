// Drawn parts: small pixel grids a model drew when the catalog had nothing for
// what was asked (a cowboy hat, a graphic on a tee, sneakers, a beard...).
// Pure data and functions (no `$`, no imports from the drawing code).
//
// A part is DATA ONLY: a few rows of palette letters, checked letter by letter
// against a fixed size and alphabet before it is drawn, saved or loaded from a
// theme. Nothing in it is ever executed. ./draw.ts asks for one; ./sprites.ts
// lays a part over the character; register.tsx keeps the user's library.

export type PartSlot = 'hat' | 'face' | 'graphic' | 'shoes' | 'held' | 'back'
export const PART_SLOTS: readonly PartSlot[] = ['hat', 'face', 'graphic', 'shoes', 'held', 'back']

export type SlotSpec = {
  label: string
  /** What the part is, for the model. */
  what: string
  /** Where the grid's top-left corner sits on the 16 x 24 front-view sprite (shoes: on each foot). */
  x: number
  y: number
  w: number
  h: number
  /** Fewest and most filled pixels a sensible part has. */
  min: number
  max: number
  /** Grid cells (column, row within the part grid) that must stay transparent: the eyes. */
  keepClear?: (gx: number, gy: number) => boolean
}

export const PART_SPECS: Record<PartSlot, SlotSpec> = {
  hat: {
    label: 'hat', what: 'headwear (a hat, crown, helmet, headband, bow, horns...) worn on top of the head',
    x: 0, y: 0, w: 16, h: 7, min: 8, max: 80,
    keepClear: (gx, gy) => gy >= 5 && gx >= 5 && gx <= 10, // the eyes and brows
  },
  face: {
    label: 'face accessory', what: 'something on the face (a beard, mustache, sunglasses, mask, face paint...)',
    x: 3, y: 4, w: 10, h: 7, min: 3, max: 40,
  },
  graphic: {
    label: 'shirt graphic', what: 'a small picture or logo printed on the front of the shirt',
    x: 5, y: 11, w: 6, h: 4, min: 3, max: 24,
  },
  shoes: {
    label: 'shoes', what: 'one shoe (the same grid is drawn on each foot): top row is the upper, bottom row the sole',
    x: 0, y: 0, w: 3, h: 2, min: 3, max: 6,
  },
  held: {
    label: 'held item', what: 'a small object held in the right hand (a mug, phone, sword, flower...)',
    x: 11, y: 11, w: 5, h: 6, min: 4, max: 24,
  },
  back: {
    label: 'back item', what: 'something worn on the back that shows around the body (wings, a cape, a backpack...)',
    x: 0, y: 6, w: 16, h: 12, min: 8, max: 110,
  },
}

/**
 * The letters a part may use. Most are fixed colours of their own; H, h, S, s,
 * C and c follow the character's hair, skin and clothes, so a beard can match
 * the hair. '.' is transparent.
 */
export const PART_COLORS: Readonly<Record<string, { hex: string; name: string }>> = {
  O: { hex: '#1a1622', name: 'outline (near black)' },
  I: { hex: '#2a2830', name: 'black' },
  i: { hex: '#8c8c96', name: 'gray' },
  U: { hex: '#c9ccd6', name: 'silver' },
  W: { hex: '#f4f1e8', name: 'white' },
  R: { hex: '#e05a4f', name: 'red' },
  o: { hex: '#e8802c', name: 'orange' },
  Y: { hex: '#f4c542', name: 'yellow' },
  y: { hex: '#c9952a', name: 'gold' },
  V: { hex: '#4fbf6a', name: 'green' },
  L: { hex: '#cfe8ff', name: 'light blue' },
  l: { hex: '#3f7ee8', name: 'blue' },
  m: { hex: '#8a4fd0', name: 'purple' },
  f: { hex: '#f27bb5', name: 'pink' },
  e: { hex: '#d8b27a', name: 'tan' },
  B: { hex: '#7a4a26', name: 'brown' },
  b: { hex: '#4e2e16', name: 'dark brown' },
}
/** Letters that take the character's own colours. */
export const LINKED_COLORS: Readonly<Record<string, string>> = { H: 'hair', h: 'hair shade', S: 'skin', s: 'skin shade', C: 'clothes', c: 'clothes shade' }
export const PART_LETTERS = new Set(['.', ...Object.keys(PART_COLORS), ...Object.keys(LINKED_COLORS)])
/** The fixed colours as a palette, merged in only when a look has a drawn part. */
export const PART_PALETTE: Readonly<Record<string, string>> = Object.fromEntries(Object.entries(PART_COLORS).map(([k, v]) => [k, v.hex]))

export const MAX_PARTS = 24
export const MAX_PART_NAME = 30

export type CustomPart = { id: string; name: string; slot: PartSlot; rows: string[] }
/** Which drawn part (by id) a look wears in each part slot. */
export type PartRefs = Partial<Record<PartSlot, string>>
/** Part grids resolved for drawing, by slot. */
export type ResolvedParts = Partial<Record<PartSlot, readonly string[]>>

const plain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
export const isPartSlot = (v: unknown): v is PartSlot => typeof v === 'string' && (PART_SLOTS as readonly string[]).includes(v)

/** A part's name as shown: printable, short, no quotes or brackets. */
export function cleanPartName(s: unknown): string {
  return typeof s === 'string' ? s.replace(/[^\x20-\x7e]/g, ' ').replace(/["'`<>{}\[\]\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_PART_NAME).trim() : ''
}

/** Why a grid is refused, or null when it is fine for the slot. */
export function gridProblem(slot: PartSlot, rows: unknown): string | null {
  const sp = PART_SPECS[slot]
  if (!Array.isArray(rows)) return 'it is not a list of rows'
  if (rows.length !== sp.h) return `it has ${rows.length} rows, not ${sp.h}`
  let filled = 0
  for (let y = 0; y < rows.length; y++) {
    const r = rows[y]
    if (typeof r !== 'string') return `row ${y} is not text`
    if (r.length !== sp.w) return `row ${y} is ${r.length} characters wide, not ${sp.w}`
    for (let x = 0; x < r.length; x++) {
      const ch = r[x] as string
      if (!PART_LETTERS.has(ch)) return `row ${y} uses "${/[\x21-\x7e]/.test(ch) ? ch : '?'}", which is not an allowed letter`
      if (ch === '.') continue
      if (sp.keepClear?.(x, y)) return `it covers the eyes (row ${y}, column ${x})`
      filled++
    }
  }
  if (filled < sp.min) return `it is nearly empty (${filled} pixels; at least ${sp.min})`
  if (filled > sp.max) return `it is too full (${filled} pixels; at most ${sp.max})`
  return null
}

/** A short stable hash of a grid, so a redrawn part gets a new id (and drawings are never cached stale). */
function gridHash(rows: readonly string[]): string {
  let h = 2166136261
  for (const ch of rows.join('|')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0 }
  return h.toString(36).slice(0, 6)
}

export function partId(name: string, rows: readonly string[]): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20) || 'part'
  return `${base}-${gridHash(rows)}`
}
const validId = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9-]{1,32}$/.test(v)

export function makePart(name: string, slot: PartSlot, rows: readonly string[]): CustomPart {
  const n = cleanPartName(name) || PART_SPECS[slot].label
  return { id: partId(n, rows), name: n, slot, rows: [...rows] }
}

/** One part from outside data (a theme file): every field exact, or null. */
export function parsePartStrict(v: unknown): CustomPart | null {
  if (!plain(v)) return null
  for (const k of Object.keys(v)) if (!['id', 'name', 'slot', 'rows'].includes(k)) return null
  if (!validId(v.id) || !isPartSlot(v.slot)) return null
  const name = cleanPartName(v.name)
  if (!name || name !== v.name) return null
  if (gridProblem(v.slot, v.rows)) return null
  return { id: v.id, name, slot: v.slot, rows: [...(v.rows as string[])] }
}

/** The saved library: valid parts kept (first of each id), capped. Never throws. */
export function sanitizeParts(v: unknown): CustomPart[] {
  if (!Array.isArray(v)) return []
  const out: CustomPart[] = []
  for (const x of v) {
    const p = parsePartStrict(x)
    if (p && !out.some((o) => o.id === p.id)) out.push(p)
    if (out.length >= MAX_PARTS) break
  }
  return out
}

/** Adds (or replaces, by id) parts, newest last; the oldest drop off past the cap. */
export function addParts(lib: readonly CustomPart[], add: readonly CustomPart[]): CustomPart[] {
  const ids = new Set(add.map((p) => p.id))
  return [...lib.filter((p) => !ids.has(p.id)), ...add].slice(-MAX_PARTS)
}

/** A part by id, exact name, or name ignoring case and spacing. */
export function findPart(lib: readonly CustomPart[], text: string): CustomPart | undefined {
  const t = text.trim().toLowerCase().replace(/^(my|the)\s+/, '').replace(/\s+/g, ' ')
  return lib.find((p) => p.id === t) ?? lib.find((p) => p.name.toLowerCase() === t)
}

/** Part refs from untrusted data: slot keys and ids only; with `known`, only ids in it. Null on anything malformed. */
export function parsePartRefs(v: unknown, known?: ReadonlyMap<string, CustomPart> | null): PartRefs | null {
  if (!plain(v)) return null
  const out: PartRefs = {}
  for (const [k, id] of Object.entries(v)) {
    if (!isPartSlot(k) || !validId(id)) return null
    if (known) { const p = known.get(id); if (!p || p.slot !== k) return null }
    out[k] = id
  }
  return out
}

/** Part refs from the saved copy: whatever is well formed is kept. */
export function sanitizePartRefs(v: unknown): PartRefs | undefined {
  if (!plain(v)) return undefined
  const out: PartRefs = {}
  for (const s of PART_SLOTS) if (validId(v[s])) out[s] = v[s] as string
  return Object.keys(out).length ? out : undefined
}

export function sameRefs(a: PartRefs | undefined, b: PartRefs | undefined): boolean {
  return PART_SLOTS.every((s) => (a?.[s] ?? '') === (b?.[s] ?? ''))
}

export function resolveParts(refs: PartRefs | undefined, lib: ReadonlyMap<string, CustomPart>): ResolvedParts | undefined {
  if (!refs) return undefined
  const out: ResolvedParts = {}
  for (const s of PART_SLOTS) {
    const id = refs[s]
    const p = id ? lib.get(id) : undefined
    if (p && p.slot === s) out[s] = p.rows
  }
  return Object.keys(out).length ? out : undefined
}

export const libraryMap = (lib: readonly CustomPart[]): Map<string, CustomPart> => new Map(lib.map((p) => [p.id, p]))

export function partsListText(lib: readonly CustomPart[]): string {
  if (!lib.length) return 'You have no drawn parts yet. Ask for something the catalog does not have (a cowboy hat, sneakers, a beard) and press Draw it in the panel.'
  return [
    `Your drawn parts (${lib.length} of ${MAX_PARTS}):`,
    ...lib.map((p) => `  ${p.name} (${PART_SPECS[p.slot].label})`),
    'Reuse one by name ("give the Coder my cowboy hat"), or delete one with: parts delete <name>.',
  ].join('\n')
}
