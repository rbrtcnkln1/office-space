// /office-space-theme: save the current look as a small JSON file, load one
// (yours, a friend's, or a built-in preset) and reset to the defaults.
// Pure (no `$`): ./register.tsx does the file reads and writes.
//
// A theme file is DATA ONLY. Loading checks it key by key against the catalog
// and the team rules; anything unknown, oversized or malformed refuses the
// whole file, and nothing in it is ever executed.
//
//   {
//     "format": "office-space-theme", "version": 1, "name": "night shift",
//     "boss":   { "hair", "hairColor", "outfit", "accessory",             // optional, catalog ids
//                 "top", "bottom", "parts": {slot: part id} },         //   (these three optional too)
//     "team":   { "titles": {role: "text"}, "looks": {role: {...}}, "desks": 5..15 },   // optional
//     "office": { "wall", "floor", "items": {slot: piece} },            // optional, catalog ids (./decor.ts)
//     "parts":  [ { "id", "name", "slot", "rows": [...] } ]             // optional, drawn parts (./parts.ts)
//   }
//
// Clothing colors and drawn parts were added in version 1 as optional fields,
// so every earlier theme file still loads. A part ref must name a part in the
// file's own "parts" list; each part is checked like a fresh drawing.

import { CORE_SLOTS, DEFAULT_LOOK, OPTIONAL_SLOTS, changeLines, entry, sameLook } from './catalog'
import type { BossLook } from './catalog'
import { sanitize } from './external'
import { normalizeTeam, parseTeamStrict, sameTeam, teamLines } from './team'
import type { Team } from './team'
import { PART_SLOTS, libraryMap, parsePartRefs, parsePartStrict } from './parts'
import type { CustomPart } from './parts'
import { DEFAULT_OFFICE, SLOTS as DECOR_SLOTS, changeLines as officeChangeLines, fits, floorOf, isDefaultOffice, sameOffice, sanitizeOffice, slotOf, wallOf } from './decor'
import type { OfficeLook } from './decor'
import type { FlowView } from './flow'

export const THEME_FORMAT = 'office-space-theme'
export const THEME_VERSION = 1
export const MAX_THEME_BYTES = 16384
/** Drawn parts a theme may carry. */
export const MAX_THEME_PARTS = 12
export const MAX_NAME = 40

export type Theme = { name: string; boss?: BossLook; team?: Team; office?: OfficeLook; parts?: CustomPart[] }

const plain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * The office section: the same `OfficeLook` that /office-space-office saves
 * (./decor.ts). Strict, like the rest of the file: only `wall`, `floor` and
 * `items` (slot id -> piece id), every id from the catalog and every piece in a
 * slot it fits. A part left out is the default (plain walls, plain floor, no
 * furniture). Anything else refuses the section, and so the whole file.
 */
export function validateOffice(v: unknown): OfficeLook | null {
  if (!plain(v)) return null
  for (const k of Object.keys(v)) if (k !== 'wall' && k !== 'floor' && k !== 'items') return null
  if (v.wall !== undefined && (typeof v.wall !== 'string' || !wallOf(v.wall))) return null
  if (v.floor !== undefined && (typeof v.floor !== 'string' || !floorOf(v.floor))) return null
  if (v.items !== undefined) {
    if (!plain(v.items)) return null
    const items = v.items
    const keys = Object.keys(items)
    if (keys.length > DECOR_SLOTS.length) return null
    for (const k of keys) {
      const x = items[k]
      if (!slotOf(k) || typeof x !== 'string' || !fits(x, k)) return null
    }
  }
  return sanitizeOffice(v)
}

