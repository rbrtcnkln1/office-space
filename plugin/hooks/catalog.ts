// The art catalog: the named pieces a customization command may use, plus the
// strict checks that keep anything else out. Pure data and functions (no `$`).
//
// A look is four catalog ids, plus optional clothing colors (top, bottom) and
// drawn-part refs (./parts.ts). The drawing code in ./sprites.ts turns the ids
// into pixels; the AI side (./boss.ts) may only ever name ids from here, so a
// reply that invents anything is rejected before it is drawn or saved (R18).
// Other wave-2 commands (team, office, theme) reuse Catalog/validate/closest.

import type { PartRefs, PartSlot } from './parts'
import { PART_SLOTS, PART_SPECS, sameRefs, sanitizePartRefs } from './parts'

export type Slot = 'hair' | 'hairColor' | 'outfit' | 'accessory' | 'top' | 'bottom'
/** Every slot, in the order the stepped flow walks them. */
export const SLOTS: readonly Slot[] = ['hair', 'hairColor', 'outfit', 'top', 'bottom', 'accessory']
/** The four every look has; `top` and `bottom` are optional (unset = the outfit's own colors). */
export const CORE_SLOTS: readonly Slot[] = ['hair', 'hairColor', 'outfit', 'accessory']
export const OPTIONAL_SLOTS: readonly Slot[] = ['top', 'bottom']
export const SLOT_NAMES: Record<Slot, string> = { hair: 'hair style', hairColor: 'hair color', outfit: 'outfit', accessory: 'accessory', top: 'top color', bottom: 'bottom color' }

export type Entry = { id: string; label: string }
/** How an outfit is detailed over the shared body (see sprites.ts). */
export type OutfitDetail = 'suit' | 'hoodie' | 'tee' | 'track' | 'cardigan' | 'coat'

export type HairStyleId = 'short' | 'spiky' | 'curly' | 'long' | 'bob' | 'bun' | 'bald' | 'frosted'
export type AccessoryId = 'glasses' | 'headphones' | 'cap' | 'tie' | 'scarf' | 'none'

export const HAIR_STYLES: readonly (Entry & { id: HairStyleId })[] = [
  { id: 'short', label: 'Short and neat' },
  { id: 'spiky', label: 'Spiky' },
  { id: 'curly', label: 'Curly' },
  { id: 'long', label: 'Long' },
  { id: 'bob', label: 'Bob' },
  { id: 'bun', label: 'Bun' },
  { id: 'bald', label: 'Bald' },
  { id: 'frosted', label: 'Frosted tips' },
]

// H is the hair, h its shade. 'pink' and friends are the fun ones.
export const HAIR_COLORS: readonly (Entry & { H: string; h: string })[] = [
  { id: 'dark-brown', label: 'Dark brown', H: '#2b1d14', h: '#1a110b' },
  { id: 'black', label: 'Black', H: '#18161d', h: '#0c0b10' },
  { id: 'brown', label: 'Brown', H: '#6b4426', h: '#4b2f19' },
  { id: 'auburn', label: 'Auburn', H: '#8a3a1e', h: '#62271a' },
  { id: 'red', label: 'Red', H: '#d4442c', h: '#a32f1c' },
  { id: 'orange', label: 'Orange', H: '#e8802c', h: '#b85f1c' },
  { id: 'blonde', label: 'Blonde', H: '#e8c04f', h: '#b8922c' },
  { id: 'gray', label: 'Gray', H: '#8c8c96', h: '#6a6a74' },
  { id: 'white', label: 'White', H: '#ecebf2', h: '#c4c3d0' },
  { id: 'pink', label: 'Pink', H: '#f27bb5', h: '#c4568d' },
  { id: 'purple', label: 'Purple', H: '#8a4fd0', h: '#6532a3' },
  { id: 'blue', label: 'Blue', H: '#3f7ee8', h: '#2a5bb3' },
  { id: 'teal', label: 'Teal', H: '#2fb5a8', h: '#1f877d' },
  { id: 'green', label: 'Green', H: '#4fb85a', h: '#368a40' },
]

