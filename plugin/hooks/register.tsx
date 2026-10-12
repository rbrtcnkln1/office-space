// Office Space: a tiny 1990s RPG office. The main chat is The Boss; subagents
// walk in for their assignment, sit at a desk, work, then walk back to hand in
// the result and leave. The Boss walks a message over whenever the main chat
// messages a subagent.
//
//   /office-space        open or close the Office Space panel
//   /office-space-band   show or hide the small version above the prompt
//   /office-space-help   list every command and setting
//   /office-space-update check for a newer version and update
//   /office-space-feedback report a bug or share an idea
//   /office-space-roster   who is at work and what each one is doing
//   /office-space-recap    today's hand-ins, failures and calls for a person
//   /office-space-usage    context fill, plan limits and cost
//   /office-space-workers  the outside-workers folder, what was read, what was skipped
//   /office-space-boss     change how the Boss looks
//   /office-space-office   decorate the office (walls, floor, furniture)
//   /office-space-team     rename roles, restyle them, set the starting desks
//   /office-space-theme    save, load and reset a whole look (Boss, team, office)
// The customization commands share one stepped panel flow (./flow.ts).
// Each command is one row of COMMANDS below.
//
// Work running outside the session appears too: any script can drop one JSON
// file per worker into the workers directory (see ./external.ts and README).
//
// Art and roles: ./sprites.ts. Layout, walking and handoffs: ./office.ts.

import { atom, read, update } from 'claude-code'
import type { AgentInfo, EngineInterface, Register } from 'claude-code'

import { ACTIVE, Office, SCALE } from './office'
import { ROLES } from './sprites'
import { BOSS_HELP, IN_PANEL, actBoss, bossView, startBoss } from './boss'
import type { BossIo, Flow, Outcome as BossOutcome } from './boss'
import type { Action } from './flow'
import { OFFICE_HELP, IN_PANEL as OFFICE_IN_PANEL, actOffice, officeView, startOffice } from './decorate'
import type { OFlow, OfficeIo, Outcome as OfficeOutcome } from './decorate'
import { isDefaultOffice, sanitizeOffice } from './decor'
import type { OfficeLook } from './decor'
import { TEAM_HELP, TEAM_IN_PANEL, actTeam, isEmptyTeam, sanitizeTeam, startTeam, teamView } from './team'
import type { Team, TeamFlow, TeamOutcome } from './team'
import { MAX_THEME_BYTES, THEME_HELP, PRESETS, currentTheme, findPreset, parseTheme, resetTheme, slug, themeChangesNothing, themeLines, themeToJson, themeView, validName } from './theme'
import type { Current, Theme, ThemeFlow } from './theme'
import { DEFAULT_LOOK, sanitizeLook } from './catalog'
import type { BossLook } from './catalog'
import type { AgentLike } from './office'
import { DEFAULT_DIR, DEFAULT_STALE_MINUTES, MAX_FILE_BYTES, classifyWorker, expandDir, inScope, alertText, isWorkerFile, newlyNeeding, normalizePath, parseWorker, toAgents } from './external'
import type { ExternalWorker } from './external'
import { compareVersions, feedbackText, installedVersion, latestVersion, parseVersion, toastText, updateOffice } from './update'
import type { UpdateIo } from './update'
import { DayTracker, ROSTER_SYSTEM, activityDigest, parseSummaries, recapText, rosterPrompt, rosterText, workersReport } from './info'
import type { FileInfo, RosterRow } from './info'
import { fmtSpan, toBoard, usageText } from './usage'
import type { UsageBoard } from './usage'

const open = atom({ plugin: 'office-space', key: 'open' } as const, false)
const selected = atom({ plugin: 'office-space', key: 'selected' } as const, '') // the worker whose note is showing
const PANE = 'office-space'
const STORE_BAND = 'band'
const STORE_BOSS = 'bossLook'
const STORE_OFFICE = 'officeLook'
const STORE_TEAM = 'team'
const THEMES_DIR = '.claude/office-space/themes' // under $HOME
const BOSS_MODEL = 'haiku' // the smallest, fastest model: one short side call
const STORE_UPDATE_CHECKED = 'updateChecked'
const DAY_MS = 24 * 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 8000
let checkForUpdates = false
let alertOnBlocked = true
const ALERT_EVERY_MS = 5000
let alertTimer: { cancel: () => void } | null = null
let showUsage = true
let usageBoard: UsageBoard | null = null // last usage figures the host gave (drawn as office objects when showUsage)
const DAY_EVERY_MS = 5000
let dayTimer: { cancel: () => void } | null = null
const tracker = new DayTracker() // today's hand-ins, failures and calls for a person
const seenAt = new Map<string, number>() // when an agent was first seen at work, for "time at it"
let needKnown: Set<string> = new Set() // workers in a waiting/blocked stint (so a stint toasts once)
let alertQuiet = true // the first look after startup only records who is already waiting
const TICK_MS = 100
const POLL_EVERY = 10 // ticks between agent-list reads
const MAX_BAND_PX = 460 // tallest the band version may draw on desktop (about half a laptop window)
const PANE_SCALE = 4 // drawn large; the panel shrinks it to fit its width

let office = new Office()
type FlowId = 'boss' | 'office' | 'team'
type ActiveFlow = { id: 'boss'; flow: Flow } | { id: 'office'; flow: OFlow } | { id: 'team'; flow: TeamFlow } | { id: 'theme'; flow: ThemeFlow }
// The one customization being chosen (only one at a time); drawn as buttons in the panel.
let activeFlow: ActiveFlow | null = null
let bossLook: BossLook | undefined // saved Boss customization; undefined draws the default
let officeLook: OfficeLook | undefined // saved office decoration; undefined draws the plain office
let team: Team | undefined // saved team titles, looks and starting desks; undefined draws the defaults
let timer: { cancel: () => void } | null = null
let lastStep = 0 // ms of the last simulation step (from any driver)
let paneOpen = false
let bandOn = false
let reported = false

// ----- external workers -----
const EXTERNAL_EVERY_MS = 5000
const MAX_FILES = 200 // newest worker files read per poll
let workersDir = DEFAULT_DIR // as configured; resolved against $HOME on first read
let staleMinutes = DEFAULT_STALE_MINUTES
let resolvedDir: string | null = null
let externalAt = 0
let external: ExternalWorker[] = []
let externalBusy = false
const fileCache = new Map<string, { mtimeMs: number; size: number; worker: ExternalWorker | null }>()

/**
 * The external workers as last read. The first read is awaited; after that a
 * refresh runs in the background at most every EXTERNAL_EVERY_MS, so a slow
 * or huge folder never holds up the animation tick.
 */