/** A theme name: short, printable, no path characters (it becomes a file name). */
export function validName(s: unknown): s is string {
  return typeof s === 'string' && s.length > 0 && s.length <= MAX_NAME && sanitize(s) === s && !/[\\/:*?"<>|]/.test(s)
}

function strictBoss(v: unknown, known: ReadonlyMap<string, CustomPart>): BossLook | null {
  if (!plain(v)) return null
  for (const k of Object.keys(v)) if (!(CORE_SLOTS as readonly string[]).includes(k) && !(OPTIONAL_SLOTS as readonly string[]).includes(k) && k !== 'parts') return null
  const out: Record<string, unknown> = {}
  for (const s of CORE_SLOTS) {
    const x = v[s]
    if (typeof x !== 'string' || !entry(s, x)) return null
    out[s] = x
  }
  for (const s of OPTIONAL_SLOTS) {
    const x = v[s]
    if (x === undefined) continue
    if (typeof x !== 'string' || !entry(s, x)) return null
    out[s] = x
  }
  if (v.parts !== undefined) {
    const refs = parsePartRefs(v.parts, known)
    if (!refs) return null
    if (Object.keys(refs).length) out.parts = refs
  }
  return out as unknown as BossLook
}

/** The file's drawn parts: a short list, each checked like a fresh drawing, ids unique. */
function strictParts(v: unknown): CustomPart[] | null {
  if (!Array.isArray(v) || v.length > MAX_THEME_PARTS) return null
  const out: CustomPart[] = []
  for (const x of v) {
    const p = parsePartStrict(x)
    if (!p || out.some((o) => o.id === p.id)) return null
    out.push(p)
  }
  return out
}

export type Parsed = { theme: Theme } | { error: string }

/** Read a theme from file text. Never throws. */
export function parseTheme(text: unknown): Parsed {
  if (typeof text !== 'string') return { error: 'that file could not be read' }
  if (text.length > MAX_THEME_BYTES) return { error: `it is too big (more than ${MAX_THEME_BYTES} bytes); real themes are a few hundred` }
  let j: unknown
  try { j = JSON.parse(text) } catch { return { error: 'it is not valid JSON' } }
  if (!plain(j)) return { error: 'it is not a theme object' }
  for (const k of Object.keys(j)) if (!['format', 'version', 'name', 'boss', 'team', 'office', 'parts'].includes(k)) return { error: `it has an unknown key "${sanitize(k).slice(0, 20)}"` }
  if (j.format !== THEME_FORMAT) return { error: `it is not an Office Space theme (format must be "${THEME_FORMAT}")` }
  if (j.version !== THEME_VERSION) return { error: `it uses a theme version this build does not know (expected ${THEME_VERSION})` }
  if (!validName(j.name)) return { error: `its name must be 1 to ${MAX_NAME} plain characters, with no slashes` }
  const theme: Theme = { name: j.name }
  let parts: CustomPart[] = []
  if (j.parts !== undefined) {
    const ps = strictParts(j.parts)
    if (!ps) return { error: `its drawn parts are not valid (at most ${MAX_THEME_PARTS}, each a small grid of allowed letters at its exact size)` }
    parts = ps
    if (ps.length) theme.parts = ps
  }
  const known = libraryMap(parts)
  if (j.boss !== undefined) {
    const b = strictBoss(j.boss, known)
    if (!b) return { error: 'its Boss look has a part that is not in the catalog or in the file\'s drawn parts (hair, hair color, outfit and accessory are needed)' }
    theme.boss = b
  }
  if (j.team !== undefined) {
    const t = parseTeamStrict(j.team, known)
    if (!t) return { error: 'its team section is not valid (unknown role, title, catalog id or desk count)' }
    theme.team = t
  }
  if (j.office !== undefined) {
    const o = validateOffice(j.office)
    if (!o) return { error: 'its office section is not valid' }
    theme.office = o
  }
  return { theme }
}

/** The file text for a theme. Only sections that differ from the defaults are written. */
export function themeToJson(theme: Theme): string {
  const o: Record<string, unknown> = { format: THEME_FORMAT, version: THEME_VERSION, name: theme.name }
  if (theme.boss) o.boss = theme.boss
  if (theme.team) {
    const t = normalizeTeam(theme.team)
    const team: Record<string, unknown> = {}
    if (Object.keys(t.titles).length) team.titles = t.titles
    if (Object.keys(t.looks).length) team.looks = t.looks
    if (t.desks !== undefined) team.desks = t.desks
    if (Object.keys(team).length) o.team = team
  }
  if (theme.office && !isDefaultOffice(theme.office)) o.office = { wall: theme.office.wall, floor: theme.office.floor, items: { ...theme.office.items } }
  if (theme.parts?.length) o.parts = theme.parts.slice(0, MAX_THEME_PARTS).map((p) => ({ id: p.id, name: p.name, slot: p.slot, rows: [...p.rows] }))
  return JSON.stringify(o, null, 2) + '\n'
}

/** A file-name-safe version of a name. */
export function slug(name: string): string {
  return sanitize(name).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, MAX_NAME)
}

