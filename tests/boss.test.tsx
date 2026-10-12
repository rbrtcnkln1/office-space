import { describe, expect, mock, test } from 'claude-code/testing'

import { OUTFIT_COLOR, STEP_QUESTIONS, actBoss, bossView, buildPrompt, interpret, startBoss, stepOptions, summaryLines } from '../hooks/boss'
import type { Action, BossIo, Flow } from '../hooks/boss'
import { ACCESSORIES, CATALOG, DEFAULT_LOOK, HAIR_COLORS, HAIR_STYLES, OUTFITS, SLOTS, parseLookPatch, sanitizeLook } from '../hooks/catalog'
import type { BossLook, Slot } from '../hooks/catalog'
import { character, paletteFor } from '../hooks/sprites'
import { Office } from '../hooks/office'

const text = (r: unknown) => JSON.stringify(r)
const KEEP_COLOR = { kind: 'choose', id: OUTFIT_COLOR } as const

// A fake host for the flow: scripted model replies and an in-memory saved look.
function fake(opts: { replies?: (string | null)[]; saved?: unknown } = {}) {
  const replies = [...(opts.replies ?? [])]
  const io = {
    prompts: [] as string[],
    saved: opts.saved as unknown,
    complete: async (_s: string, p: string) => { io.prompts.push(p); return replies.length ? (replies.shift() as string | null) : null },
    load: async () => sanitizeLook(io.saved),
    save: async (l: BossLook | null) => { io.saved = l },
  }
  return io satisfies BossIo & Record<string, unknown>
}