async function readExternal($: EngineInterface): Promise<ExternalWorker[]> {
  const now = await $.clock.now()
  if (externalBusy || (externalAt && now - externalAt < EXTERNAL_EVERY_MS)) return external
  const first = !externalAt
  externalAt = now
  externalBusy = true
  const run = refreshExternal($).finally(() => { externalBusy = false })
  if (first) await run
  else void run
  return external
}

/**
 * One listing, then a read only for files that changed since last time (the
 * newest MAX_FILES). A missing directory, unreadable file or malformed JSON is
 * simply no worker; a transient listing failure keeps the last good state.
 */
async function refreshExternal($: EngineInterface): Promise<void> {
  try {
    if (resolvedDir === null) {
      const env = await $.env.get('OFFICE_SPACE_WORKERS_DIR')
      resolvedDir = expandDir(env || workersDir, await $.env.get('HOME'))
    }
    const entries = (await $.fs.list(resolvedDir))
      .filter(ent => ent.kind === 'file' && !ent.isLink && isWorkerFile(ent.name))
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, MAX_FILES)
    const names = new Set<string>()
    const next: ExternalWorker[] = []
    for (const ent of entries) {
      names.add(ent.name)
      const hit = fileCache.get(ent.name)
      if (hit && hit.mtimeMs === ent.mtimeMs && hit.size === ent.size) {
        if (hit.worker) next.push(hit.worker)
        continue
      }
      let worker: ExternalWorker | null = null
      if (ent.size <= MAX_FILE_BYTES) {
        try {
          const text = await $.fs.read(`${resolvedDir}/${ent.name}`)
          worker = typeof text === 'string' && text.length <= MAX_FILE_BYTES ? parseWorker(text, ent.name, ent.mtimeMs) : null
        } catch {}
      }
      fileCache.set(ent.name, { mtimeMs: ent.mtimeMs, size: ent.size, worker })
      if (worker) next.push(worker)
    }
    for (const k of [...fileCache.keys()]) if (!names.has(k)) fileCache.delete(k)
    external = next
  } catch {
    // no directory (yet): nobody remote. Any other failure: keep what we had.
    let gone = true
    try { gone = resolvedDir === null || !(await $.fs.exists(resolvedDir)) } catch {}
    if (gone) {
      external = []
      fileCache.clear()
    }
  }
}

/** Link-resolved path, or the path itself when it cannot be resolved. */
async function realOf($: EngineInterface, p: string): Promise<string> {
  try {
    const st = await $.fs.stat(p, { resolve: true })
    return st.realPath ?? p
  } catch {
    return p
  }
}

/**
 * Only the workers meant for this session's working folder. Unscoped workers
 * always show; scoped ones need a known cwd (fail closed when it is missing).
 */
let visibleMemo: { src: ExternalWorker[]; out: ExternalWorker[] } | null = null
async function visibleHere($: EngineInterface, all: ExternalWorker[]): Promise<ExternalWorker[]> {
  if (!all.some(w => w.scope)) return all
  // poll runs about once a second; the list only changes on a folder refresh (every 5 s), so reuse the answer.
  if (visibleMemo && visibleMemo.src === all) return visibleMemo.out
  let cwd: string | undefined
  let home: string | undefined
  try { cwd = await $.session.cwd() } catch {}
  try { home = (await $.env.get('HOME')) || undefined } catch {}
  const real = new Map<string, string>()
  if (cwd) {
    const paths = new Set<string>([normalizePath(cwd)])
    for (const w of all) for (const s of w.scope ?? []) paths.add(normalizePath(s, home))
    for (const p of paths) real.set(p, await realOf($, p))
  }
  const out = all.filter(w => inScope(w.scope, cwd, home, p => real.get(p) ?? p))
  visibleMemo = { src: all, out }
  return out
}

async function poll($: EngineInterface): Promise<void> {
  let list: AgentInfo[] = []
  try {
    list = await $.agent.list()
  } catch {
    list = []
  }
  const remote = toAgents(await visibleHere($, await readExternal($)), Date.now(), staleMinutes)
  checkAlerts($, remote)
  office.sync([...(list as AgentLike[]), ...remote])
  if (office.eotdDirty) {
    office.eotdDirty = false
    try { await $.store.set(eotdKey(), Object.fromEntries(office.eotd)) } catch {}
  }
}

/** One toast when external workers newly need you; none while a stint holds. Never throws. */
function checkAlerts($: EngineInterface, remote: AgentLike[]): void {
  if (!alertOnBlocked) return
  try {
    const r = newlyNeeding(needKnown, remote, alertQuiet)
    needKnown = r.known
    alertQuiet = false
    if (r.fresh.length) $.ui.toast(alertText(r.fresh))
  } catch {}
}

/** Watches the workers folder for alerts even while the office is closed. */
async function watchAlerts($: EngineInterface): Promise<void> {
  try {
    checkAlerts($, toAgents(await visibleHere($, await readExternal($)), Date.now(), staleMinutes))
  } catch {}
}

/** Employee of the Day counts and the recap are kept per calendar day, across reloads. */
const dayStamp = (): string => {
  const d = new Date()
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}
function eotdKey(): string {
  return `eotd:${dayStamp()}`
}
const dayKey = (): string => `day:${dayStamp()}`

/** Usage figures to the office (or none when the setting hides them). */
function applyUsage(): void {
  office.usage = showUsage ? usageBoard : null
}
async function refreshUsage($: EngineInterface): Promise<void> {
  try {
    usageBoard = toBoard(await $.session.usage())
    applyUsage()
  } catch {}
}

/**
 * Watches agents and outside workers for the day's recap, whether or not the
 * office is open. One small local read every few seconds; writes only when the
 * tally changes. Never throws.
 */
async function dayEnsure($: EngineInterface): Promise<void> {
  const key = dayKey()
  if (tracker.key !== key) {
    let saved: unknown
    try { saved = await $.store.get(key) } catch {}
    tracker.rollover(key, saved)
  }
}
async function dayTick($: EngineInterface): Promise<void> {
  try {
    await dayEnsure($)
    const key = tracker.key
    let list: AgentInfo[] = []
    try { list = await $.agent.list() } catch {}
    const remote = toAgents(await visibleHere($, await readExternal($)), Date.now(), staleMinutes)
    const all = [...(list as AgentLike[]), ...remote]
    const live = new Set<string>()
    for (const a of all) {
      if (!ACTIVE.has(a.status)) continue
      live.add(a.id)
      if (!seenAt.has(a.id)) seenAt.set(a.id, Date.now())
    }
    for (const id of [...seenAt.keys()]) if (!live.has(id)) seenAt.delete(id)
    if (tracker.observe(all)) await $.store.set(key, tracker.log)
  } catch {}
}
async function loadEotd($: EngineInterface) {
  try {
    const saved = (await $.store.get(eotdKey())) as Record<string, number> | undefined
    if (saved && typeof saved === 'object') {
      for (const [k, v] of Object.entries(saved)) {
        if (Object.prototype.hasOwnProperty.call(ROLES, k) && typeof v === 'number' && Number.isFinite(v) && v >= 0) office.eotd.set(k as never, v)
      }
    }
  } catch {}
}