// C clothes, c shade, P pants, F shoes (palette keys; see sprites.ts BASE).
// `bottom: false` means the outfit is one piece (a suit): its top color colors the trousers too.
export const OUTFITS: readonly (Entry & { C: string; c: string; P: string; F: string; detail: OutfitDetail; bottom: boolean })[] = [
  { id: 'suit', label: 'Dark suit', C: '#2f3242', c: '#20222e', P: '#1d1f2a', F: '#20202a', detail: 'suit', bottom: false },
  { id: 'hoodie', label: 'Gray hoodie', C: '#8a8fa0', c: '#686d7e', P: '#2e3550', F: '#e8e8f0', detail: 'hoodie', bottom: true },
  { id: 'tee', label: 'T-shirt and jeans', C: '#e2572b', c: '#b23f1c', P: '#4a6a9e', F: '#f4f1e8', detail: 'tee', bottom: true },
  { id: 'early-2000s', label: 'Early-2000s track jacket', C: '#2a6fd6', c: '#1d4fa3', P: '#8aa5cc', F: '#f4f1e8', detail: 'track', bottom: true },
  { id: 'cardigan', label: 'Cozy cardigan', C: '#b8863f', c: '#8f6628', P: '#5a4a3a', F: '#3a2a1e', detail: 'cardigan', bottom: true },
  { id: 'lab-coat', label: 'White lab coat', C: '#eceaf2', c: '#c3c0d0', P: '#3b4560', F: '#20202a', detail: 'coat', bottom: true },
]

/** Clothing colors, for the top (C, shade c) and the bottom (P = C). Named like the hair colors. */
export const CLOTH_COLORS: readonly (Entry & { C: string; c: string })[] = [
  { id: 'white', label: 'White', C: '#eceaf2', c: '#c3c0d0' },
  { id: 'black', label: 'Black', C: '#2a2832', c: '#18171d' },
  { id: 'gray', label: 'Gray', C: '#8a8fa0', c: '#686d7e' },
  { id: 'red', label: 'Red', C: '#d23b30', c: '#9e2a22' },
  { id: 'orange', label: 'Orange', C: '#e8802c', c: '#b85f1c' },
  { id: 'yellow', label: 'Yellow', C: '#e8c23f', c: '#b8952a' },
  { id: 'green', label: 'Green', C: '#4f9a52', c: '#37753a' },
  { id: 'teal', label: 'Teal', C: '#2f8f87', c: '#216a64' },
  { id: 'blue', label: 'Blue', C: '#3c6fc4', c: '#2a5196' },
  { id: 'navy', label: 'Navy', C: '#2a3560', c: '#1c2444' },
  { id: 'purple', label: 'Purple', C: '#7a4fc0', c: '#5a3592' },
  { id: 'pink', label: 'Pink', C: '#ec7cb0', c: '#c0588a' },
  { id: 'brown', label: 'Brown', C: '#7a5032', c: '#573820' },
  { id: 'tan', label: 'Tan', C: '#c9a877', c: '#a3855a' },
  { id: 'denim', label: 'Denim', C: '#4a6a9e', c: '#36507a' },
]

/** Whether an outfit (or a role's own clothes, when none is set) has a bottom with a color of its own. */
export function hasBottom(outfit: string | undefined): boolean {
  const o = outfit ? OUTFITS.find((x) => x.id === outfit) : undefined
  return o ? o.bottom : true
}

export const ACCESSORIES: readonly (Entry & { id: AccessoryId })[] = [
  { id: 'glasses', label: 'Glasses' },
  { id: 'headphones', label: 'Headphones' },
  { id: 'cap', label: 'Baseball cap' },
  { id: 'tie', label: 'Necktie' },
  { id: 'scarf', label: 'Scarf' },
  { id: 'none', label: 'Nothing' },
]

export const CATALOG: Record<Slot, readonly Entry[]> = {
  hair: HAIR_STYLES,
  hairColor: HAIR_COLORS,
  outfit: OUTFITS,
  accessory: ACCESSORIES,
  top: CLOTH_COLORS,
  bottom: CLOTH_COLORS,
}

