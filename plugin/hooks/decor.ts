// The decor catalog: wall colors, floors, and the furniture an office can hold,
// plus where each piece may stand and the strict checks that keep anything else
// out. Pure data and functions (no `$`). It is the office section of the art
// catalog (see ./catalog.ts for the Boss section); ./decorart.ts draws it and
// ./decorate.ts is the command. Themes can serialize an `OfficeLook` as is.
//
// Every slot sits where nobody walks: the back wall above the break area, the
// vending machine's own spot in the break area, and a row along the bottom wall
// (a strip added under the last row of desks, so it never touches an aisle,
// a desk, the door or a break spot).

import type { Entry } from './catalog'

// ----- walls and floors -----

export type WallDef = Entry & { wall: string; base: string }
/** The first entry is today's wall, so the default draws exactly as it always has. */
export const WALLS: readonly WallDef[] = [
  { id: 'slate', label: 'Slate blue', wall: '#6f86a3', base: '#4e6380' },
  { id: 'teal', label: 'Teal', wall: '#2f9aa0', base: '#1f6f74' },
  { id: 'sage', label: 'Sage green', wall: '#8fae8b', base: '#6b8a67' },
  { id: 'cream', label: 'Cream', wall: '#e3d9b8', base: '#bdb08a' },
  { id: 'rose', label: 'Rose', wall: '#d98f9a', base: '#b06670' },
  { id: 'lavender', label: 'Lavender', wall: '#9a8fd0', base: '#7569a8' },
  { id: 'brick', label: 'Brick red', wall: '#b5654a', base: '#8a4733' },
  { id: 'mustard', label: 'Mustard', wall: '#d6a93b', base: '#a9822a' },
  { id: 'charcoal', label: 'Charcoal', wall: '#5a5f70', base: '#3d4150' },
]

export type FloorPattern = 'tiles' | 'checker' | 'planks' | 'carpet'
/** `base` is the floor color (it also fills the panel), `alt` the second shade of the pattern. */
export type FloorDef = Entry & { pattern: FloorPattern; base: string; alt: string }
export const FLOORS: readonly FloorDef[] = [
  { id: 'slate-tiles', label: 'Slate tiles', pattern: 'tiles', base: '#8ea1ba', alt: '#97a9c1' },
  { id: 'checker-gray', label: 'Gray checkerboard', pattern: 'checker', base: '#cfd2dc', alt: '#b4b9c8' },
  { id: 'oak-planks', label: 'Oak planks', pattern: 'planks', base: '#c9a06b', alt: '#b58a55' },
  { id: 'green-carpet', label: 'Green carpet', pattern: 'carpet', base: '#7fb08a', alt: '#6c9d77' },
  { id: 'rose-carpet', label: 'Rose carpet', pattern: 'carpet', base: '#cf9a9e', alt: '#bd868b' },
  { id: 'sand-tiles', label: 'Sand tiles', pattern: 'tiles', base: '#dccfae', alt: '#e8dcbf' },
  { id: 'blue-checker', label: 'Blue checkerboard', pattern: 'checker', base: '#9db8e0', alt: '#84a2d0' },
  { id: 'gray-carpet', label: 'Gray carpet', pattern: 'carpet', base: '#a8adb9', alt: '#969ba8' },
]

// ----- furniture and wall pieces -----

/** wall: hangs on the back wall. floor: stands along the bottom wall. break: has its own spot in the break area. */
export type Place = 'wall' | 'floor' | 'break'
/** w and h are the drawn size in logical pixels, outline included (./decorart.ts builds grids of exactly this size). */
export type ItemDef = Entry & { place: Place; w: number; h: number }
export const ITEMS: readonly ItemDef[] = [
  { id: 'vending-machine', label: 'Vending machine', place: 'break', w: 18, h: 26 },
  { id: 'arcade-cabinet', label: 'Arcade cabinet', place: 'floor', w: 16, h: 26 },
  { id: 'couch', label: 'Couch', place: 'floor', w: 36, h: 14 },
  { id: 'potted-fern', label: 'Potted fern', place: 'floor', w: 12, h: 18 },
  { id: 'cactus', label: 'Cactus', place: 'floor', w: 10, h: 18 },
  { id: 'lava-lamp', label: 'Lava lamp', place: 'floor', w: 12, h: 20 },
  { id: 'fish-tank', label: 'Fish tank', place: 'floor', w: 26, h: 22 },
  { id: 'poster-mountain', label: 'Mountain poster', place: 'wall', w: 14, h: 16 },
  { id: 'poster-cat', label: 'Cat poster', place: 'wall', w: 14, h: 16 },
  { id: 'poster-rocket', label: 'Rocket poster', place: 'wall', w: 14, h: 16 },
  { id: 'poster-sunset', label: 'Sunset poster', place: 'wall', w: 14, h: 16 },
]