/** One simulation step plus a redraw when something visible changed. */
async function advance($: EngineInterface): Promise<void> {
  try {
    if (office.tick % POLL_EVERY === 0) await poll($)
    const moving = office.step()
    lastStep = Date.now()
    const typing = office.bossWorking || [...office.workers.values()].some(w => w.status === 'running')
    if (moving || (typing && office.tick % 2 === 0) || office.tick % 6 === 0) $.ui.invalidate('ui.render')
  } catch (err) {
    if (!reported) {
      reported = true
      $.ui.toast(`office-space: ${String(err)}`)
    }
  }
}

function start($: EngineInterface) {
  if (timer) return
  timer = $.clock.every(TICK_MS, () => {
    void advance($)
  })
}

function stop() {
  timer?.cancel()
  timer = null
}

/**
 * Watchdog for the drawing hooks: if the timer has not stepped recently
 * (it was refused, or a reload dropped it), catch the simulation up and ask
 * for the next frame from here, so the office never freezes.
 */
async function catchUp($: EngineInterface) {
  const now = Date.now()
  if (lastStep && now - lastStep < 400) return
  const behind = lastStep ? Math.min(10, Math.floor((now - lastStep) / TICK_MS)) : 1
  for (let i = 0; i < behind; i++) office.step()
  if (office.tick % POLL_EVERY < behind || !lastStep) await poll($)
  lastStep = now
  stop()
  start($)
  $.clock.after(TICK_MS, () => $.ui.invalidate('ui.render'))
}

async function openPane($: EngineInterface) {
  await $.ui.open({ id: PANE, title: 'Office Space' })
  paneOpen = true
}

let running = false // the simulation is live (panel and/or band showing)

async function setOpen($: EngineInterface, on: boolean) {
  await update($, open, () => on)
  if (on && !running) {
    // a fresh office only when it was closed: switching between panel and
    // band keeps everyone where they are
    running = true
    office = new Office()
    applyUsage()
    void refreshUsage($)
    applyLooks()
    externalAt = 0
    resolvedDir = null
    await loadEotd($)
    await poll($)
    start($)
  } else if (!on && running) {
    running = false
    stop()
  }
}

type Reply = { text: string }
// A row decides what to do; the dispatcher below does it. Rows stay pure because
// a module may not hand `$` to a function it looks up at run time.
type Outcome = Reply | { toggle: 'panel' | 'band' } | { action: 'update' | 'feedback' | 'roster' | 'recap' | 'usage' | 'workers' } | { boss: string } | { office: string } | { team: string } | { theme: string }
type Command = {
  name: string
  description: string
  argumentHint?: string
  run: (args: string) => Outcome
}

/** Whether the panel is on screen right now, by the engine's own record. */
async function paneShowing($: EngineInterface): Promise<boolean> {
  try {
    return (await $.ui.panes()).some((p) => p.id === PANE && p.isPlaced)
  } catch {
    return paneOpen // the record is unavailable: trust what we last did
  }
}

async function togglePanel($: EngineInterface): Promise<Reply> {
  // Ask the engine, not a remembered flag: a flag carried over from an earlier
  // chat made the first command in a new chat "close" a panel that was not there.
  paneOpen = await paneShowing($)
  if (paneOpen) {
    await $.ui.close({ id: PANE })
    paneOpen = false
    await setOpen($, bandOn)
    return { text: 'Office Space is closed for the day.' }
  }
  await setOpen($, true)
  await openPane($)
  return { text: 'Office Space is open.' }
}

async function toggleBand($: EngineInterface): Promise<Reply> {
  bandOn = !bandOn
  try { await $.store.set(STORE_BAND, bandOn) } catch {}
  await setOpen($, bandOn || paneOpen)
  $.ui.invalidate('ui.render')
  return { text: bandOn ? 'Office Space band is on.' : 'Office Space band is off.' }
}

// The I/O the update flow needs, wired to this plugin's `$`. The flow itself
// (./update.ts) takes it as a parameter so tests can fake it.
function updateIo($: EngineInterface): UpdateIo {
  return {
    root: $.plugin.root,
    readText: async (path) => { const t = await $.fs.read(path); return typeof t === 'string' ? t : null },
    exists: (path) => $.fs.exists(path),
    // HttpInit has no timeout, so race the request against the clock.
    fetchText: async (url) => {
      const res = await Promise.race([$.http.fetch(url), $.clock.sleep(FETCH_TIMEOUT_MS).then(() => null)])
      return res && res.ok ? res.text : null
    },
    run: async (argv, timeoutMs) => { const r = await $.process.run([...argv], { timeoutMs }); return { exitCode: r.exitCode, stdout: r.stdout } },
  }
}

// Opt-in (setting checkForUpdates): at most once a day, one toast, never a download.
async function dailyUpdateCheck($: EngineInterface): Promise<void> {
  try {
    const last = Number(await $.store.get(STORE_UPDATE_CHECKED))
    if (Number.isFinite(last) && Date.now() - last < DAY_MS) return
    await $.store.set(STORE_UPDATE_CHECKED, Date.now())
    const io = updateIo($)
    const installed = parseVersion(await installedVersion(io))
    const latest = parseVersion(await latestVersion(io))
    if (installed && latest && compareVersions(installed, latest) < 0) $.ui.toast(toastText(latest.join('.')))
  } catch {}
}