/** A few good starting picks per step of the stepped flow (a dialog holds 2 to 4 options). */
export const FEATURED: Record<Slot, readonly string[]> = {
  hair: ['spiky', 'curly', 'long'],
  hairColor: ['pink', 'blonde', 'blue'],
  outfit: ['early-2000s', 'hoodie', 'tee'],
  accessory: ['headphones', 'cap', 'tie'],
  top: ['white', 'black', 'red'],
  bottom: ['denim', 'black', 'tan'],
}

/**
 * A look: four catalog ids, plus optional clothing colors and drawn parts
 * (./parts.ts). Unset optional fields mean the outfit's own colors and no
 * drawn part, so a look without them draws exactly as before they existed.
 */
export type BossLook = { hair: HairStyleId; hairColor: string; outfit: string; accessory: AccessoryId; top?: string; bottom?: string; parts?: PartRefs }

/** What the Boss wears until told otherwise; draws exactly as before the catalog existed. */
export const DEFAULT_LOOK: Readonly<BossLook> = { hair: 'short', hairColor: 'dark-brown', outfit: 'suit', accessory: 'glasses' }

export function entry(slot: Slot, id: string): Entry | undefined {
  return CATALOG[slot].find((e) => e.id === id)
}
export function labelOf(slot: Slot, id: string | undefined): string {
  if (id === undefined) return slot === 'top' || slot === 'bottom' ? 'outfit color' : 'default'
  return entry(slot, id)?.label ?? id
}
export function isSlot(v: unknown): v is Slot {
  return typeof v === 'string' && (SLOTS as readonly string[]).includes(v)
}

/** Exactly an id, or exactly a label (ignoring case and spacing); nothing fuzzy. */
export function exactId(slot: Slot, text: string): string | undefined {
  const t = norm(text)
  if (!t) return undefined
  return CATALOG[slot].find((e) => norm(e.id) === t || norm(e.label) === t)?.id
}
function norm(s: string): string {
  return s.trim().toLowerCase().replace(/[\s_-]+/g, ' ')
}

/**
 * A partial look from untrusted data (an AI reply, or the saved copy):
 * every field present must be a catalog id, or the whole thing is refused.
 * Absent and null fields mean "no change". Extra keys are ignored.
 */
export function parseLookPatch(v: unknown): Partial<BossLook> | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  const out: Record<string, string> = {}
  for (const slot of SLOTS) {
    const x = o[slot]
    if (x === undefined || x === null) continue
    if (typeof x !== 'string' || !entry(slot, x)) return null
    out[slot] = x
  }
  return out as Partial<BossLook>
}

/** A saved look: valid fields are kept, anything else falls back to the default. Never throws. */
export function sanitizeLook(v: unknown): BossLook {
  const o = typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  const pick = (slot: Slot): string => {
    const x = o[slot]
    return typeof x === 'string' && entry(slot, x) ? x : (DEFAULT_LOOK as Record<string, string>)[slot] as string
  }
  const look: BossLook = { hair: pick('hair') as HairStyleId, hairColor: pick('hairColor'), outfit: pick('outfit'), accessory: pick('accessory') as AccessoryId }
  for (const s of OPTIONAL_SLOTS) { const x = o[s]; if (typeof x === 'string' && entry(s, x)) (look as Record<string, unknown>)[s] = x }
  const parts = sanitizePartRefs(o.parts)
  if (parts) look.parts = parts
  return look
}

/** A copy without empty optional fields, so equal looks compare (and save) equal. */
export function tidyLook<T extends Partial<BossLook>>(l: T): T {
  const out = { ...l }
  for (const s of OPTIONAL_SLOTS) if (out[s] === undefined) delete out[s]
  const p = { ...(out.parts ?? {}) }
  for (const s of PART_SLOTS) if (!p[s]) delete p[s]
  if (Object.keys(p).length) out.parts = p
  else delete out.parts
  return out
}

export function sameLook(a: BossLook, b: BossLook): boolean {
  return SLOTS.every((s) => a[s] === b[s]) && sameRefs(a.parts, b.parts)
}

/** The "closest options" shown when an ask is not in the catalog (R12). */
export function optionsText(slot: Slot): string {
  return `${SLOT_NAMES[slot]}: ${CATALOG[slot].map((e) => e.label.toLowerCase()).join(', ')}`
}