// ----- built-in presets (catalog ids only) -----

export const PRESETS: readonly Theme[] = [
  {
    name: '90s startup',
    boss: { hair: 'frosted', hairColor: 'blonde', outfit: 'early-2000s', accessory: 'headphones' },
    team: {
      titles: { coder: 'Code Monkey', researcher: 'Webmaster', writer: 'Copy Kid', reviewer: 'QA Dude' },
      looks: {
        coder: { hair: 'spiky', hairColor: 'blue', outfit: 'tee' },
        researcher: { outfit: 'hoodie', accessory: 'glasses' },
        reviewer: { accessory: 'cap', outfit: 'early-2000s' },
      },
      desks: 10,
    },
    office: { wall: 'teal', floor: 'blue-checker', items: { break: 'vending-machine', 'wall-door': 'poster-rocket', 'bottom-1': 'arcade-cabinet', 'bottom-4': 'lava-lamp' } },
  },
  {
    name: 'cozy library',
    boss: { hair: 'bun', hairColor: 'gray', outfit: 'cardigan', accessory: 'glasses' },
    team: {
      titles: { researcher: 'Archivist', writer: 'Scribe', planner: 'Librarian', reviewer: 'Proofreader' },
      looks: {
        researcher: { outfit: 'cardigan', hairColor: 'auburn' },
        writer: { outfit: 'cardigan', accessory: 'scarf' },
        planner: { hair: 'bob', outfit: 'lab-coat' },
      },
    },
    office: { wall: 'sage', floor: 'oak-planks', items: { 'wall-table': 'poster-mountain', 'bottom-2': 'couch', 'bottom-4': 'potted-fern' } },
  },
  {
    name: 'night shift',
    boss: { hair: 'short', hairColor: 'black', outfit: 'hoodie', accessory: 'headphones' },
    team: {
      titles: { coder: 'Night Owl', maintainer: 'Janitor', deployer: 'Graveyard Dev', skeptic: 'Insomniac' },
      looks: {
        coder: { outfit: 'hoodie', hairColor: 'purple', accessory: 'headphones' },
        deployer: { outfit: 'hoodie', hairColor: 'teal' },
        skeptic: { accessory: 'scarf' },
      },
      desks: 10,
    },
    office: { wall: 'charcoal', floor: 'gray-carpet', items: { break: 'vending-machine', 'wall-cooler': 'poster-sunset', 'bottom-3': 'fish-tank', 'bottom-5': 'lava-lamp' } },
  },
]

export function findPreset(name: string): Theme | undefined {
  const n = name.trim().toLowerCase().replace(/[\s_-]+/g, ' ')
  return PRESETS.find((p) => p.name === n)
}

// ----- applying -----

/** The saved state a theme starts from, and the lines that say what loading it changes. `parts` is the user's drawn parts. */
export type Current = { boss: BossLook; team: Team; office: OfficeLook; parts?: readonly CustomPart[] }