// Every slash command is one row here. Add a row and it is registered,
// answered and listed by /office-space-help (and should get a README row too).
// Names allow only letters, digits, "_" and "-", so the family is spelled
// office-space-<name>; they sort together in the "/" menu.
export const COMMANDS: Command[] = [
  {
    name: 'office-space',
    description: 'Open or close the Office Space panel (16-bit office of running agents)',
    run: (args) => {
      const arg = args.trim().toLowerCase()
      if (arg === '') return { toggle: 'panel' }
      if (arg === 'band') return { toggle: 'band' } // older spelling, kept working
      return { text: `Unknown option "${args.trim().slice(0, 40)}". Type /office-space-help to see every Office Space command.` }
    },
  },
  {
    name: 'office-space-band',
    description: 'Show or hide the small office strip above the prompt',
    run: () => ({ toggle: 'band' }),
  },
  {
    name: 'office-space-help',
    description: 'List every Office Space command and setting',
    run: () => ({ text: helpText() }),
  },
  {
    name: 'office-space-update',
    description: 'Check GitHub for a newer version of Office Space and update it',
    run: () => ({ action: 'update' }),
  },
  {
    name: 'office-space-feedback',
    description: 'Report a bug or share an idea (shows the link and your version details)',
    run: () => ({ action: 'feedback' }),
  },
  {
    name: 'office-space-roster',
    description: 'Who is at work, for how long, and what each is doing (uses a little plan usage for the summaries)',
    run: () => ({ action: 'roster' }),
  },
  {
    name: 'office-space-recap',
    description: "Today's hand-ins, failures, outside workers that needed you, and Employee of the Day",
    run: () => ({ action: 'recap' }),
  },
  {
    name: 'office-space-usage',
    description: 'Context fill, plan limits with reset times, and cost',
    run: () => ({ action: 'usage' }),
  },
  {
    name: 'office-space-workers',
    description: 'Show the outside-workers folder, who was read from it, and any files skipped and why',
    run: () => ({ action: 'workers' }),
  },
  {
    name: 'office-space-boss',
    description: 'Change how the Boss looks, in plain words or step by step (uses a little plan usage)',
    argumentHint: '[pink spiky hair, headphones | reset]',
    run: (args) => ({ boss: args }),
  },
  {
    name: 'office-space-office',
    description: 'Decorate the office: walls, floor, vending machine, arcade and more, in plain words or step by step (uses a little plan usage)',
    argumentHint: '[teal walls, a vending machine | remove couch | list | reset]',
    run: (args) => ({ office: args }),
  },
  {
    name: 'office-space-team',
    description: 'Rename roles, restyle them and set the starting desk count, in words or step by step (uses a little plan usage)',
    argumentHint: '[call the Coder "Mx. Bytes" | reset <role>]',
    run: (args) => ({ team: args }),
  },
  {
    name: 'office-space-theme',
    description: 'Save, load, list or reset a whole look (Boss, team, office); includes three presets (no plan usage)',
    argumentHint: '[save <name> | load <name or path> | list | reset]',
    run: (args) => ({ theme: args }),
  },
]

const AGENT_LOOKS = 12 // transcripts read per roster (local reads, never the model)
const ROSTER_MAX = 20
const MODEL_TIMEOUT_MS = 20000

async function rosterCommand($: EngineInterface): Promise<string> {
  const now = Date.now()
  let list: AgentInfo[] = []
  try { list = await $.agent.list() } catch {}
  const subs = (list as AgentLike[]).filter(a => ACTIVE.has(a.status))
  let remote: AgentLike[] = []
  try { remote = toAgents(await visibleHere($, await readExternal($)), now, staleMinutes).filter(a => ACTIVE.has(a.status)) } catch {}
  const total = subs.length + remote.length
  const pickSubs = subs.slice(0, ROSTER_MAX)
  const pickRemote = remote.slice(0, Math.max(0, ROSTER_MAX - pickSubs.length))

  const digests = await Promise.all(pickSubs.map(async (a, i) => {
    if (i >= AGENT_LOOKS) return ''
    try { return activityDigest(await $.session.messages({ agentId: a.id })) } catch { return '' }
  }))
  const rows: RosterRow[] = pickSubs.map((a, i) => {
    if (!seenAt.has(a.id)) seenAt.set(a.id, now)
    const at = seenAt.get(a.id) ?? now
    const since = now - at < 5000 ? 'just noticed' : `${fmtSpan(now - at)} on it`
    const name = a.name || ''
    return {
      who: (name && name !== a.type ? `${name} (${a.type})` : a.type || a.id).slice(0, 48),
      state: a.status === 'running' ? 'working' : a.status === 'pending' ? 'starting' : a.status,
      since,
      task: a.description || '',
      activity: digests[i] ?? '',
    }
  })
  for (const a of pickRemote) {
    const r = a.remote
    rows.push({
      who: `${a.name || a.id} [${r?.source ?? 'remote'}]`.slice(0, 48),
      state: r?.need ?? (r?.stale ? 'working (stale)' : 'working'),
      since: r && r.ageMin >= 1 ? `updated ${fmtSpan(r.ageMin * 60_000)} ago` : 'updated just now',
      task: a.description || '',
      activity: `reports ${r?.need ?? 'working'}${r?.note ? `; note: ${r.note}` : ''}`,
    })
  }

  let summaries: ReturnType<typeof parseSummaries> = null
  let note: string | null = null
  const prompt = rosterPrompt(rows)
  if (!rows.length) {
    note = null
  } else if (!prompt) {
    note = "No recent activity to summarize yet, so each line shows the worker's own task text."
  } else {
    let why = ''
    try {
      const r = await $.model.complete({ model: 'haiku', system: ROSTER_SYSTEM, prompt, maxTokens: 700, effort: 'low', timeoutMs: MODEL_TIMEOUT_MS })
      if (r.isAnswered) {
        summaries = parseSummaries(r.text, rows.length)
        if (!summaries) why = 'the reply could not be used'
      } else {
        why = r.reason === 'aborted' ? 'the call timed out' : r.reason === 'empty-reply' ? 'it sent no words' : 'the call failed (offline, or out of plan usage)'
      }
    } catch {
      why = 'the model call is not available here'
    }
    if (!summaries) note = `AI summaries unavailable (${why}), so each line shows the worker's own task text.`
  }
  const text = rosterText(rows, summaries, note)
  return total > rows.length ? `${text}
${total - rows.length} more not shown.` : text
}

function recapCommand(): string {
  return recapText(tracker.log, (r) => office.titleOf(r))
}

async function usageCommand($: EngineInterface): Promise<string> {
  try {
    const fresh = toBoard(await $.session.usage())
    if (fresh) {
      usageBoard = fresh
      applyUsage()
    }
  } catch {}
  return usageText(usageBoard, Date.now())
}

async function workersCommand($: EngineInterface): Promise<string> {
  const env = await $.env.get('OFFICE_SPACE_WORKERS_DIR')
  const home = await $.env.get('HOME')
  const dir = expandDir(env || workersDir, home)
  const dirSource = env ? 'environment' : workersDir !== DEFAULT_DIR ? 'setting' : 'default'
  let dirState: 'ok' | 'missing' | 'error' = 'ok'
  let entries: Awaited<ReturnType<EngineInterface['fs']['list']>> = []
  try {
    entries = await $.fs.list(dir)
  } catch {
    let there = false
    try { there = await $.fs.exists(dir) } catch {}
    dirState = there ? 'error' : 'missing'
  }
  const sorted = [...entries].sort((a, b) => b.mtimeMs - a.mtimeMs)
  let reads = 0
  let notRead = 0
  const files: FileInfo[] = []
  for (const ent of sorted) {
    const info: FileInfo = { name: ent.name, kind: ent.kind, isLink: ent.isLink, size: ent.size, mtimeMs: ent.mtimeMs }
    if (ent.kind === 'file' && !ent.isLink && isWorkerFile(ent.name) && ent.size <= MAX_FILE_BYTES) {
      if (reads >= MAX_FILES) { notRead++; continue }
      reads++
      try {
        const t = await $.fs.read(`${dir}/${ent.name}`)
        info.text = typeof t === 'string' ? t : null
      } catch {
        info.text = null
      }
    }
    files.push(info)
  }
  // Workers scoped to some other folder do not show in this session.
  const hidden = new Set<string>()
  try {
    const found: ExternalWorker[] = []
    for (const f of files) {
      if (typeof f.text !== 'string') continue
      const r = classifyWorker(f.text, f.name, f.mtimeMs)
      if ('worker' in r && r.worker.scope) found.push(r.worker)
    }
    if (found.length) {
      const here = new Set((await visibleHere($, found)).map(w => w.id))
      for (const w of found) if (!here.has(w.id)) hidden.add(w.id)
    }
  } catch {}
  return workersReport({ dir, dirSource, dirState, files, notRead, now: Date.now(), staleMinutes, hiddenHere: hidden })
}