export function describeLook(look: BossLook): string {
  const colors = [look.top ? `${labelOf('top', look.top).toLowerCase()} top` : '', look.bottom ? `${labelOf('bottom', look.bottom).toLowerCase()} bottom` : ''].filter(Boolean)
  return [
    `hair ${labelOf('hair', look.hair).toLowerCase()}, ${labelOf('hairColor', look.hairColor).toLowerCase()}`,
    `outfit ${labelOf('outfit', look.outfit).toLowerCase()}${colors.length ? ` (${colors.join(', ')})` : ''}`,
    `accessory ${labelOf('accessory', look.accessory).toLowerCase()}`,
  ].join('; ')
}

/** What changes in a look, slot by slot, old to new. `partName` names a drawn part by id. */
export function slotChanges(from: Partial<BossLook>, to: Partial<BossLook>, partName: (id: string) => string = (id) => id): { slot: string; from: string; to: string }[] {
  const out = SLOTS.filter((s) => from[s] !== to[s]).map((s) => ({ slot: SLOT_NAMES[s], from: labelOf(s, from[s]), to: labelOf(s, to[s]) }))
  for (const s of PART_SLOTS) {
    const x = from.parts?.[s]
    const y = to.parts?.[s]
    if ((x ?? '') !== (y ?? '')) out.push({ slot: PART_SPECS[s].label, from: x ? `drawn ${partName(x)}` : 'none', to: y ? `drawn ${partName(y)}` : 'none' })
  }
  return out
}

/** Lines naming what changes, old to new. Empty when nothing does. */
export function changeLines(from: BossLook, to: BossLook, partName?: (id: string) => string): string[] {
  return slotChanges(from, to, partName).map((c) => `${c.slot}: ${c.from} -> ${c.to}`)
}

/** What the model is told it may choose from. */
export function catalogForPrompt(): string {
  return SLOTS.map((s) => `${s}: ${CATALOG[s].map((e) => e.id).join(' | ')}`).join('\n')
}

// ----- reading plain words (the AI side of the look commands) -----

/** The allowed ids with their names, so the model can map everyday words ("silver", "jeans") onto them. */
export function describedCatalog(slots: readonly Slot[] = SLOTS): string {
  return slots.map((s) => `${s}: ${CATALOG[s].map((e) => (norm(e.id) === norm(e.label) ? e.id : `${e.id} (${e.label})`)).join(' | ')}`).join('\n')
}

/** How the model maps words onto the catalog; shared by the Boss and team prompts. */
export const MATCHING_RULES =
  'Map everyday words, synonyms and near matches onto the closest allowed id (silver, grey or salt-and-pepper hair is gray; platinum is white; golden is blonde; ginger is orange; jeans or a graphic tee is tee). ' +
  'The color of a garment is a color id: top for the shirt, jacket or dress, bottom for the trousers, jeans or skirt (blue jeans are denim, khaki is tan, beige is tan, maroon is red). ' +
  'A brand is left out. A picture or print on a shirt, shoes, a hat other than a baseball cap, facial hair and other things worn or held that no id covers are unknown (with the kind of part that could be drawn). ' +
  'If two or more ids fit about equally, do not guess: list that part as vague. ' +
  'Things that could never be drawn on a tiny sprite (tattoos, jewelry, makeup, a smell, a mood) are never unknown: list them as missing.'

// Everyday asks for things a look has no part for. A safety net under the
// model's own "missing" list, so the answer never offers unrelated closest options.
// Shoes and facial hair have no catalog part, but can be drawn (see DRAWABLE_KINDS).
const NOT_PARTS: readonly [RegExp, string][] = [
  [/\b(shoes?|sneakers?|converse|boots?|heels|sandals|loafers|trainers|socks|slippers)\b/i, 'shoes'],
  [/\btattoos?\b/i, 'tattoos'],
  [/\b(piercings?|earrings?|jewel(le)?ry|necklaces?|bracelets?|rings?|watch(es)?)\b/i, 'jewelry'],
  [/\b(beards?|must(a|ou)ches?|goatees?|stubble|sideburns)\b/i, 'facial hair'],
  [/\b(make-?up|lipstick|eyeliner|mascara|nail polish)\b/i, 'makeup'],
]