export type SlotDef = Entry & { place: Place }
export const SLOTS: readonly SlotDef[] = [
  { id: 'break', label: 'the break area', place: 'break' },
  { id: 'wall-door', label: 'the wall by the door', place: 'wall' },
  { id: 'wall-table', label: 'the wall over the meeting table', place: 'wall' },
  { id: 'wall-cooler', label: 'the wall by the water cooler', place: 'wall' },
  { id: 'bottom-1', label: 'the bottom wall, far left', place: 'floor' },
  { id: 'bottom-2', label: 'the bottom wall, left', place: 'floor' },
  { id: 'bottom-3', label: 'the bottom wall, middle', place: 'floor' },
  { id: 'bottom-4', label: 'the bottom wall, right', place: 'floor' },
  { id: 'bottom-5', label: 'the bottom wall, far right', place: 'floor' },
]

export const wallOf = (id: string): WallDef | undefined => WALLS.find((w) => w.id === id)
export const floorOf = (id: string): FloorDef | undefined => FLOORS.find((f) => f.id === id)
export const itemOf = (id: string): ItemDef | undefined => ITEMS.find((i) => i.id === id)
export const slotOf = (id: string): SlotDef | undefined => SLOTS.find((s) => s.id === id)
export const DEFAULT_WALL = 'slate'
export const DEFAULT_FLOOR = 'slate-tiles'

/** A few good starting picks per step (a dialog holds 2 to 4 options; "Other" is its own field). */
export const FEATURED = {
  furniture: ['vending-machine', 'arcade-cabinet', 'couch', 'lava-lamp'],
  wall: ['teal', 'cream', 'sage'],
  floor: ['oak-planks', 'green-carpet', 'checker-gray'],
} as const

// ----- the look -----

/** Everything the office remembers: a wall color, a floor, and the piece standing in each slot. */
export type OfficeLook = { wall: string; floor: string; items: Record<string, string> }
export const DEFAULT_OFFICE: Readonly<OfficeLook> = { wall: DEFAULT_WALL, floor: DEFAULT_FLOOR, items: {} }

export function isDefaultOffice(l: OfficeLook | undefined | null): boolean {
  return !l || (l.wall === DEFAULT_WALL && l.floor === DEFAULT_FLOOR && Object.keys(l.items).length === 0)
}
export function sameOffice(a: OfficeLook, b: OfficeLook): boolean {
  const ka = Object.keys(a.items).sort()
  const kb = Object.keys(b.items).sort()
  return a.wall === b.wall && a.floor === b.floor && ka.length === kb.length && ka.every((k, i) => k === kb[i] && a.items[k] === b.items[k])
}

/** Can this piece stand in this slot? (Same kind of place.) */
export function fits(itemId: string, slotId: string): boolean {
  const i = itemOf(itemId)
  const s = slotOf(slotId)
  return !!i && !!s && i.place === s.place
}

/** A saved or incoming office: valid parts are kept, anything else falls back to the default. Never throws. */
export function sanitizeOffice(v: unknown): OfficeLook {
  const o = typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  const wall = typeof o.wall === 'string' && wallOf(o.wall) ? o.wall : DEFAULT_WALL
  const floor = typeof o.floor === 'string' && floorOf(o.floor) ? o.floor : DEFAULT_FLOOR
  const items: Record<string, string> = {}
  const raw = typeof o.items === 'object' && o.items !== null && !Array.isArray(o.items) ? (o.items as Record<string, unknown>) : {}
  for (const s of SLOTS) {
    const x = raw[s.id]
    if (typeof x === 'string' && fits(x, s.id)) items[s.id] = x
  }
  return { wall, floor, items }
}

// ----- a patch (from the AI, or from a choice in the panel) -----

export type OfficePatch = {
  wall?: string
  floor?: string
  add?: { item: string; slot?: string }[]
  remove?: string[] // item ids (every copy) or slot ids
}

const MAX_ADD = 6
const MAX_REMOVE = 12