/** The one side call the customization commands make: the smallest model, no history, no tools. */
async function sideCall($: EngineInterface, system: string, prompt: string, maxTokens = 300): Promise<string | null> {
  const r = await $.model.complete({ model: BOSS_MODEL, system, prompt, maxTokens, effort: 'low', timeoutMs: MODEL_TIMEOUT_MS })
  return r.isAnswered ? r.text : null
}

/** Wire the Boss flow to this plugin's `$`: a small side model call and the saved look. */
function bossIo($: EngineInterface): BossIo {
  return {
    complete: (system, prompt) => sideCall($, system, prompt),
    load: async () => sanitizeLook(await $.store.get(STORE_BOSS)),
    save: async (look) => { await $.store.set(STORE_BOSS, look) },
  }
}

/** The same for the office decor. */
function officeIo($: EngineInterface): OfficeIo {
  return {
    complete: (system, prompt) => sideCall($, system, prompt),
    load: async () => sanitizeOffice(await $.store.get(STORE_OFFICE)),
    save: async (look) => { await $.store.set(STORE_OFFICE, look) },
  }
}

/** The same for the team. */
function teamIo($: EngineInterface) {
  return {
    complete: (system: string, prompt: string) => sideCall($, system, prompt, 400),
    load: async () => sanitizeTeam(await $.store.get(STORE_TEAM)),
    save: async (t: Team | null) => { await $.store.set(STORE_TEAM, t) },
  }
}

/** Put the saved customizations on the drawing. */
function applyLooks() {
  office.bossLook = bossLook
  office.decor = officeLook
  office.setTeam(team)
}

const isDefaultBoss = (d: BossLook): boolean => d.hair === DEFAULT_LOOK.hair && d.hairColor === DEFAULT_LOOK.hairColor && d.outfit === DEFAULT_LOOK.outfit && d.accessory === DEFAULT_LOOK.accessory
const setBoss = (d: BossLook | undefined) => { bossLook = d && !isDefaultBoss(d) ? d : undefined }
const setOffice = (l: OfficeLook | undefined) => { officeLook = l && !isDefaultOffice(l) ? l : undefined }
const setTeamLook = (t: Team | undefined) => { team = t && !isEmptyTeam(t) ? t : undefined }

/**
 * A finished answer (a new look, or just words) or a flow to keep drawing.
 * The choices live in the Office Space panel as buttons, so the command never
 * becomes a conversation turn: it only answers with one short line.
 */
function takeOutcome($: EngineInterface, id: FlowId, r: BossOutcome | OfficeOutcome | TeamOutcome): string | null {
  if (r.flow) {
    activeFlow = { id, flow: r.flow } as ActiveFlow
    $.ui.invalidate('ui.render')
    return null
  }
  activeFlow = null
  if (id === 'boss' && 'look' in r && r.look) setBoss(r.look as BossLook)
  if (id === 'office' && 'look' in r && r.look) setOffice(r.look as OfficeLook)
  if (id === 'team' && 'team' in r && r.team) setTeamLook(r.team)
  applyLooks()
  $.ui.invalidate('ui.render')
  return r.text
}

async function showPanel($: EngineInterface) {
  if (!(await paneShowing($))) {
    await setOpen($, true)
    await openPane($)
  }
}

const HELP: Record<FlowId, string> = { boss: BOSS_HELP, office: OFFICE_HELP, team: TEAM_HELP }
const IN_PANEL_TEXT: Record<FlowId, string> = { boss: IN_PANEL, office: OFFICE_IN_PANEL, team: TEAM_IN_PANEL }

/** Start a customization command; choices to make are drawn in the panel, so make sure it is showing. */
async function runCustomize($: EngineInterface, id: FlowId, args: string): Promise<Reply> {
  try {
    const r = id === 'boss' ? await startBoss(args, bossIo($)) : id === 'office' ? await startOffice(args, officeIo($)) : await startTeam(args, teamIo($))
    const text = takeOutcome($, id, r)
    if (text !== null) return { text }
    await showPanel($)
    return { text: IN_PANEL_TEXT[id] }
  } catch {
    return { text: HELP[id] }
  }
}

const viewOf = (cur: ActiveFlow) => cur.id === 'boss' ? bossView(cur.flow) : cur.id === 'office' ? officeView(cur.flow) : cur.id === 'team' ? teamView(cur.flow) : themeView(cur.flow)
/** Which step a drawing showed: a press is only taken while the panel still shows that step. */
const stepToken = (v: { id: string; stage: string; stepKey: string; heading: string }) => `${v.id}\u0000${v.stage}\u0000${v.stepKey}\u0000${v.heading}`
let flowPressing = false // one press at a time: a repeated click while one is settling does nothing

/**
 * A button or typed answer in the panel's steps, routed to whichever command
 * is open. `token` names the step the pressed drawing showed; a press that
 * arrives after the step moved on (a double click, a late click) is dropped,
 * so a press never lands on a different question or applies twice.
 */
function pressFlow($: EngineInterface, a: Action, token?: string) {
  const cur = activeFlow
  if (!cur || cur.flow.busy || flowPressing) return
  const shown = viewOf(cur)
  if (token !== undefined && (!shown || stepToken(shown) !== token)) return
  if (cur.id === 'theme') return pressTheme($, cur.flow, a)
  flowPressing = true
  void (async () => {
    try {
      if (a.kind === 'other') {
        activeFlow = { ...cur, flow: { ...cur.flow, busy: true } } as ActiveFlow
        $.ui.invalidate('ui.render')
      }
      const r = cur.id === 'boss' ? await actBoss(cur.flow, a, bossIo($)) : cur.id === 'office' ? await actOffice(cur.flow, a, officeIo($)) : await actTeam(cur.flow, a, teamIo($))
      const text = takeOutcome($, cur.id, r)
      if (text !== null) $.ui.toast(text.split('\n')[0] as string)
    } catch {
      activeFlow = null
      $.ui.invalidate('ui.render')
    } finally {
      flowPressing = false
    }
  })()
}