export function themeLines(cur: Current, t: Theme): string[] {
  const out: string[] = []
  const all = libraryMap([...(cur.parts ?? []), ...(t.parts ?? [])])
  const name = (id: string) => all.get(id)?.name ?? id
  if (t.boss) out.push(...changeLines(cur.boss, t.boss, name).map((l) => `Boss ${l}`))
  if (t.team) out.push(...teamLines(cur.team, t.team, name))
  if (t.office) out.push(...officeChangeLines(cur.office, t.office).map((l) => `Office ${l}`))
  return out
}

/** Nothing in the theme differs from what is already there. */
export function themeChangesNothing(cur: Current, t: Theme): boolean {
  return (!t.boss || sameLook(cur.boss, t.boss)) && (!t.team || sameTeam(cur.team, t.team)) && (!t.office || sameOffice(cur.office, t.office))
}

/** The theme that puts every default back. */
export function resetTheme(): Theme {
  return { name: 'defaults', boss: { ...DEFAULT_LOOK }, team: { titles: {}, looks: {} }, office: { ...DEFAULT_OFFICE, items: {} } }
}

/** A theme from what is saved now: only the parts that differ from the defaults, with the drawn parts they wear. */
export function currentTheme(name: string, cur: Current): Theme {
  const t: Theme = { name }
  if (!sameLook(cur.boss, DEFAULT_LOOK)) t.boss = cur.boss
  if (!sameTeam(cur.team, { titles: {}, looks: {} })) t.team = normalizeTeam(cur.team)
  if (!isDefaultOffice(cur.office)) t.office = cur.office
  // only the drawn parts something wears, so the file stays small; refs to parts no longer kept are dropped
  const lib = libraryMap(cur.parts ?? [])
  const used: CustomPart[] = []
  const keep = (refs: BossLook['parts']) => {
    if (!refs) return undefined
    const out: NonNullable<BossLook['parts']> = {}
    for (const s of PART_SLOTS) {
      const p = refs[s] ? lib.get(refs[s] as string) : undefined
      if (!p || (!used.includes(p) && used.length >= MAX_THEME_PARTS)) continue
      if (!used.includes(p)) used.push(p)
      out[s] = p.id
    }
    return Object.keys(out).length ? out : undefined
  }
  if (t.boss) { const { parts, ...rest } = t.boss; const k = keep(parts); t.boss = { ...rest, ...(k ? { parts: k } : {}) } }
  if (t.team) {
    const looks: Team['looks'] = {}
    for (const [r, l] of Object.entries(t.team.looks)) {
      if (!l) continue
      const { parts, ...rest } = l
      const k = keep(parts)
      const next = { ...rest, ...(k ? { parts: k } : {}) }
      if (Object.keys(next).length) (looks as Record<string, unknown>)[r] = next
    }
    t.team = { ...t.team, looks }
  }
  if (used.length) t.parts = used
  return t
}

export const THEME_HELP =
  'Save your look, share it, or load someone else\'s. /office-space-theme save <name> writes a small JSON file (~/.claude/office-space/themes/<name>.json) with your Boss, team and office, and any drawn parts they wear. load <name or path> reads one back, after showing what will change and asking you to confirm. list shows the built-in presets and your saved themes, and reset puts every default back. A theme file is data only: it is checked key by key and nothing in it is ever run. Themes use no AI and no plan usage.'

// ----- the confirmation in the panel -----

/** A loaded theme waiting for Apply. */
export type ThemeFlow = { theme: Theme; lines: string[]; busy: boolean }

/** The theme's summary as the shared stepped view (see ./flow.ts): Apply or Cancel, no steps to start over. */
export function themeView(f: ThemeFlow): FlowView {
  return {
    id: 'theme', title: `Theme "${f.theme.name}"`, busy: f.busy, stage: 'confirm', heading: `Theme "${f.theme.name}": apply this change?`,
    stepKey: 'confirm', options: [], other: false, summary: f.lines, notes: [], restart: false,
  }
}
