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
//     "boss":   { "hair", "hairColor", "outfit", "accessory" },        // optional, catalog ids
//     "team":   { "titles": {role: "text"}, "looks": {role: {...}}, "desks": 5..15 },   // optional
//     "office": { ... }                                                // optional, see validateOffice
//   }

import { DEFAULT_LOOK, SLOTS, changeLines, entry, sameLook } from './catalog'
import type { BossLook } from './catalog'
import { sanitize } from './external'
import { normalizeTeam,parseTeamStrict, sameTeam, teamLines } from './team'
import type { Team } from './team'

export const THEME_FORMAT = 'office-space-theme'
export const THEME_VERSION = 1
export const MAX_THEME_BYTES = 8192
export const MAX_NAME = 40

export type OfficeSection = Record<string, string | number | boolean | string[]>
export type Theme = { name: string; boss?: BossLook; team?: Team; office?: OfficeSection }

const plain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * STAND-IN for the office look validator (the decorate-the-room command owns
 * the real one): a flat object of short ids and small numbers, nothing else.
 * Swap this function for the office command's validator when it lands.
 */
export function validateOffice(v: unknown): OfficeSection | null {
  if (!plain(v)) return null
  const keys = Object.keys(v)
  if (keys.length > 20) return null
  const out: OfficeSection = {}
  const id = /^[a-z0-9][a-z0-9-]{0,31}$/
  for (const k of keys) {
    if (!id.test(k)) return null
    const x = v[k]
    if (typeof x === 'string' && id.test(x)) out[k] = x
    else if (typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= 1000) out[k] = x
    else if (typeof x === 'boolean') out[k] = x
    else if (Array.isArray(x) && x.length <= 20 && x.every((y) => typeof y === 'string' && id.test(y))) out[k] = x as string[]
    else return null
  }
  return out
}

/** A theme name: short, printable, no path characters (it becomes a file name). */
export function validName(s: unknown): s is string {
  return typeof s === 'string' && s.length > 0 && s.length <= MAX_NAME && sanitize(s) === s && !/[\\/:*?"<>|]/.test(s)
}

function strictBoss(v: unknown): BossLook | null {
  if (!plain(v)) return null
  for (const k of Object.keys(v)) if (!(SLOTS as readonly string[]).includes(k)) return null
  const out: Record<string, string> = {}
  for (const s of SLOTS) {
    const x = v[s]
    if (typeof x !== 'string' || !entry(s, x)) return null
    out[s] = x
  }
  return out as unknown as BossLook
}

export type Parsed = { theme: Theme } | { error: string }

/** Read a theme from file text. Never throws. */
export function parseTheme(text: unknown): Parsed {
  if (typeof text !== 'string') return { error: 'that file could not be read' }
  if (text.length > MAX_THEME_BYTES) return { error: `it is too big (more than ${MAX_THEME_BYTES} bytes); real themes are a few hundred` }
  let j: unknown
  try { j = JSON.parse(text) } catch { return { error: 'it is not valid JSON' } }
  if (!plain(j)) return { error: 'it is not a theme object' }
  for (const k of Object.keys(j)) if (!['format', 'version', 'name', 'boss', 'team', 'office'].includes(k)) return { error: `it has an unknown key "${sanitize(k).slice(0, 20)}"` }
  if (j.format !== THEME_FORMAT) return { error: `it is not an Office Space theme (format must be "${THEME_FORMAT}")` }
  if (j.version !== THEME_VERSION) return { error: `it uses a theme version this build does not know (expected ${THEME_VERSION})` }
  if (!validName(j.name)) return { error: `its name must be 1 to ${MAX_NAME} plain characters, with no slashes` }
  const theme: Theme = { name: j.name }
  if (j.boss !== undefined) {
    const b = strictBoss(j.boss)
    if (!b) return { error: 'its Boss look has a part that is not in the catalog (all four parts are needed)' }
    theme.boss = b
  }
  if (j.team !== undefined) {
    const t = parseTeamStrict(j.team)
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
  if (theme.office && Object.keys(theme.office).length) o.office = theme.office
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
  },
]

export function findPreset(name: string): Theme | undefined {
  const n = name.trim().toLowerCase().replace(/[\s_-]+/g, ' ')
  return PRESETS.find((p) => p.name === n)
}

// ----- applying -----

/** The saved state a theme starts from, and the lines that say what loading it changes. */
export type Current = { boss: BossLook; team: Team; office?: OfficeSection }

export function themeLines(cur: Current, t: Theme): string[] {
  const out: string[] = []
  if (t.boss) out.push(...changeLines(cur.boss, t.boss).map((l) => `Boss ${l}`))
  if (t.team) out.push(...teamLines(cur.team, t.team))
  if (t.office && JSON.stringify(t.office) !== JSON.stringify(cur.office ?? {})) out.push(`office decoration: ${Object.keys(t.office).length ? Object.keys(t.office).join(', ') : 'cleared'}`)
  return out
}

/** Nothing in the theme differs from what is already there. */
export function themeChangesNothing(cur: Current, t: Theme): boolean {
  return (!t.boss || sameLook(cur.boss, t.boss)) && (!t.team || sameTeam(cur.team, t.team)) && (!t.office || JSON.stringify(t.office) === JSON.stringify(cur.office ?? {}))
}

/** The theme that puts every default back. */
export function resetTheme(): Theme {
  return { name: 'defaults', boss: { ...DEFAULT_LOOK }, team: { titles: {}, looks: {} }, office: {} }
}

/** A theme from what is saved now: only the parts that differ from the defaults. */
export function currentTheme(name: string, cur: Current): Theme {
  const t: Theme = { name }
  if (!sameLook(cur.boss, DEFAULT_LOOK)) t.boss = cur.boss
  if (!sameTeam(cur.team, { titles: {}, looks: {} })) t.team = normalizeTeam(cur.team)
  if (cur.office && Object.keys(cur.office).length) t.office = cur.office
  return t
}

export const THEME_HELP =
  'Save your look, share it, or load someone else\'s. /office-space-theme save <name> writes a small JSON file (~/.claude/office-space/themes/<name>.json) with your Boss, team and office. load <name or path> reads one back, after showing what will change and asking you to confirm. list shows the built-in presets and your saved themes, and reset puts every default back. A theme file is data only: it is checked key by key and nothing in it is ever run. Themes use no AI and no plan usage.'