// ----- themes -----

/** Reads the saved Boss look, team and office back from the store (what a theme starts from, and what session.start draws). */
async function loadSaved($: EngineInterface) {
  try {
    const saved = await $.store.get(STORE_BOSS)
    setBoss(saved === undefined || saved === null ? undefined : sanitizeLook(saved))
  } catch {}
  try {
    const saved = await $.store.get(STORE_OFFICE)
    setOffice(saved === undefined || saved === null ? undefined : sanitizeOffice(saved))
  } catch {}
  try { setTeamLook(sanitizeTeam(await $.store.get(STORE_TEAM))) } catch {}
  applyLooks()
}

const current = (): Current => ({ boss: bossLook ?? { ...DEFAULT_LOOK }, team: team ?? { titles: {}, looks: {} }, office: officeLook ?? sanitizeOffice(undefined) })

async function themesDir($: EngineInterface): Promise<string | null> {
  try {
    const home = await $.env.get('HOME')
    return home ? `${home.replace(/\/+$/, '')}/${THEMES_DIR}` : null
  } catch { return null }
}

async function listThemes($: EngineInterface): Promise<string> {
  const lines = ['Built-in presets:', ...PRESETS.map((p) => `  ${p.name}`)]
  const dir = await themesDir($)
  let saved: string[] = []
  try { if (dir) saved = (await $.fs.list(dir)).filter((f) => f.kind === 'file' && !f.isLink && f.name.endsWith('.json')).map((f) => f.name.slice(0, -5)).slice(0, 50) } catch {}
  lines.push('', saved.length ? `Your saved themes (${dir}):` : `No saved themes yet${dir ? ` (they go in ${dir})` : ''}.`, ...saved.map((n) => `  ${n}`))
  return lines.join('\n')
}

/** Show what a theme will change and wait for Apply (R16). */
async function offerTheme($: EngineInterface, theme: Theme): Promise<Reply> {
  const lines = themeLines(current(), theme)
  if (themeChangesNothing(current(), theme) || !lines.length) return { text: `"${theme.name}" is how the office already looks, so nothing changed.` }
  activeFlow = { id: 'theme', flow: { theme, lines, busy: false } }
  $.ui.invalidate('ui.render')
  await showPanel($)
  return { text: `Review the "${theme.name}" theme in the Office Space panel. Nothing changes until you press Apply.` }
}

async function runTheme($: EngineInterface, raw: string): Promise<Reply> {
  try {
    await loadSaved($)
    const args = raw.replace(/\s+/g, ' ').trim()
    const [verb = '', ...restWords] = args.split(' ')
    const rest = restWords.join(' ').trim()
    const v = verb.toLowerCase()
    if (!args || v === 'help' || v === '?') return { text: `${THEME_HELP}\n\n${await listThemes($)}` }
    if (v === 'list') return { text: await listThemes($) }
    if (v === 'reset' || v === 'default') return offerTheme($, resetTheme())
    if (v === 'save') {
      if (!validName(rest)) return { text: 'Give the theme a short plain name, for example: /office-space-theme save night-owls' }
      const dir = await themesDir($)
      if (!dir) return { text: 'I could not find your home folder, so nothing was saved.' }
      const file = slug(rest) || 'theme'
      const path = `${dir}/${file}.json`
      let existed = false
      try { existed = await $.fs.exists(path) } catch {}
      await $.fs.write(path, themeToJson(currentTheme(rest, current())))
      return { text: `Saved ${existed ? '(replacing the earlier file) ' : ''}to ${path}. Share it, or load it later with /office-space-theme load ${file}.` }
    }
    const name = v === 'load' ? rest : args
    if (!name) return { text: 'Which theme? Try /office-space-theme list.' }
    const preset = findPreset(name)
    if (preset) return offerTheme($, preset)
    const isPath = name.includes('/') || name.startsWith('~') || name.toLowerCase().endsWith('.json')
    let path: string
    if (isPath) {
      path = expandDir(name, await $.env.get('HOME'))
    } else {
      const dir = await themesDir($)
      if (!dir) return { text: 'I could not find your home folder, so nothing was loaded.' }
      path = `${dir}/${slug(name) || 'theme'}.json`
    }
    let text: unknown
    try {
      const st = await $.fs.stat(path)
      if (st.kind !== 'file') return { text: `That is not a theme file (${path}). Nothing changed.` }
      if (st.size > MAX_THEME_BYTES) return { text: `Could not load it: the file is too big (over ${MAX_THEME_BYTES} bytes). Nothing changed.` }
      text = await $.fs.read(path)
    } catch {
      return { text: `I could not find or read a theme at ${path}. Try /office-space-theme list. Nothing changed.` }
    }
    const parsed = parseTheme(text)
    if ('error' in parsed) return { text: `Could not load that theme: ${parsed.error}. Nothing changed.` }
    return offerTheme($, parsed.theme)
  } catch {
    return { text: THEME_HELP }
  }
}

/** Apply or Cancel on a loaded theme: Boss, team and office decor are saved and drawn together. */
function pressTheme($: EngineInterface, f: ThemeFlow, a: Action) {
  if (a.kind === 'cancel') {
    activeFlow = null
    $.ui.invalidate('ui.render')
    $.ui.toast('Okay, nothing changed.')
    return
  }
  if (a.kind !== 'apply') return
  activeFlow = { id: 'theme', flow: { ...f, busy: true } }
  void (async () => {
    try {
      const t = f.theme
      if (t.boss) {
        setBoss(t.boss)
        try { await $.store.set(STORE_BOSS, bossLook ?? null) } catch {}
      }
      if (t.team) {
        setTeamLook(t.team)
        try { await $.store.set(STORE_TEAM, team ?? null) } catch {}
      }
      if (t.office) {
        setOffice(t.office)
        try { await $.store.set(STORE_OFFICE, officeLook ?? null) } catch {}
      }
      applyLooks()
      $.ui.toast(`Theme "${t.name}" applied.`)
    } catch {}
    activeFlow = null
    $.ui.invalidate('ui.render')
  })()
}

/**
 * Pressable elements kept from one drawing to the next.
 *
 * Every `<Button>` (or `<Input>`) built gets a fresh press handle, and the host
 * releases each handle a newer drawing of the same site no longer carries. A
 * desktop click travels back naming the handle of the drawing it was painted
 * from, so with the panel redrawing on every animation tick, a click almost
 * always named a handle one redraw old and ran nothing ("no Button ... is held
 * under handle N; nothing ran"); the terminal presses in-process, so it never
 * showed. Reusing the same element while its key and props are unchanged
 * keeps its handle, so a click lands whichever recent drawing it came from.
 * The element's closure calls the latest handler given for that key.
 */