/** Kinds of thing with no catalog part that a drawn part (./parts.ts) can still cover. */
export const DRAWABLE_KINDS: Readonly<Record<string, PartSlot>> = { shoes: 'shoes', 'facial hair': 'face' }

/** The kind of thing an ask names when a look has no part for it ("shoes"), or undefined. */
export function notALookPart(text: string): string | undefined {
  return NOT_PARTS.find(([re]) => re.test(text))?.[1]
}

/** "Shoes aren't part of the Boss's look yet." */
export function notAPartLine(kind: string, whose: string): string {
  const k = kind.trim().toLowerCase()
  return `${k.charAt(0).toUpperCase()}${k.slice(1)} ${/s$/.test(k) ? "aren't" : "isn't"} part of ${whose} look yet.`
}

// Hair-color words the model sometimes leaves unmapped; each names exactly one id.
const HAIR_COLOR_WORDS: readonly [RegExp, string][] = [
  [/\b(silver|grey|gray|salt[- ]and[- ]pepper|graying|greying)\b/i, 'gray'],
  [/\b(platinum|snow|snowy|white)\b/i, 'white'],
  [/\b(golden|blond|blonde|flaxen)\b/i, 'blonde'],
  [/\b(ginger|copper)\b/i, 'orange'],
  [/\b(brunette)\b/i, 'brown'],
  [/\b(jet[- ]black|raven)\b/i, 'black'],
]

/** A hair-color id for an everyday word ("silver hair" is gray), or undefined. */
export function hairColorWord(text: string): string | undefined {
  const hits = [...new Set(HAIR_COLOR_WORDS.filter(([re]) => re.test(text)).map(([, id]) => id))]
  return hits.length === 1 ? hits[0] : undefined
}

// Garment color words, for a reply that leaves "blue jeans" or "a white tee" unknown.
const CLOTH_COLOR_WORDS: readonly [RegExp, string][] = [
  [/\b(white|cream|ivory)\b/i, 'white'],
  [/\b(black|charcoal)\b/i, 'black'],
  [/\b(gr[ae]y|silver)\b/i, 'gray'],
  [/\b(red|maroon|crimson|burgundy)\b/i, 'red'],
  [/\b(orange)\b/i, 'orange'],
  [/\b(yellow|gold|mustard)\b/i, 'yellow'],
  [/\b(green|olive|lime)\b/i, 'green'],
  [/\b(teal|turquoise|aqua)\b/i, 'teal'],
  [/\b(navy)\b/i, 'navy'],
  [/\b(blue)\b/i, 'blue'],
  [/\b(purple|violet|lilac)\b/i, 'purple'],
  [/\b(pink|magenta)\b/i, 'pink'],
  [/\b(brown|chocolate)\b/i, 'brown'],
  [/\b(tan|beige|khaki|camel)\b/i, 'tan'],
  [/\b(denim)\b/i, 'denim'],
]
const TOP_WORDS = /\b(tee|t-?shirt|shirt|top|blouse|hoodie|sweater|jumper|jacket|coat|cardigan|dress|polo|vest)s?\b/i
const BOTTOM_WORDS = /\b(jeans|pants|trousers|slacks|shorts|skirt|chinos|leggings)\b/i

/** A garment color in everyday words ("blue jeans" is a denim bottom, "a white tee" a white top), or undefined. */
export function clothColorWord(text: string): { slot: 'top' | 'bottom'; id: string } | undefined {
  const bottom = BOTTOM_WORDS.test(text)
  const top = TOP_WORDS.test(text)
  if (bottom === top) return undefined
  const hits = [...new Set(CLOTH_COLOR_WORDS.filter(([re]) => re.test(text)).map(([, id]) => id))]
  if (bottom && /\bjeans\b/i.test(text) && (!hits.length || (hits.length === 1 && hits[0] === 'blue'))) return { slot: 'bottom', id: 'denim' }
  return hits.length === 1 ? { slot: bottom ? 'bottom' : 'top', id: hits[0] as string } : undefined
}