describe('catalog', () => {
  test('is big enough and every entry has an id and label', () => {
    expect(HAIR_STYLES.length).toBeGreaterThanOrEqual(4)
    expect(HAIR_COLORS.length).toBeGreaterThanOrEqual(10)
    expect(HAIR_COLORS.some((c) => c.id === 'pink')).toBe(true)
    expect(OUTFITS.length).toBeGreaterThanOrEqual(5)
    expect(OUTFITS.some((o) => o.id === 'early-2000s')).toBe(true)
    expect(ACCESSORIES.length).toBeGreaterThanOrEqual(4)
    for (const s of SLOTS) {
      const ids = CATALOG[s].map((e) => e.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  test('every combination of ids draws without a missing color, from every side', () => {
    const looks: BossLook[] = [
      ...HAIR_STYLES.flatMap((h) => ACCESSORIES.map((a) => ({ hair: h.id, hairColor: 'pink', outfit: 'early-2000s', accessory: a.id }))),
      ...OUTFITS.flatMap((o) => ACCESSORIES.map((a) => ({ hair: 'frosted' as const, hairColor: 'blue', outfit: o.id, accessory: a.id }))),
    ]
    for (const look of looks) {
      const pal = paletteFor('boss', look)
      for (const dir of ['down', 'up', 'left', 'right'] as const) for (const pose of ['stand', 'seat'] as const) {
        const g = character({ role: 'boss', dir, pose, frame: 1, look })
        expect(g.length).toBe(24)
        for (const row of g) for (const k of row) if (k !== '.') expect(pal[k]).toBeDefined()
      }
    }
  })

  test('the default look draws exactly as the Boss did before customization existed', () => {
    for (const dir of ['down', 'up', 'left', 'right'] as const) for (const pose of ['stand', 'seat', 'walk', 'reach', 'lounge'] as const) {
      expect(character({ role: 'boss', dir, pose, frame: 2, look: DEFAULT_LOOK })).toEqual(character({ role: 'boss', dir, pose, frame: 2 }))
    }
    expect(paletteFor('boss', DEFAULT_LOOK)).toEqual(paletteFor('boss'))
  })

  test('a look changes the drawing (the team command restyles other roles the same way)', () => {
    const look: BossLook = { hair: 'frosted', hairColor: 'pink', outfit: 'early-2000s', accessory: 'headphones' }
    expect(character({ role: 'boss', dir: 'down', pose: 'stand', frame: 0, look })).not.toEqual(character({ role: 'boss', dir: 'down', pose: 'stand', frame: 0 }))
    expect(character({ role: 'coder', dir: 'down', pose: 'stand', frame: 0, look })).not.toEqual(character({ role: 'coder', dir: 'down', pose: 'stand', frame: 0 }))
  })

  test('parseLookPatch accepts catalog ids only, and refuses the whole patch otherwise', () => {
    expect(parseLookPatch({ hair: 'spiky', hairColor: 'pink' })).toEqual({ hair: 'spiky', hairColor: 'pink' })
    expect(parseLookPatch({ hair: null, outfit: undefined, extra: 'ignored' })).toEqual({})
    for (const bad of [{ hair: 'mohawk' }, { hairColor: '#ff00ff' }, { outfit: 5 }, { accessory: ['cap'] }, { hair: 'spiky', accessory: 'jetpack' }, null, 'x', [], 7]) {
      expect(parseLookPatch(bad)).toBeNull()
    }
  })

  test('sanitizeLook never throws and falls back field by field', () => {
    expect(sanitizeLook(undefined)).toEqual(DEFAULT_LOOK)
    expect(sanitizeLook('junk')).toEqual(DEFAULT_LOOK)
    expect(sanitizeLook({ hair: 'bob', outfit: 'nonsense', accessory: 7 })).toEqual({ ...DEFAULT_LOOK, hair: 'bob' })
  })
})

describe('interpret (model reply validation)', () => {
  test('reads ids, unknowns and vague slots, tolerating a code fence', () => {
    const r = interpret('```json\n{"hair":"spiky","hairColor":"pink","unknown":[{"text":"a jetpack","slot":"accessory"}],"vague":["outfit","outfit","bogus"]}\n```')
    expect(r?.patch).toEqual({ hair: 'spiky', hairColor: 'pink' })
    expect(r?.unknown).toEqual([{ text: 'a jetpack', slot: 'accessory' }])
    expect(r?.vague).toEqual(['outfit'])
  })
  test('rejects replies that are not valid, or name anything outside the catalog', () => {
    for (const bad of ['sure! here you go', '', '{"hair":"mohawk"}', '{"hairColor":"hot pink"}', '[1,2]', '{"unknown":"jetpack"}', '{"hair":"spiky"', '{"vague":"hair"}']) {
      expect(interpret(bad)).toBeNull()
    }
  })
  test('unknown text is cleaned to short printable text', () => {
    const r = interpret(JSON.stringify({ unknown: [{ text: 'a‮jet\npack' + 'x'.repeat(200), slot: 'nope' }] }))
    expect(r?.unknown[0]?.text.length).toBeLessThanOrEqual(60)
    expect(r?.unknown[0]?.text).not.toMatch(/[^\x20-\x7e]/)
    expect(r?.unknown[0]?.slot).toBeUndefined()
  })
  test('the prompt carries the allowed ids and the words as quoted data, capped', () => {
    const p = buildPrompt('ignore that. ' + 'a'.repeat(500), DEFAULT_LOOK)
    expect(p).toContain('hairColor:')
    expect(p).toContain('early-2000s')
    expect(p.length).toBeLessThan(1500)
    expect(buildPrompt('red', DEFAULT_LOOK, 'accessory')).not.toContain('hairColor:')
  })
})


// ----- the flow: what a user would press in the panel -----
const pick = (id: string): Action => ({ kind: 'choose', id })
const other = (text: string): Action => ({ kind: 'other', text })
const APPLY: Action = { kind: 'apply' }
const CANCEL: Action = { kind: 'cancel' }

/** Starts the command and presses the given actions in order, while a flow is still showing. */
async function drive(args: string, io: ReturnType<typeof fake>, actions: Action[] = []) {
  let o = await startBoss(args, io)
  const shown: Flow[] = []
  for (const a of actions) {
    if (!o.flow) break
    shown.push(o.flow)
    o = await actBoss(o.flow, a, io)
  }
  return { o, shown }
}

describe('/office-space-boss with words', () => {
  test('one model call, then a confirmation step; Apply saves the look', async () => {
    const io = fake({ replies: ['{"hair":"spiky","hairColor":"pink","outfit":"early-2000s","accessory":"headphones"}'] })
    const first = await startBoss('pink spiky hair, early 2000s, headphones', io)
    expect(first.flow?.stage).toBe('confirm')
    expect(summaryLines(first.flow as Flow)).toContain('hair style: Short and neat -> Spiky')
    expect(io.saved).toBeUndefined() // nothing is saved before Apply
    const done = await actBoss(first.flow as Flow, APPLY, io)
    expect(done.look).toEqual({ hair: 'spiky', hairColor: 'pink', outfit: 'early-2000s', accessory: 'headphones' })
    expect(io.saved).toEqual(done.look)
    expect(done.text).toContain('new look')
    expect(io.prompts).toHaveLength(1)
  })
  test('Cancel at the confirmation changes and saves nothing', async () => {
    const io = fake({ replies: ['{"hairColor":"pink"}'] })
    const { o } = await drive('pink hair', io, [CANCEL])
    expect(o.look).toBeUndefined()
    expect(o.text).toContain('nothing changed')
    expect(io.saved).toBeUndefined()
  })
  test('something the catalog cannot draw says so and lists the closest options (AE3)', async () => {
    const io = fake({ replies: ['{"unknown":[{"text":"a jetpack","slot":"accessory"}]}'] })
    const o = await startBoss('a jetpack', io)
    expect(o.flow).toBeUndefined()
    expect(o.text).toContain('"a jetpack" is not in the catalog yet')
    expect(o.text).toContain('accessory: glasses, headphones, baseball cap, necktie, scarf, nothing')
    expect(o.look).toBeUndefined()
  })
  test('the known part is still offered, with the note, when part of the ask is unknown', async () => {
    const io = fake({ replies: ['{"hairColor":"blue","unknown":[{"text":"a jetpack","slot":"accessory"}]}'] })
    const o = await startBoss('blue hair and a jetpack', io)
    expect(o.flow?.draft.hairColor).toBe('blue')
    expect(o.flow?.notes.join(' ')).toContain('not in the catalog yet')
  })
  test('an invalid reply is rejected with a friendly message and nothing is saved', async () => {
    for (const reply of ['{"hair":"mohawk"}', 'I think pink would be lovely!', '{"outfit":"clown-suit"}']) {
      const io = fake({ replies: [reply] })
      const o = await startBoss('whatever', io)
      expect(o.text).toContain('nothing changed')
      expect(o.flow).toBeUndefined()
      expect(o.look).toBeUndefined()
      expect(io.saved).toBeUndefined()
    }
  })
  test('with the AI unavailable it says so and points to the choices', async () => {
    const o = await startBoss('pink hair', fake({ replies: [null] }))
    expect(o.text).toContain('could not reach the AI')
    expect(o.text).toContain('/office-space-boss')
    const throws = fake()
    throws.complete = async () => { throw new Error('boom') }
    expect((await startBoss('pink hair', throws)).text).toContain('could not reach the AI')
  })
  test('a request that changes nothing explains how to ask', async () => {
    expect((await startBoss('hmm', fake({ replies: ['{}'] }))).text).toContain('could not tell what to change')
  })
  test('asking for what the Boss already has changes nothing', async () => {
    const o = await startBoss('short hair', fake({ replies: ['{"hair":"short"}'] }))
    expect(o.text).toContain('already looks')
  })
  test('a vague part asks only that step, then confirms', async () => {
    const io = fake({ replies: ['{"hairColor":"pink","vague":["outfit"]}'] })
    const { o, shown } = await drive('pink hair and something fun to wear', io, [pick('early-2000s'), APPLY])
    expect(shown.map((f) => f.stage)).toEqual(['pick', 'confirm'])
    expect(shown[0]?.slots).toEqual(['outfit'])
    expect(o.look).toMatchObject({ hairColor: 'pink', outfit: 'early-2000s' })
  })
  test('the model is told only about the current look and the words, capped', async () => {
    const io = fake({ replies: ['{}'] })
    await startBoss('x'.repeat(1000), io)
    expect(io.prompts).toHaveLength(1)
    expect(io.prompts[0]?.length).toBeLessThan(1500)
  })
})

describe('/office-space-boss stepped choices', () => {
  test('with no words: hair style, hair color, outfit, top and bottom colors, accessory, then confirm (AE2)', async () => {
    const io = fake()
    const { o, shown } = await drive('', io, [pick('spiky'), pick('pink'), pick('early-2000s'), KEEP_COLOR, KEEP_COLOR, pick('headphones'), APPLY])
    expect(shown.map((f) => (f.stage === 'pick' ? STEP_QUESTIONS[f.slots[f.i] as Slot] : 'confirm'))).toEqual([
      'Which hair style for the Boss?', 'Which hair color?', 'Which outfit?', 'Which color top?', 'Which color trousers?', 'Which accessory?', 'confirm',
    ])
    expect(o.look).toEqual({ hair: 'spiky', hairColor: 'pink', outfit: 'early-2000s', accessory: 'headphones' })
    expect(io.saved).toEqual(o.look)
    expect(io.prompts).toHaveLength(0) // buttons never call the model
  })
  test('each step offers 2 to 4 options, the first one keeps the current choice', async () => {
    const f = (await startBoss('', fake())).flow as Flow
    for (const slot of SLOTS) {
      const opts = stepOptions(slot, f.draft)
      expect(opts.length).toBeGreaterThanOrEqual(2)
      expect(opts.length).toBeLessThanOrEqual(4)
      expect(opts[0]?.label.startsWith('Keep ')).toBe(true)
    }
    expect(stepOptions('hair', { ...DEFAULT_LOOK, hair: 'spiky' }).map((o) => o.id)).toEqual(['spiky', 'curly', 'long'])
  })
  test('a press that is not one of the offered options is ignored', async () => {
    const f = (await startBoss('', fake())).flow as Flow
    const o = await actBoss(f, pick('mohawk'), fake())
    expect(o.flow?.i).toBe(0)
  })
  test('Other: free text matching the catalog exactly needs no AI call', async () => {
    const io = fake()
    const { o } = await drive('', io, [other('Bob'), pick('pink'), pick('hoodie'), KEEP_COLOR, KEEP_COLOR, pick('glasses'), APPLY])
    expect(io.prompts).toHaveLength(0)
    expect(o.look).toMatchObject({ hair: 'bob', hairColor: 'pink', outfit: 'hoodie' })
  })
  test('Other: other free text goes through the AI, restricted to that step, and its answer is validated', async () => {
    const io = fake({ replies: ['{"hairColor":"pink"}'] })
    // a suit is one piece: no separate trousers step
    const { o } = await drive('', io, [pick('short'), other('hot magenta please'), pick('suit'), KEEP_COLOR, pick('glasses'), APPLY])
    expect(io.prompts).toHaveLength(1)
    expect(io.prompts[0]).toContain('hairColor:')
    expect(io.prompts[0]).not.toContain('outfit:')
    expect(o.look?.hairColor).toBe('pink')
  })
  test('Other with something not in the catalog says so and stays on the step', async () => {
    const io = fake({ replies: ['{"unknown":[{"text":"rainbow swirl"}]}'] })
    const { shown } = await drive('', io, [pick('short'), other('rainbow swirl'), pick('blue')])
    expect(shown[2]?.i).toBe(1)
    expect(shown[2]?.notes.join(' ')).toContain('"rainbow swirl" is not in the catalog yet')
    expect(shown[2]?.notes.join(' ')).toContain('hair color: dark brown')
  })
  test('Other when the AI is unavailable or answers badly stays on the step with a note', async () => {
    for (const reply of [null, '{"hairColor":"hot magenta"}']) {
      const f = (await startBoss('', fake())).flow as Flow
      const o = await actBoss({ ...f, i: 1 }, other('rainbow'), fake({ replies: [reply] }))
      expect(o.flow?.i).toBe(1)
      expect(o.flow?.notes).toHaveLength(1)
    }
  })
  test('Cancel at any step changes nothing', async () => {
    for (let at = 0; at < 4; at++) {
      const io = fake()
      const { o } = await drive('', io, [...[pick('spiky'), pick('blue'), pick('hoodie')].slice(0, at), CANCEL])
      expect(o.look).toBeUndefined()
      expect(o.text).toContain('nothing changed')
      expect(io.saved).toBeUndefined()
    }
  })
  test('Cancel or Start over at the summary', async () => {
    const io = fake()
    const { o } = await drive('', io, [pick('spiky'), pick('blue'), pick('hoodie'), pick('glasses'), CANCEL])
    expect(o.look).toBeUndefined()
    expect(io.saved).toBeUndefined()
    const r = await drive('', fake(), [pick('spiky'), pick('blue'), pick('hoodie'), pick('glasses'), { kind: 'restart' }])
    expect(r.o.flow?.stage).toBe('pick')
    expect(r.o.flow?.i).toBe(0)
    expect(r.o.flow?.draft).toEqual(DEFAULT_LOOK)
  })
  test('keeping everything is not a change and does not ask for confirmation', async () => {
    const keep = (slot: Slot) => pick(DEFAULT_LOOK[slot] ?? OUTFIT_COLOR)
    const r = await drive('', fake(), SLOTS.filter((s) => s !== 'bottom').map(keep))
    expect(r.o.text).toContain('already looks')
    expect(r.shown.every((f) => f.stage === 'pick')).toBe(true)
  })
  test('steps start from the saved look', async () => {
    const f = (await startBoss('', fake({ saved: { ...DEFAULT_LOOK, hair: 'spiky' } }))).flow as Flow
    expect(stepOptions('hair', f.draft)[0]?.label).toBe('Keep Spiky')
  })
  test('nothing happens while an AI call is running', async () => {
    const f = (await startBoss('', fake())).flow as Flow
    const o = await actBoss({ ...f, busy: true }, pick('spiky'), fake())
    expect(o.flow?.i).toBe(0)
  })
})

describe('reset, help and persistence', () => {
  test('reset clears the saved look and returns the default', async () => {
    const io = fake({ saved: { ...DEFAULT_LOOK, hair: 'bald' } })
    const r = await startBoss('reset', io)
    expect(io.saved).toBeNull()
    expect(r.look).toEqual(DEFAULT_LOOK)
    expect(sanitizeLook(io.saved)).toEqual(DEFAULT_LOOK)
  })
  test('help says it uses a little plan usage (R20)', async () => {
    expect((await startBoss('help', fake())).text).toContain('plan usage')
  })
  test('a failing store never breaks the command', async () => {
    const io = fake({ replies: ['{"hairColor":"pink"}'] })
    io.save = async () => { throw new Error('disk full') }
    io.load = async () => { throw new Error('no store') }
    const o = await startBoss('pink hair', io)
    expect((await actBoss(o.flow as Flow, APPLY, io)).look?.hairColor).toBe('pink')
  })
})

describe('in the engine', () => {
  const NAME = 'office-space-boss'
  const PANE_PROPS = { title: 'Office Space', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { bodyRows: 40, top: 0, total: 40 } }
  const SURFACES = ['terminal', 'desktop'] as const
  // the host's pieces the plugin leans on, answered in memory
  const host = (on: any, store: Record<string, unknown> = {}, opened: unknown[] = []) => {
    on('ui.open', async (_$: any, e: any) => { opened.push(e); return { value: { isPlaced: true } } as never })
    on('ui.toast', async () => ({ value: undefined }) as never)
    on('store.get', async (_$: any, e: any) => ({ value: store[e.key] }) as never)
    on('store.set', async (_$: any, e: any) => { store[e.key] = e.value; return { value: undefined } as never })
    return store
  }

  test('is registered, listed in help, and says it uses plan usage', async ($, on) => {
    mock.clock(on)
    host(on)
    const help = text(await $.command.run({ command: 'office-space-help', args: '' } as never))
    expect(help).toContain('/office-space-boss')
    expect(help).toContain('plan usage')
  })

  test('with no words the command answers itself, opens the panel, and the panel shows the first step as buttons', async ($, on) => {
    mock.clock(on)
    const opened: unknown[] = []
    host(on, {}, opened)
    let sawModel = 0
    let sawOtherCommand = 0
    on('model.complete', async () => { sawModel++; return { value: { isAnswered: false, reason: 'aborted' } } as never })
    on('prompt.submit', async (_$: any, e: any) => { sawOtherCommand++; return e })
    const res = text(await $.command.run({ command: NAME, args: '' } as never))
    // the command's own one-line answer: no conversation turn, no model call, no fall-through
    expect(res).toContain('Office Space panel')
    expect(sawModel).toBe(0)
    expect(sawOtherCommand).toBe(0)
    expect(opened.length).toBeGreaterThan(0)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'office-space', surface, component: 'Pane', requestId: 'office-space', props: PANE_PROPS } as never)
      expect(await ui.find({ type: 'Text', text: /Which hair style for the Boss\?/ })).toBeDefined()
      expect(await ui.find({ key: 'boss-hair-spiky' } as never)).toBeDefined()
      expect(await ui.find({ key: 'boss-hair-short' } as never)).toBeDefined()
      expect(await ui.find({ key: 'boss-other-hair' } as never)).toBeDefined() // the Other field
      await ui.unmount()
    }
  })

  test('pressing the buttons walks the steps, Apply saves the look in the store and the office draws it', async ($, on) => {
    mock.clock(on)
    const store = host(on)
    on('model.complete', async () => ({ value: { isAnswered: false, reason: 'aborted' } }) as never)
    await $.command.run({ command: NAME, args: '' } as never)
    const ui = await $.ui.mount({ plugin: 'office-space', surface: 'terminal', component: 'Pane', requestId: 'office-space', props: PANE_PROPS } as never)
    for (const key of ['boss-hair-spiky', 'boss-hairColor-pink', 'boss-outfit-early-2000s', 'boss-top-white', 'boss-bottom-denim', 'boss-accessory-headphones']) {
      expect(await ui.find({ key } as never)).toBeDefined()
      await ui.press({ key } as never)
    }
    expect(await ui.find({ type: 'Text', text: /apply this change/ })).toBeDefined()
    expect(store.bossLook).toBeUndefined() // not saved until Apply
    await ui.press({ key: 'boss-apply' } as never)
    expect(store.bossLook).toEqual({ hair: 'spiky', hairColor: 'pink', outfit: 'early-2000s', accessory: 'headphones', top: 'white', bottom: 'denim' })
    await ui.unmount()
  })

  test('Other: typed words in the panel go through one model call, validated, and advance the step', async ($, on) => {
    mock.clock(on)
    host(on)
    const calls: any[] = []
    on('model.complete', async (_$: any, e: any) => { calls.push(e); return { value: { isAnswered: true, text: '{"hair":"bun"}', usage: { input_tokens: 1, output_tokens: 1 } } } as never })
    await $.command.run({ command: NAME, args: '' } as never)
    const ui = await $.ui.mount({ plugin: 'office-space', surface: 'desktop', component: 'Pane', requestId: 'office-space', props: PANE_PROPS } as never)
    await ui.input({ key: 'boss-other-hair', text: 'hair in a knot on top', kind: 'submit' } as never)
    expect(calls).toHaveLength(1)
    expect(await ui.find({ type: 'Text', text: /Which hair color\?/ })).toBeDefined()
    await ui.unmount()
  })

  test('words: one small model call, its answer shown in the panel for confirmation', async ($, on) => {
    mock.clock(on)
    const store = host(on)
    const calls: any[] = []
    on('model.complete', async (_$: any, e: any) => {
      calls.push(e)
      return { value: { isAnswered: true, text: '{"hairColor":"pink","accessory":"headphones"}', usage: { input_tokens: 1, output_tokens: 1 } } } as never
    })
    const res = text(await $.command.run({ command: NAME, args: 'pink hair and headphones' } as never))
    expect(res).toContain('Office Space panel')
    expect(calls).toHaveLength(1)
    expect(calls[0].model).toBe('haiku')
    expect(calls[0].prompt).toContain('pink hair and headphones')
    const ui = await $.ui.mount({ plugin: 'office-space', surface: 'desktop', component: 'Pane', requestId: 'office-space', props: PANE_PROPS } as never)
    expect(await ui.find({ type: 'Text', text: /hair color: Dark brown -> Pink/ })).toBeDefined()
    expect(store.bossLook).toBeUndefined()
    await ui.unmount()
  })

  test('the saved look is used when the module loads again, and reset clears it', async ($, on) => {
    mock.clock(on)
    const store = host(on, { bossLook: { hair: 'bald', hairColor: 'pink', outfit: 'hoodie', accessory: 'scarf' } })
    await $.command.run({ command: NAME, args: '' } as never)
    const ui = await $.ui.mount({ plugin: 'office-space', surface: 'terminal', component: 'Pane', requestId: 'office-space', props: PANE_PROPS } as never)
    expect(await ui.find({ key: 'boss-hair-bald' } as never)).toBeDefined()
    expect(await ui.find({ key: 'boss-hair-spiky' } as never)).toBeDefined()
    await ui.unmount()
    const res = text(await $.command.run({ command: NAME, args: 'reset' } as never))
    expect(res).toContain('default look')
    expect(store.bossLook).toBeNull()
  })

  test('the office draws the Boss with the look', () => {
    const o = new Office()
    const a = o.render()
    o.bossLook = { hair: 'frosted', hairColor: 'pink', outfit: 'early-2000s', accessory: 'headphones' }
    const b = o.render()
    expect(b).not.toEqual(a)
    expect(b).toContain('#f27bb5') // the pink hair
    o.bossLook = undefined
    expect(o.render()).toEqual(a)
  })
})

describe('plain words map onto the catalog', () => {
  const ASK = 'Silverhair, headphones, white graphic tee, bluejeans, white converse'
  test('a literal reply (silver hair, blue jeans, converse all "unknown") is settled: gray hair, denim jeans, shoes offered to draw', async () => {
    const io = fake({ replies: [JSON.stringify({
      outfit: 'tee', accessory: 'headphones',
      unknown: [{ text: 'silver hair', slot: 'hairColor' }, { text: 'blue jeans', slot: 'outfit' }, { text: 'white converse sneakers', slot: 'outfit' }],
    })] })
    const o = await startBoss(ASK, io)
    const f = o.flow as Flow
    expect(f.stage).toBe('confirm')
    expect(f.draft).toEqual({ hair: 'short', hairColor: 'gray', outfit: 'tee', accessory: 'headphones', bottom: 'denim' })
    expect(f.offers?.map((d) => d.slot)).toEqual(['shoes'])
    const notes = f.notes.join('\n')
    expect(notes).toContain('press Draw it')
    expect(notes).not.toContain("aren't part of")
    expect(notes).not.toContain('blue jeans')
    expect(notes).not.toContain('silver')
    expect(notes).not.toContain('Closest options')
    expect(summaryLines(f)).toContain('hair color: Dark brown -> Gray')
  })
  test('a well-behaved reply: synonyms mapped by the model; shoes become one draw offer, tattoos are said plainly', async () => {
    const io = fake({ replies: ['{"hairColor":"gray","outfit":"tee","accessory":"headphones","missing":[{"text":"white converse","kind":"shoes"},{"text":"converse","kind":"shoes"},{"text":"a tattoo","kind":"tattoos"}]}'] })
    const f = (await startBoss(ASK, io)).flow as Flow
    expect(f.offers).toEqual([{ text: 'white converse', slot: 'shoes' }])
    expect(f.notes[0]).toBe("Tattoos aren't part of the Boss's look yet.")
  })
  test('an ask the model finds ambiguous becomes a step, not a guess', async () => {
    const io = fake({ replies: ['{"outfit":"tee","vague":["hairColor"]}'] })
    const f = (await startBoss('silvery-white hair and a tee', io)).flow as Flow
    expect(f.stage).toBe('pick')
    expect(f.slots).toEqual(['hairColor'])
    expect(f.draft.outfit).toBe('tee')
  })
  test('ids stay strict: a made-up id still rejects the whole reply (R18)', async () => {
    expect(interpret('{"hairColor":"silver"}')).toBeNull()
    expect(interpret('{"missing":"shoes"}')).toBeNull()
    expect(interpret('{"unknown":[{"text":"tattoos"}]}')?.missing).toEqual(['tattoos'])
  })
  test('Other with words for a missing part says so without closest options', async () => {
    const io = fake({ replies: ['{"missing":[{"text":"a tattoo","kind":"tattoos"}]}'] })
    const start = (await startBoss('', io)).flow as Flow
    const r = await actBoss({ ...start, i: 2 }, { kind: 'other', text: 'a tattoo' }, io)
    expect(r.flow?.notes.join(' ')).toBe("Tattoos aren't part of the Boss's look yet.")
  })
  test('Other with something drawable offers to draw it and stays on the step', async () => {
    const io = fake({ replies: ['{"missing":[{"text":"red sneakers","kind":"shoes"}]}'] })
    const start = (await startBoss('', io)).flow as Flow
    const r = await actBoss({ ...start, i: 2 }, { kind: 'other', text: 'red sneakers' }, io)
    expect(r.flow?.i).toBe(2)
    expect(r.flow?.offers).toEqual([{ text: 'red sneakers', slot: 'shoes' }])
    expect(bossView(r.flow as Flow)?.extra).toEqual([{ id: 'draw0', label: 'Draw it: red sneakers' }])
  })
  test('the prompt gives ids with their names and the matching rules', async () => {
    let system = ''
    const io = { ...fake({ replies: ['{}'] }), complete: async (s: string) => { system = s; return '{}' } }
    await startBoss(ASK, io)
    const p = buildPrompt(ASK, DEFAULT_LOOK)
    expect(p).toContain('tee (T-shirt and jeans)')
    expect(p).toContain('gray')
    expect(system).toContain('silver')
    expect(system).toContain('missing')
    expect(system).toContain('vague')
    expect(system).toContain('not part of the look')
  })
})