type Kept = { sig: string; el: unknown; run: { fn: (x: any) => void } }
const kept = new Map<string, Kept>()
const MAX_KEPT = 400
function keep<T>(e: RenderInput, key: string, props: Record<string, unknown>, fn: (x: any) => void, make: (handler: (x: any) => void) => T): T {
  const id = `${e.surface}\u0000${e.component}\u0000${key}`
  const sig = JSON.stringify(props)
  const old = kept.get(id)
  if (old && old.sig === sig) {
    old.run.fn = fn
    return old.el as T
  }
  if (kept.size >= MAX_KEPT) kept.clear()
  const run = { fn }
  const el = make((x) => run.fn(x))
  kept.set(id, { sig, el, run })
  return el
}

/** The steps as buttons (and a text field for "Other" where the surface has one), the same for every command. */
function flowView($: EngineInterface, e: RenderInput) {
  const cur = activeFlow
  const v = cur ? viewOf(cur) : null
  if (!v) return null
  const t = $.ui.resolve(e)
  const { Box, Text, Button } = t
  const Input = 'Input' in t ? t.Input : null
  const token = stepToken(v)
  const button = (key: string, label: string, a: Action) =>
    keep(e, key, { label, token }, () => pressFlow($, a, token), (onPress) => <Button key={key} label={label} onPress={onPress} />)
  const note = v.notes.length ? <Text dimColor>{v.notes.join(' ')}</Text> : null
  const cancel = button(`${v.id}-cancel`, 'Cancel', { kind: 'cancel' })
  if (v.busy) return <Box flexDirection="column"><Text bold>{v.title}</Text><Text dimColor>Asking the AI...</Text></Box>
  if (v.stage === 'confirm') {
    return (
      <Box flexDirection="column">
        <Text bold>{v.heading}</Text>
        {v.summary.map((l, i) => <Text key={`${v.id}-l${i}`}>{l}</Text>)}
        {note}
        {button(`${v.id}-apply`, 'Apply', { kind: 'apply' })}
        {v.restart === false ? null : button(`${v.id}-restart`, 'Start over', { kind: 'restart' })}
        {cancel}
      </Box>
    )
  }
  const otherKey = `${v.id}-other-${v.stepKey}`
  const placeholder = v.otherHint ?? 'describe it in words, then Enter'
  return (
    <Box flexDirection="column">
      <Text bold>{v.heading}</Text>
      {v.options.map((o) => button(`${v.id}-${v.stepKey}-${o.id}`, o.label, { kind: 'choose', id: o.id }))}
      {Input && v.other
        ? keep(e, otherKey, { placeholder, token }, (x: string) => pressFlow($, { kind: 'other', text: x }, token), (onSubmit) => <Input key={otherKey} label="Other: " placeholder={placeholder} onSubmit={onSubmit} />)
        : null}
      {note}
      {cancel}
    </Box>
  )
}

async function feedback($: EngineInterface): Promise<string> {
  let office: string | null = null
  let claude: string | null = null
  let surface: string | null = null
  try { office = await installedVersion(updateIo($)) } catch {}
  try { claude = (await $.session.version()).version } catch {}
  try { const s = await $.session.surfaces(); surface = s.length ? (s.includes('terminal') ? 'terminal' : 'desktop app') : null } catch {}
  return feedbackText(office, claude, surface)
}

async function runCommand($: EngineInterface, name: string, args: string): Promise<Reply> {
  const c = COMMANDS.find((x) => x.name === name)
  const out = c ? c.run(args) : { text: 'Unknown command. Type /office-space-help.' }
  if ('boss' in out) return runCustomize($, 'boss', out.boss)
  if ('office' in out) return runCustomize($, 'office', out.office)
  if ('team' in out) return runCustomize($, 'team', out.team)
  if ('theme' in out) return runTheme($, out.theme)
  if ('action' in out) {
    try {
      const a = out.action
      if (a === 'roster') return { text: await rosterCommand($) }
      if (a === 'recap') return { text: recapCommand() }
      if (a === 'usage') return { text: await usageCommand($) }
      if (a === 'workers') return { text: await workersCommand($) }
      return { text: a === 'feedback' ? await feedback($) : await updateOffice(updateIo($)) }
    } catch (err) {
      return { text: `Office Space could not do that just now (${String(err).slice(0, 80)}). Nothing was changed.` }
    }
  }
  if ('toggle' in out) return out.toggle === 'panel' ? togglePanel($) : toggleBand($)
  return out
}

export function helpText(): string {
  const lines = COMMANDS.map((c) => `  /${c.name}${c.argumentHint ? ' ' + c.argumentHint : ''} - ${c.description}`)
  return [
    'Office Space commands:',
    ...lines,
    '',
    'Settings (/plugin -> office-space -> configure): workersDir, staleMinutes, alertOnBlocked, checkForUpdates, showUsage.',
    'Only /office-space-roster, and /office-space-boss, /office-space-team and /office-space-office (with words, or Other), make an AI call (one small-model request per ask, outside your chat); everything else is local. None of it adds anything to your conversation.',
    'Docs: https://github.com/rbrtcnkln1/office-space#readme',
  ].join('\n')
}

type RenderInput = Parameters<EngineInterface['ui']['resolve']>[0]

/**
 * The waiting/blocked external workers as pressable rows (Svg cannot take a
 * press, so this sits beside the drawing on every surface). Pressing one
 * shows its note and, when it left one, its http(s) address as text plus a
 * copy button. Nothing is ever opened.
 */
function needsView($: EngineInterface, e: RenderInput, sel: string, hotkeys: boolean) {
  const list = office.needing()
  if (!list.length) return null
  const { Box, Text, Button } = $.ui.resolve(e)
  const cur = list.find(n => n.id === sel)
  return (
    <Box flexDirection="column">
      <Text dimColor>Needs you - press one to read its note</Text>
      {list.slice(0, 9).map((n, i) => {
        const key = `need:${n.id}`
        const label = `${n.need === 'blocked' ? 'BLOCKED' : 'WAITING'}: ${n.who}${n.id === sel ? ' (showing)' : ''}`
        const hk = hotkeys ? { hotkey: String(i + 1) } : {}
        return keep(e, key, { label, ...hk }, () => { void update($, selected, v => (v === n.id ? '' : n.id)) }, (onPress) => <Button key={key} label={label} {...hk} onPress={onPress} />)
      })}
      {cur ? (
        <Box flexDirection="column">
          <Text bold>{`${cur.who} [${cur.source}] is ${cur.need}`}</Text>
          <Text>{cur.note ?? `No note left. Task: ${cur.task}`}</Text>
          {cur.url ? <Text>{cur.url}</Text> : null}
          {cur.url
            ? keep(e, 'need-copy', { url: cur.url }, (press: { surface: RenderInput['surface'] }) => {
                void (async () => {
                  const r = await $.ui.copy({ text: cur.url as string, surface: press.surface })
                  $.ui.toast(r.isCopied ? 'Office Space: link copied' : 'Office Space: could not copy, select the link above')
                })()
              }, (onPress) => <Button key="need-copy" label="Copy link" onPress={onPress} />)
            : null}
        </Box>
      ) : null}
    </Box>
  )
}

