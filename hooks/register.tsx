// Office Space: a tiny 1990s RPG office. The main chat is The Boss; subagents
// walk in for their assignment, sit at a desk, work, then walk back to hand in
// the result and leave. The Boss walks a message over whenever the main chat
// messages a subagent.
//
//   /office-space        open or close the Office Space panel
//   /office-space band   show or hide the small version above the prompt
//
// Art and roles: ./sprites.ts. Layout, walking and handoffs: ./office.ts.

import { atom, read, update } from 'claude-code'
import type { AgentInfo, EngineInterface, Register } from 'claude-code'

import { FLOOR, Office, SCALE } from './office'
import type { AgentLike } from './office'

const open = atom({ plugin: 'office-space', key: 'open' } as const, false)
const PANE = 'office-space'
const STORE_PANE = 'pane'
const STORE_BAND = 'band'
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

async function poll($: EngineInterface): Promise<void> {
  let list: AgentInfo[] = []
  try {
    list = await $.agent.list()
  } catch {
    list = []
  }
  office.sync(list as AgentLike[])
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
    if (saved) for (const [k, v] of Object.entries(saved)) office.eotd.set(k as never, v)
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

async function setOpen($: EngineInterface, on: boolean) {
  await update($, open, () => on)
  if (on) {
    office = new Office()
    await loadEotd($)
    await poll($)
    start($)
  } else {
    stop()
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'office-space',
      description: 'Open the 16-bit office of running agents (add "band" for the strip above the prompt)',
      argumentHint: '[band]',
      immediate: true,
    })
    try {
      paneOpen = (await $.store.get(STORE_PANE)) === true
      bandOn = (await $.store.get(STORE_BAND)) === true
    } catch {}
    if (paneOpen || bandOn) await setOpen($, true)
    // Not reopened here: the app restores panels itself, and reopening from
    // code would put the panel back in its default spot.
    return next(e)
  })

  on('command.run', { command: 'office-space' }, async ($, e) => {
    const arg = String(e.args ?? '').trim().toLowerCase()
    if (arg === 'band') {
      bandOn = !bandOn
      try { await $.store.set(STORE_BAND, bandOn) } catch {}
      await setOpen($, bandOn || paneOpen)
      $.ui.invalidate('ui.render')
      return { text: bandOn ? 'Office Space band is on.' : 'Office Space band is off.' }
    }
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
  })

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
