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
// Each command is one row of COMMANDS below.
//
// Work running outside the session appears too: any script can drop one JSON
// file per worker into the workers directory (see ./external.ts and README).
//
// Art and roles: ./sprites.ts. Layout, walking and handoffs: ./office.ts.

import { atom, read, update } from 'claude-code'
import type { AgentInfo, EngineInterface, Register } from 'claude-code'

import { FLOOR, Office, SCALE } from './office'
import { ROLES } from './sprites'
import type { AgentLike } from './office'
import { DEFAULT_DIR, DEFAULT_STALE_MINUTES, MAX_FILE_BYTES, expandDir, isWorkerFile, parseWorker, toAgents } from './external'
import type { ExternalWorker } from './external'
import { compareVersions, feedbackText, installedVersion, latestVersion, parseVersion, toastText, updateOffice } from './update'
import type { UpdateIo } from './update'

const open = atom({ plugin: 'office-space', key: 'open' } as const, false)
const PANE = 'office-space'
const STORE_PANE = 'pane'
const STORE_BAND = 'band'
const STORE_UPDATE_CHECKED = 'updateChecked'
const DAY_MS = 24 * 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 8000
let checkForUpdates = false
const TICK_MS = 100
const POLL_EVERY = 10 // ticks between agent-list reads
const MAX_BAND_PX = 460 // tallest the band version may draw on desktop (about half a laptop window)
const PANE_SCALE = 4 // drawn large; the panel shrinks it to fit its width

let office = new Office()
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
  const now = Date.now()
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

async function poll($: EngineInterface): Promise<void> {
  let list: AgentInfo[] = []
  try {
    list = await $.agent.list()
  } catch {
    list = []
  }
  const remote = toAgents(await readExternal($), Date.now(), staleMinutes)
  office.sync([...(list as AgentLike[]), ...remote])
  if (office.eotdDirty) {
    office.eotdDirty = false
    try { await $.store.set(eotdKey(), Object.fromEntries(office.eotd)) } catch {}
  }
}

/** Employee of the Day counts are kept per calendar day, across reloads. */
function eotdKey(): string {
  const d = new Date()
  return `eotd:${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
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
type Outcome = Reply | { toggle: 'panel' | 'band' } | { action: 'update' | 'feedback' }
type Command = {
  name: string
  description: string
  argumentHint?: string
  run: (args: string) => Outcome
}

async function togglePanel($: EngineInterface): Promise<Reply> {
  if (paneOpen) {
    await $.ui.close({ id: PANE })
    paneOpen = false
    try { await $.store.set(STORE_PANE, false) } catch {}
    await setOpen($, bandOn)
    return { text: 'Office Space is closed for the day.' }
  }
  await setOpen($, true)
  await openPane($)
  try { await $.store.set(STORE_PANE, true) } catch {}
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
]

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
  if ('action' in out) return { text: out.action === 'feedback' ? await feedback($) : await updateOffice(updateIo($)) }
  if ('toggle' in out) return out.toggle === 'panel' ? togglePanel($) : toggleBand($)
  return out
}

export function helpText(): string {
  const lines = COMMANDS.map((c) => `  /${c.name}${c.argumentHint ? ' ' + c.argumentHint : ''} - ${c.description}`)
  return [
    'Office Space commands:',
    ...lines,
    '',
    'Settings (/plugin -> office-space -> configure): workersDir, staleMinutes, checkForUpdates.',
    'Docs: https://github.com/rbrtcnkln1/office-space#readme',
  ].join('\n')
}

export const register: Register = (on, options) => {
  const opts = (options ?? {}) as { workersDir?: unknown; staleMinutes?: unknown }
  if (typeof opts.workersDir === 'string' && opts.workersDir.trim()) workersDir = opts.workersDir
  const sm = Number(opts.staleMinutes)
  if (Number.isFinite(sm) && sm > 0) staleMinutes = sm
  const cu = (options as { checkForUpdates?: unknown } | undefined)?.checkForUpdates
  checkForUpdates = cu === true || cu === 'true'

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
      paneOpen = (await $.store.get(STORE_PANE)) === true
      bandOn = (await $.store.get(STORE_BAND)) === true
    } catch {}
    if (paneOpen || bandOn) await setOpen($, true)
    if (checkForUpdates) void dailyUpdateCheck($)
    // Not reopened here: the app restores panels itself, and reopening from
    // code would put the panel back in its default spot.
    return next(e)
  })

  for (const c of COMMANDS) {
    on('command.run', { command: c.name }, async ($, e) => runCommand($, c.name, String(e.args ?? '')))
  }

  // The person closing the panel with its close mark.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    paneOpen = false
    try { await $.store.set(STORE_PANE, false) } catch {}
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
      return (
        <Box flexDirection="column" backgroundColor={FLOOR} width="100%" height={rows > 0 ? rows : '100%'} flexGrow={1}>
          <Svg source={office.render(PANE_SCALE)} alt={`Office: ${office.summary()}`} />
        </Box>
      )
    }
    const { Box, Text } = $.ui.resolve(e)
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
      </Box>
    )
  })

  // ----- the band above the prompt (optional) -----
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    office.bossWorking = e.props.isWorking
    if (e.props.hasSurvey || !bandOn || !(await read($, open))) return next(e)
    await catchUp($)

    if (e.surface === 'desktop') {
      const { Svg } = $.ui.resolve(e)
      const naturalW = office.width * SCALE
      const naturalH = office.height * SCALE
      // Use the room the band is given (maxRows), up to MAX_BAND_PX.
      const maxH = Math.min(MAX_BAND_PX, Math.max(160, (e.props.maxRows || 30) * 16))
      const maxW = Math.max(320, (e.props.bodyColumns || 100) * 8)
      const k = Math.min(1, maxH / naturalH, maxW / naturalW)
      return (
        <Svg
          source={office.render()}
          alt={`Office: ${office.summary()}`}
          width={Math.floor(naturalW * k)}
          height={Math.floor(naturalH * k)}
        />
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
      </Box>
    )
  })
}