/**
 * A patch from untrusted data (an AI reply): every id present must be in the
 * catalog and every named slot must suit its piece, or the whole thing is
 * refused (R18). Absent and null fields mean "no change". Extra keys are ignored.
 */
export function parseOfficePatch(v: unknown): OfficePatch | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  const out: OfficePatch = {}
  if (o.wall !== undefined && o.wall !== null) {
    if (typeof o.wall !== 'string' || !wallOf(o.wall)) return null
    out.wall = o.wall
  }
  if (o.floor !== undefined && o.floor !== null) {
    if (typeof o.floor !== 'string' || !floorOf(o.floor)) return null
    out.floor = o.floor
  }
  if (o.add !== undefined && o.add !== null) {
    if (!Array.isArray(o.add) || o.add.length > MAX_ADD) return null
    out.add = []
    for (const a of o.add) {
      const r = typeof a === 'string' ? { item: a } : (a as { item?: unknown; slot?: unknown } | null)
      if (!r || typeof r !== 'object' || typeof r.item !== 'string' || !itemOf(r.item)) return null
      const slot = (r as { slot?: unknown }).slot
      if (slot !== undefined && slot !== null) {
        if (typeof slot !== 'string' || !slotOf(slot) || !fits(r.item, slot)) return null
        out.add.push({ item: r.item, slot })
      } else out.add.push({ item: r.item })
    }
  }
  if (o.remove !== undefined && o.remove !== null) {
    if (!Array.isArray(o.remove) || o.remove.length > MAX_REMOVE) return null
    out.remove = []
    for (const r of o.remove) {
      if (typeof r !== 'string' || !(itemOf(r) || slotOf(r))) return null
      out.remove.push(r)
    }
  }
  return out
}

/** The first free slot that suits a piece, or undefined when they are all taken. */
export function freeSlot(look: OfficeLook, itemId: string): string | undefined {
  return SLOTS.find((s) => fits(itemId, s.id) && !look.items[s.id])?.id
}
export function freeSlots(look: OfficeLook, itemId: string): string[] {
  return SLOTS.filter((s) => fits(itemId, s.id) && !look.items[s.id]).map((s) => s.id)
}

const labelOfItem = (id: string) => itemOf(id)?.label ?? id
const labelOfSlot = (id: string) => slotOf(id)?.label ?? id

/** Apply a validated patch. `notes` names what could not be done (no room, nothing to remove). Pure. */
export function applyPatch(look: OfficeLook, patch: OfficePatch): { look: OfficeLook; notes: string[] } {
  const next: OfficeLook = { wall: patch.wall ?? look.wall, floor: patch.floor ?? look.floor, items: { ...look.items } }
  const notes: string[] = []
  for (const r of patch.remove ?? []) {
    const slots = slotOf(r) ? [r] : Object.keys(next.items).filter((s) => next.items[s] === r)
    const had = slots.filter((s) => next.items[s])
    if (!had.length) notes.push(slotOf(r) ? `There is nothing in ${labelOfSlot(r)} to remove.` : `There is no ${labelOfItem(r).toLowerCase()} to remove.`)
    for (const s of had) delete next.items[s]
  }
  for (const a of patch.add ?? []) {
    const slot = a.slot ?? freeSlot(next, a.item)
    if (!slot) {
      notes.push(`There is no free spot left for the ${labelOfItem(a.item).toLowerCase()}. Remove something first.`)
      continue
    }
    next.items[slot] = a.item
  }
  return { look: next, notes }
}

// ----- words for the user -----

export const pieceLabel = (id: string): string => labelOfItem(id)
export const placeLabel = (slotId: string): string => labelOfSlot(slotId)

/** Lines naming what changes, old to new. Empty when nothing does. */
export function changeLines(from: OfficeLook, to: OfficeLook): string[] {
  const out: string[] = []
  if (from.wall !== to.wall) out.push(`wall color: ${wallOf(from.wall)?.label ?? from.wall} -> ${wallOf(to.wall)?.label ?? to.wall}`)
  if (from.floor !== to.floor) out.push(`floor: ${floorOf(from.floor)?.label ?? from.floor} -> ${floorOf(to.floor)?.label ?? to.floor}`)
  for (const s of SLOTS) {
    const a = from.items[s.id]
    const b = to.items[s.id]
    if (a === b) continue
    if (a && b) out.push(`${labelOfItem(a)} -> ${labelOfItem(b)} in ${s.label}`)
    else if (b) out.push(`add a ${labelOfItem(b).toLowerCase()} in ${s.label}`)
    else if (a) out.push(`remove the ${labelOfItem(a).toLowerCase()} from ${s.label}`)
  }
  return out
}