export const register: Register = (on, options) => {
  const opts = (options ?? {}) as { workersDir?: unknown; staleMinutes?: unknown }
  if (typeof opts.workersDir === 'string' && opts.workersDir.trim()) workersDir = opts.workersDir
  const sm = Number(opts.staleMinutes)
  if (Number.isFinite(sm) && sm > 0) staleMinutes = sm
  const cu = (options as { checkForUpdates?: unknown } | undefined)?.checkForUpdates
  checkForUpdates = cu === true || cu === 'true'
  const ab = (options as { alertOnBlocked?: unknown } | undefined)?.alertOnBlocked
  alertOnBlocked = !(ab === false || ab === 'false')
  const su = (options as { showUsage?: unknown } | undefined)?.showUsage
  showUsage = !(su === false || su === 'false')

  // A subagent ended: tell the recap now, in case the list drops it before the next look.
  on('classic.SubagentStop', async ($, e, next) => {
    try {
      const id = (e as { agent_id?: unknown }).agent_id
      if (typeof id === 'string' && id) {
        await dayEnsure($)
        let latest: AgentLike | undefined
        try { latest = ((await $.agent.list()) as AgentLike[]).find(a => a.id === id) } catch {}
        if (tracker.finish(id, String((e as { agent_type?: unknown }).agent_type ?? ''), latest)) await $.store.set(tracker.key, tracker.log)
      }
    } catch {}
    return next(e)
  })

  on('session.start', async ($, e, next) => {
    for (const c of COMMANDS) {
      await $.command.register({
        name: c.name,
        description: c.description,
        ...(c.argumentHint ? { argumentHint: c.argumentHint } : {}),
        immediate: true,
      })
    }
    try {
      bandOn = (await $.store.get(STORE_BAND)) === true
    } catch {}
    await loadSaved($)
    // The panel is never assumed open from an earlier chat; only one the app
    // already shows in this session (restored or kept across a reload) counts.
    paneOpen = await paneShowing($)
    if (paneOpen || bandOn) await setOpen($, true)
    if (checkForUpdates) void dailyUpdateCheck($)
    void refreshUsage($)
    if (!dayTimer) {
      void dayTick($)
      dayTimer = $.clock.every(DAY_EVERY_MS, () => { void dayTick($) })
    }
    if (alertOnBlocked && !alertTimer) {
      void watchAlerts($)
      alertTimer = $.clock.every(ALERT_EVERY_MS, () => { void watchAlerts($) })
    }
    // Not reopened here: reopening from code would put the panel back in its
    // default spot; /office-space opens it when asked.
    return next(e)
  })

  for (const c of COMMANDS) {
    on('command.run', { command: c.name }, async ($, e) => runCommand($, c.name, String(e.args ?? '')))
  }

  // Usage figures moved (context, a limit window, cost): redraw the office objects.
  on('session.measure', async ($, e, next) => {
    try {
      const b = toBoard(e)
      if (b) {
        usageBoard = b
        applyUsage()
        if (running) $.ui.invalidate('ui.render')
      }
    } catch {}
    return next(e)
  })

  // The person closing the panel with its close mark.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    paneOpen = false
    if (!bandOn) await setOpen($, false)
    return next(e)
  })

  // The main chat messaging a subagent: the Boss walks the message over.
  on('session.send', async ($, e, next) => {
    if (!e.agentId) office.deliver(e.to)
    else office.collab(e.agentId, e.to) // two agents talking: meet at the table
    return next(e)
  })

  // ----- the panel -----
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    await catchUp($)
    if (e.surface === 'desktop' || e.surface === 'vscode' || e.surface === 'mobile') {
      const { Svg } = $.ui.resolve(e)
      // No width given: the drawing takes its own (large) width up to the
      // panel's, so it fills the panel and keeps its pixel proportions.
      const { Box } = $.ui.resolve(e)
      // The floor colour fills the rest of the panel, so there's no white strip.
      // A floor-coloured box exactly as tall as the panel's body (in the panel's
      // own rows), so the app fills every pixel below the drawing too.
      const rows = e.props.scroll?.bodyRows || 0
      const sel = await read($, selected)
      return (
        <Box flexDirection="column" backgroundColor={office.floorColor()} width="100%" height={rows > 0 ? rows : '100%'} flexGrow={1}>
          <Svg source={office.render(PANE_SCALE)} alt={`Office: ${office.summary()}`} />
          {flowView($, e)}
          {needsView($, e, sel, true)}
        </Box>
      )
    }
    const { Box, Text } = $.ui.resolve(e)
    const sel = await read($, selected)
    return (
      <Box flexDirection="column">
        <Text bold color="#e0706a">◆ office space <Text dimColor>{office.summary()}</Text></Text>
        {office.textLines().map((l, i) => (
          <Text key={`p${i}`}>
            <Text color={l.dot}>● </Text>
            <Text bold>{l.title.padEnd(11)}</Text>
            <Text dimColor>{l.label}</Text>
          </Text>
        ))}
        {flowView($, e)}
        {needsView($, e, sel, true)}
      </Box>
    )
  })

  // ----- the band above the prompt (optional) -----
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    office.bossWorking = e.props.isWorking
    if (e.props.hasSurvey || !bandOn || !(await read($, open))) return next(e)
    await catchUp($)

    const sel = await read($, selected)
    if (e.surface === 'desktop') {
      const { Svg, Box } = $.ui.resolve(e)
      const naturalW = office.width * SCALE
      const naturalH = office.height * SCALE
      // Use the room the band is given (maxRows), up to MAX_BAND_PX.
      const maxH = Math.min(MAX_BAND_PX, Math.max(160, (e.props.maxRows || 30) * 16))
      const maxW = Math.max(320, (e.props.bodyColumns || 100) * 8)
      const k = Math.min(1, maxH / naturalH, maxW / naturalW)
      return (
        <Box flexDirection="column">
          <Svg
            source={office.render()}
            alt={`Office: ${office.summary()}`}
            width={Math.floor(naturalW * k)}
            height={Math.floor(naturalH * k)}
          />
          {needsView($, e, sel, false)}
        </Box>
      )
    }

    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Text bold color="#e0706a">◆ office space <Text dimColor>{office.summary()}</Text></Text>
        {office.textLines().map((l, i) => (
          <Text key={`w${i}`}>
            <Text color={l.dot}>● </Text>
            <Text bold>{l.title.padEnd(11)}</Text>
            <Text dimColor>{l.label}</Text>
          </Text>
        ))}
        {needsView($, e, sel, false)}
      </Box>
    )
  })
}