export function describeOffice(l: OfficeLook): string {
  const parts = [`walls ${wallOf(l.wall)?.label.toLowerCase() ?? l.wall}`, `floor ${floorOf(l.floor)?.label.toLowerCase() ?? l.floor}`]
  const placed = SLOTS.filter((s) => l.items[s.id]).map((s) => `${labelOfItem(l.items[s.id] as string).toLowerCase()} (${s.label})`)
  parts.push(placed.length ? placed.join(', ') : 'no furniture added')
  return parts.join('; ')
}

/** The "closest options" shown when an ask is not in the catalog (R12). */
export function optionsText(kind: 'wall' | 'floor' | 'furniture'): string {
  if (kind === 'wall') return `wall colors: ${WALLS.map((w) => w.label.toLowerCase()).join(', ')}`
  if (kind === 'floor') return `floors: ${FLOORS.map((f) => f.label.toLowerCase()).join(', ')}`
  return `furniture: ${ITEMS.map((i) => i.label.toLowerCase()).join(', ')}`
}
export const KINDS = ['wall', 'floor', 'furniture'] as const
export type Kind = (typeof KINDS)[number]
export function isKind(v: unknown): v is Kind {
  return typeof v === 'string' && (KINDS as readonly string[]).includes(v)
}

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/[\s_-]+/g, ' ')
}
/** Exactly an id or exactly a label (ignoring case and spacing); nothing fuzzy. */
export function exactIn(list: readonly Entry[], text: string): string | undefined {
  const t = norm(text)
  if (!t) return undefined
  return list.find((e) => norm(e.id) === t || norm(e.label) === t)?.id
}

/** What the model is told it may choose from. */
export function catalogForPrompt(): string {
  const slots = SLOTS.map((s) => `${s.id} (${s.place})`).join(' | ')
  return [
    `wall: ${WALLS.map((w) => w.id).join(' | ')}`,
    `floor: ${FLOORS.map((f) => f.id).join(' | ')}`,
    `furniture (place): ${ITEMS.map((i) => `${i.id} (${i.place})`).join(' | ')}`,
    `slots (place): ${slots}`,
  ].join('\n')
}

// ----- where things stand (pure geometry; ./office.ts supplies the room's numbers) -----

/** The numbers of the room the slots hang on. */
export type Geometry = { W: number; baseH: number; tableX: number; stationX: number }
export type Rect = { x: number; y: number; w: number; h: number }

export const SOUTH_H = 30 // the strip added under the desks when anything stands along the bottom wall
export const WALL_PIECE_Y = 11

/** The area a slot reserves. Everything a piece draws stays inside it. */
export function slotRect(slotId: string, g: Geometry): Rect {
  switch (slotId) {
    case 'break': return { x: g.stationX + 22, y: 24, w: 18, h: 26 }
    case 'wall-door': return { x: 30, y: WALL_PIECE_Y, w: 34, h: 16 }
    case 'wall-table': return { x: g.tableX + 22, y: WALL_PIECE_Y, w: 32, h: 16 }
    case 'wall-cooler': return { x: g.W - 54, y: WALL_PIECE_Y, w: 40, h: 16 }
    default: {
      const i = Math.max(0, SLOTS.filter((s) => s.place === 'floor').findIndex((s) => s.id === slotId))
      const cx = Math.round((g.W * (i + 0.5)) / 5)
      return { x: cx - 20, y: g.baseH, w: 40, h: SOUTH_H }
    }
  }
}

/** Where a piece is drawn inside its slot (top-left). */
export function pieceAt(itemId: string, slotId: string, g: Geometry): { x: number; y: number } {
  const r = slotRect(slotId, g)
  const it = itemOf(itemId) as ItemDef
  if (it.place === 'break') return { x: r.x, y: r.y }
  if (it.place === 'wall') return { x: r.x + Math.floor((r.w - it.w) / 2), y: r.y }
  return { x: r.x + Math.floor((r.w - it.w) / 2), y: r.y + r.h - it.h - 1 }
}

/** Does anything stand along the bottom wall? Then the room grows by SOUTH_H. */
export function hasSouth(l: OfficeLook | undefined | null): boolean {
  return !!l && SLOTS.some((s) => s.place === 'floor' && l.items[s.id])
}
