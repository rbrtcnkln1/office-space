import { describe, expect, mock, test } from 'claude-code/testing'

import { MAX_TITLE, TEAM_ROLES, actTeam, applyChanges, buildPrompt, cleanTitle, interpretTeam, normalizeTeam, parseTeamStrict, sanitizeTeam, startTeam, teamLines, teamStep } from '../hooks/team'
import type { Team, TeamFlow, TeamIo } from '../hooks/team'
import type { Action } from '../hooks/boss'
import { character, paletteFor } from '../hooks/sprites'
import { Office } from '../hooks/office'

const text = (r: unknown) => JSON.stringify(r)
const EMPTY: Team = { titles: {}, looks: {} }

function fake(opts: { replies?: (string | null)[]; saved?: unknown } = {}) {
  const replies = [...(opts.replies ?? [])]
  const io = {
    prompts: [] as string[],
    saved: opts.saved as unknown,
    complete: async (_s: string, p: string) => { io.prompts.push(p); return replies.length ? (replies.shift() as string | null) : null },
    load: async () => sanitizeTeam(io.saved),
    save: async (t: Team | null) => { io.saved = t },
  }
  return io satisfies TeamIo & Record<string, unknown>
}
const act = (f: TeamFlow, io: TeamIo, ...as: Action[]) => as.reduce<Promise<any>>(async (p, a) => { const r = await p; return actTeam(r.flow ?? f, a, io) }, Promise.resolve({ flow: f }))

describe('team data', () => {
  test('titles are cleaned and capped; hostile text cannot get through', () => {
    expect(cleanTitle('Mx. Bytes')).toBe('Mx. Bytes')
    expect(cleanTitle('a'.repeat(50)).length).toBe(MAX_TITLE)
    expect(cleanTitle('Bad\u001b[31mName\u0000')).not.toMatch(/[\u0000-\u001f]/)
    expect(cleanTitle(42)).toBe('')
  })

  test('sanitizeTeam keeps the valid parts, drops the rest, never throws', () => {
    const t = sanitizeTeam({ titles: { coder: 'Mx. Bytes', boss: 'Nope', writer: 7 }, looks: { coder: { hairColor: 'pink', outfit: 'nope', hair: 3 }, boss: { hair: 'bun' } }, desks: 99, junk: 1 })
    expect(t).toEqual({ titles: { coder: 'Mx. Bytes' }, looks: { coder: { hairColor: 'pink' } } })
    expect(sanitizeTeam(null)).toEqual(EMPTY)
    expect(sanitizeTeam('x')).toEqual(EMPTY)
    expect(sanitizeTeam({ titles: { __proto__: 'x' } })).toEqual(EMPTY)
    expect(sanitizeTeam({ desks: 10 })).toEqual({ titles: {}, looks: {}, desks: 10 })
    expect(sanitizeTeam({ desks: 5 })).toEqual(EMPTY) // the default is not a customization
  })

  test('parseTeamStrict refuses unknown keys, roles, ids and out-of-range desks', () => {
    expect(parseTeamStrict({ titles: { coder: 'Ok' }, looks: { coder: { hair: 'bun' } }, desks: 8 })).not.toBeNull()
    for (const bad of [
      { extra: 1 }, { titles: { boss: 'x' } }, { titles: { coder: '' } }, { titles: { coder: 'x'.repeat(40) } }, { titles: { coder: 'a\u0007b' } },
      { looks: { coder: { hair: 'mohawk' } } }, { looks: { coder: { wings: 'big' } } }, { looks: { ghost: { hair: 'bun' } } },
      { desks: 4 }, { desks: 16 }, { desks: 7.5 }, { desks: '8' }, [], 'x', null,
    ]) expect(parseTeamStrict(bad)).toBeNull()
  })

  test('teamLines names each change, old to new', () => {
    const to = applyChanges(EMPTY, { changes: [{ role: 'coder', title: 'Mx. Bytes', look: { hairColor: 'pink' } }], desks: 10 })
    expect(teamLines(EMPTY, to)).toEqual(['Coder title: Coder -> Mx. Bytes', 'Mx. Bytes hair color: default -> Pink', 'starting desks: 5 -> 10'])
    expect(teamLines(to, to)).toEqual([])
  })
})

describe('interpretTeam (model reply validation)', () => {
  test('reads roles, titles, ids and desks, tolerating a code fence', () => {
    const p = interpretTeam('```json\n{"changes":[{"role":"coder","title":"Mx. Bytes","outfit":"hoodie"}],"desks":8}\n```')
    expect(p?.changes).toEqual([{ role: 'coder', title: 'Mx. Bytes', look: { outfit: 'hoodie' } }])
    expect(p?.desks).toBe(8)
  })
  test('rejects the whole reply for an invented role or id, a bad title or desk count', () => {
    for (const r of [
      'nope', '[]', '{"changes":"x"}', '{"changes":[{"role":"janitor","title":"x"}]}', '{"changes":[{"role":"coder","hair":"mohawk"}]}',
      '{"changes":[{"role":"coder","title":"   "}]}', '{"changes":[{"role":"coder","title":9}]}', '{"desks":3}', '{"desks":"8"}', '{"unknown":"x"}',
      `{"changes":[${Array.from({ length: 11 }, () => '{"role":"coder","title":"a"}').join(',')}]}`,
    ]) expect(interpretTeam(r)).toBeNull()
  })
  test('the Boss is skipped with a note (that is another command)', () => {
    const p = interpretTeam('{"changes":[{"role":"boss","title":"King"},{"role":"writer","title":"Scribe"}]}')
    expect(p?.changes).toEqual([{ role: 'writer', title: 'Scribe' }])
    expect(p?.skipped.length).toBe(1)
  })
  test('a hostile title is sanitized and capped', () => {
    const p = interpretTeam(JSON.stringify({ changes: [{ role: 'coder', title: `\u001b]0;pwn\u0007${'z'.repeat(60)}` }] }))
    const t = p?.changes[0]?.title ?? ''
    expect(t).not.toMatch(/[\u0000-\u001f\u009b]/)
    expect(t.length).toBeLessThanOrEqual(MAX_TITLE)
  })
  test('the prompt carries the role list and the words as quoted, capped data', () => {
    const pr = buildPrompt('x'.repeat(1000), EMPTY)
    expect(pr).toContain('coder (Coder)')
    expect(pr.length).toBeLessThan(2500)
  })
})

describe('/office-space-team with words', () => {
  test('one model call, a confirmation, and Apply saves', async () => {
    const io = fake({ replies: ['{"changes":[{"role":"coder","title":"Mx. Bytes"}]}'] })
    const r = await startTeam('call the Coder "Mx. Bytes"', io)
    expect(io.prompts).toHaveLength(1)
    expect(r.flow?.stage).toBe('confirm')
    expect(io.saved).toBeUndefined() // nothing until Apply
    const done = await actTeam(r.flow as TeamFlow, { kind: 'apply' }, io)
    expect(done.team?.titles.coder).toBe('Mx. Bytes')
    expect(io.saved).toEqual({ titles: { coder: 'Mx. Bytes' }, looks: {} })
    expect(done.text).toContain('Coder title: Coder -> Mx. Bytes')
  })
  test('Cancel changes and saves nothing', async () => {
    const io = fake({ replies: ['{"desks":10}'] })
    const r = await startTeam('ten desks', io)
    const done = await actTeam(r.flow as TeamFlow, { kind: 'cancel' }, io)
    expect(done.team).toBeUndefined()
    expect(io.saved).toBeUndefined()
  })
  test('an invalid reply is rejected, the AI being unavailable is said, nothing is saved', async () => {
    const bad = fake({ replies: ['{"changes":[{"role":"coder","hair":"mohawk"}]}'] })
    const a = await startTeam('mohawk', bad)
    expect(a.text).toContain('could not use')
    const off = fake({ replies: [null] })
    const b = await startTeam('rename', off)
    expect(b.text).toContain('could not reach the AI')
    expect(bad.saved).toBeUndefined()
    expect(off.saved).toBeUndefined()
  })
  test('something not in the catalog is named with the closest options', async () => {
    const io = fake({ replies: ['{"changes":[{"role":"coder","accessory":"headphones"}],"unknown":[{"text":"jetpack"}]}'] })
    const r = await startTeam('headphones and a jetpack for the coder', io)
    expect(r.flow?.notes.join('\n')).toContain('"jetpack" is not in the catalog yet')
    const only = fake({ replies: ['{"unknown":["a jetpack"]}'] })
    expect((await startTeam('jetpack', only)).text).toContain('not in the catalog yet')
  })
  test('asking for what is already true changes nothing', async () => {
    const io = fake({ replies: ['{"desks":5}'], saved: undefined })
    expect((await startTeam('five desks', io)).text).toContain('nothing changed')
  })
})

describe('/office-space-team stepped choices', () => {
  test('desks: what -> desks -> choice -> summary -> Apply', async () => {
    const io = fake()
    const r = await startTeam('', io)
    expect(r.flow?.stage).toBe('what')
    const out = await act(r.flow as TeamFlow, io, { kind: 'choose', id: 'desks' }, { kind: 'choose', id: '10' })
    expect(out.flow.stage).toBe('confirm')
    const done = await actTeam(out.flow, { kind: 'apply' }, io)
    expect(done.team?.desks).toBe(10)
    expect(io.saved).toEqual({ titles: {}, looks: {}, desks: 10 })
  })
  test('restyle: role -> hair -> style -> color -> summary', async () => {
    const io = fake()
    const r = await startTeam('', io)
    const out = await act(r.flow as TeamFlow, io, { kind: 'choose', id: 'member' }, { kind: 'choose', id: 'writer' }, { kind: 'choose', id: 'hair' }, { kind: 'choose', id: 'curly' }, { kind: 'choose', id: 'pink' })
    expect(out.flow.stage).toBe('confirm')
    expect(out.flow.draft.looks.writer).toEqual({ hair: 'curly', hairColor: 'pink' })
  })
  test('rename: the Other field is the new title, sanitized', async () => {
    const io = fake()
    const r = await startTeam('', io)
    const out = await act(r.flow as TeamFlow, io, { kind: 'choose', id: 'member' }, { kind: 'choose', id: 'coder' }, { kind: 'choose', id: 'title' }, { kind: 'other', text: 'Mx.\u001b Bytes' })
    expect(out.flow.draft.titles.coder).toBe('Mx. Bytes')
  })
  test('each step offers 2 to 4 options', async () => {
    const io = fake()
    let f = (await startTeam('', io)).flow as TeamFlow
    for (const id of ['member', 'writer', 'hair']) {
      const n = teamStep(f)?.options.length ?? 0
      expect(n).toBeGreaterThanOrEqual(2)
      expect(n).toBeLessThanOrEqual(4)
      f = (await actTeam(f, { kind: 'choose', id }, io)).flow as TeamFlow
    }
    expect(teamStep(f)?.options.length).toBeLessThanOrEqual(4)
  })
  test('Other at the role step: an exact role needs no AI call; other words go through the AI', async () => {
    const io = fake({ replies: ['{"changes":[{"role":"analyst","title":"Numbers"}]}'] })
    let f = (await startTeam('', io)).flow as TeamFlow
    f = (await actTeam(f, { kind: 'choose', id: 'member' }, io)).flow as TeamFlow
    const exact = await actTeam(f, { kind: 'other', text: 'the Planner' }, io)
    expect(io.prompts).toHaveLength(0)
    expect(exact.flow?.role).toBe('planner')
    const words = await actTeam(f, { kind: 'other', text: 'rename the analyst Numbers' }, io)
    expect(io.prompts).toHaveLength(1)
    expect(words.flow?.stage).toBe('confirm')
  })
  test('Other: bad desk numbers are refused, the AI being offline stays on the step', async () => {
    const io = fake({ replies: [null] })
    let f = (await startTeam('', io)).flow as TeamFlow
    f = (await actTeam(f, { kind: 'choose', id: 'desks' }, io)).flow as TeamFlow
    expect((await actTeam(f, { kind: 'other', text: '40' }, io)).flow?.notes[0]).toContain('whole number')
    const off = await actTeam({ ...f, stage: 'role' }, { kind: 'other', text: 'something odd' }, io)
    expect(off.flow?.stage).toBe('role')
    expect(off.flow?.notes[0]).toContain('could not reach the AI')
  })
  test('Cancel at any step, a press that is not offered, and a busy flow do nothing', async () => {
    const io = fake()
    const f = (await startTeam('', io)).flow as TeamFlow
    expect((await actTeam(f, { kind: 'cancel' }, io)).text).toContain('nothing changed')
    expect((await actTeam(f, { kind: 'choose', id: 'ghost' }, io)).flow?.stage).toBe('what')
    expect((await actTeam({ ...f, busy: true }, { kind: 'choose', id: 'desks' }, io)).flow?.stage).toBe('what')
    expect(io.saved).toBeUndefined()
  })
  test('Start over returns to the first step', async () => {
    const io = fake()
    let f = (await startTeam('', io)).flow as TeamFlow
    f = (await actTeam(f, { kind: 'choose', id: 'desks' }, io)).flow as TeamFlow
    expect((await actTeam(f, { kind: 'restart' }, io)).flow?.stage).toBe('what')
  })
})

describe('reset, help and persistence', () => {
  const saved = { titles: { coder: 'Mx. Bytes', writer: 'Scribe' }, looks: { coder: { hairColor: 'pink' } }, desks: 10 }
  test('reset clears everything; reset <role> clears one', async () => {
    const io = fake({ saved })
    const one = await startTeam('reset coder', io)
    expect(one.team?.titles).toEqual({ writer: 'Scribe' })
    expect(one.team?.looks).toEqual({})
    expect(io.saved).toEqual({ titles: { writer: 'Scribe' }, looks: {}, desks: 10 })
    const all = await startTeam('reset', io)
    expect(all.team).toEqual(EMPTY)
    expect(io.saved).toBeNull()
    expect((await startTeam('reset ghost', io)).text).toContain('do not know that role')
  })
  test('help says it uses a little plan usage (R20)', async () => {
    expect((await startTeam('help', fake())).text).toContain('plan usage')
  })
  test('a failing store never breaks the command', async () => {
    const io = { ...fake({ replies: ['{"desks":8}'] }), load: async () => { throw new Error('x') }, save: async () => { throw new Error('y') } }
    const r = await startTeam('8 desks', io)
    const done = await actTeam(r.flow as TeamFlow, { kind: 'apply' }, io)
    expect(done.team?.desks).toBe(8)
  })
  test('normalize makes equal teams compare equal', () => {
    expect(normalizeTeam({ titles: { coder: '' }, looks: { coder: {} }, desks: 5 })).toEqual(EMPTY)
  })
})

describe('the office draws the team', () => {
  test('defaults render byte-identical, with or without an empty team', () => {
    const a = new Office().render()
    const o = new Office()
    o.setTeam(undefined)
    expect(o.render()).toEqual(a)
    o.setTeam(EMPTY)
    expect(o.render()).toEqual(a)
    // the Boss look never leaks to the team
    const b = new Office()
    b.bossLook = { hair: 'frosted', hairColor: 'pink', outfit: 'early-2000s', accessory: 'headphones' }
    expect(character({ role: 'coder', dir: 'down', pose: 'stand', frame: 0 })).toEqual(character({ role: 'coder', dir: 'down', pose: 'stand', frame: 0 }))
  })
  const staff = (o: Office) => o.sync([{ id: 'a1', description: 'implement the thing', type: 'x', status: 'running' }] as never)
  test('a renamed role shows its title, escaped, and the panel text uses it', () => {
    const o = new Office()
    staff(o)
    o.setTeam({ titles: { coder: 'A<b>&"Q"' }, looks: {} })
    const svg = o.render()
    expect(svg).toContain('A&lt;b&gt;&amp;&quot;Q&quot;')
    expect(svg).not.toContain('A<b>')
    expect(o.textLines()[0]?.title).toBe('A<b>&"Q"') // text surfaces are Text nodes, which draw literally
  })
  test('a restyled role draws with the new look; a part left out keeps the role default', () => {
    const o = new Office()
    staff(o)
    const before = o.render()
    o.setTeam({ titles: {}, looks: { coder: { hairColor: 'pink' } } })
    const after = o.render()
    expect(after).not.toEqual(before)
    expect(after).toContain('#f27bb5')
    const pal = paletteFor('coder', { hairColor: 'pink' })
    expect(pal.C).toBe(paletteFor('coder').C) // outfit untouched
    expect(character({ role: 'coder', dir: 'down', pose: 'stand', frame: 0, look: { hairColor: 'pink' } })).toEqual(character({ role: 'coder', dir: 'down', pose: 'stand', frame: 0 }))
    expect(character({ role: 'coder', dir: 'down', pose: 'stand', frame: 0, look: { accessory: 'none' } })).not.toEqual(character({ role: 'coder', dir: 'down', pose: 'stand', frame: 0 }))
  })
  test('every role and every catalog part draws with no missing color', () => {
    for (const role of TEAM_ROLES) for (const look of [{ hair: 'bun' }, { outfit: 'lab-coat' }, { accessory: 'cap' }, { hairColor: 'teal', outfit: 'cardigan', accessory: 'scarf', hair: 'frosted' }] as const) {
      const pal = paletteFor(role, look)
      for (const dir of ['down', 'up', 'left', 'right'] as const) for (const row of character({ role, dir, pose: 'seat', frame: 1, look })) for (const k of row) if (k !== '.') expect(pal[k]).toBeDefined()
    }
  })
  test('starting desks grow the floor, shrink back, and never yank an occupied desk', () => {
    const o = new Office()
    expect(o.desks.length).toBe(5)
    o.setTeam({ titles: {}, looks: {}, desks: 15 })
    expect(o.desks.length).toBe(15)
    o.setTeam({ titles: {}, looks: {}, desks: 10 })
    expect(o.desks.length).toBe(10)
    o.setTeam(undefined)
    expect(o.desks.length).toBe(5)
    // a worker sitting at a far desk keeps it
    o.setTeam({ titles: {}, looks: {}, desks: 15 })
    o.sync([{ id: 'w1', description: 'work', type: 'x', status: 'running' }] as never)
    const slot = [...o.workers.values()][0]?.desk ?? -1
    o.desks[slot] = null
    o.desks[12] = 'w1'
    const w = o.workers.get('w1')
    if (w) w.desk = 12
    o.setTeam(undefined)
    expect(o.desks.length).toBeGreaterThan(12)
    expect(o.desks[12]).toBe('w1')
  })
})

describe('in the engine', () => {
  const NAME = 'office-space-team'
  const PANE_PROPS = { title: 'Office Space', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { bodyRows: 40, top: 0, total: 40 } }
  const host = (on: any, store: Record<string, unknown> = {}) => {
    on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
    on('ui.toast', async () => ({ value: undefined }) as never)
    on('store.get', async (_$: any, e: any) => ({ value: store[e.key] }) as never)
    on('store.set', async (_$: any, e: any) => { store[e.key] = e.value; return { value: undefined } as never })
    return store
  }
  const mountPane = ($: any, surface: string) => $.ui.mount({ plugin: 'office-space', surface, component: 'Pane', requestId: 'office-space', props: PANE_PROPS } as never)

  test('is registered, listed in help, and says it uses plan usage', async ($, on) => {
    mock.clock(on)
    host(on)
    const help = text(await $.command.run({ command: 'office-space-help', args: '' } as never))
    expect(help).toContain('/office-space-team')
    expect(help).toContain('Rename roles')
    expect(help).toContain('plan usage')
  })

  test('no words: the command answers itself, opens the panel and never reaches the model or chat', async ($, on) => {
    mock.clock(on)
    host(on)
    let model = 0
    let chat = 0
    on('model.complete', async () => { model++; return { value: { isAnswered: false, reason: 'aborted' } } as never })
    on('prompt.submit', async (_$: any, e: any) => { chat++; return e })
    const res = text(await $.command.run({ command: NAME, args: '' } as never))
    expect(res).toContain('Office Space panel')
    expect(model).toBe(0)
    expect(chat).toBe(0)
    for (const surface of ['terminal', 'desktop']) {
      const ui = await mountPane($, surface)
      expect(await ui.find({ type: 'Text', text: /What do you want to change\?/ })).toBeDefined()
      expect(await ui.find({ key: 'team-what-desks' } as never)).toBeDefined()
      expect(await ui.find({ key: 'team-other-what' } as never)).toBeDefined()
      await ui.unmount()
    }
  })

  test('buttons walk to a rename; Apply saves to the store and the office wears it', async ($, on) => {
    mock.clock(on)
    const store = host(on)
    await $.command.run({ command: NAME, args: '' } as never)
    const ui = await mountPane($, 'desktop')
    for (const key of ['team-what-member', 'team-role-coder', 'team-aspect-title']) await ui.press({ key } as never)
    await ui.input({ key: 'team-other-title', text: 'Mx. Bytes', kind: 'submit' } as never)
    expect(await ui.find({ type: 'Text', text: /Coder title: Coder -> Mx. Bytes/ })).toBeDefined()
    expect(store.team).toBeUndefined()
    await ui.press({ key: 'team-apply' } as never)
    expect(store.team).toEqual({ titles: { coder: 'Mx. Bytes' }, looks: {} })
    await ui.unmount()
    const res = text(await $.command.run({ command: NAME, args: 'reset' } as never))
    expect(res).toContain('defaults')
    expect(store.team).toBeNull()
  })

  test('words: one small model call, shown in the panel for confirmation', async ($, on) => {
    mock.clock(on)
    const store = host(on)
    const calls: any[] = []
    on('model.complete', async (_$: any, e: any) => { calls.push(e); return { value: { isAnswered: true, text: '{"desks":10}', usage: { input_tokens: 1, output_tokens: 1 } } } as never })
    const res = text(await $.command.run({ command: NAME, args: 'start with ten desks' } as never))
    expect(res).toContain('Office Space panel')
    expect(calls).toHaveLength(1)
    expect(calls[0].model).toBe('haiku')
    const ui = await mountPane($, 'terminal')
    expect(await ui.find({ type: 'Text', text: /starting desks: 5 -> 10/ })).toBeDefined()
    expect(store.team).toBeUndefined()
    await ui.unmount()
  })

  test('a saved team is used when the module loads', async ($, on) => {
    mock.clock(on)
    host(on, { team: { titles: { coder: 'Saved Name' }, looks: {}, desks: 10 } })
    await $.command.run({ command: NAME, args: '' } as never)
    const ui = await mountPane($, 'terminal')
    await ui.press({ key: 'team-what-member' } as never)
    expect(await ui.find({ key: 'team-role-coder' } as never)).toBeDefined()
    expect(await ui.find({ type: 'Button', label: 'Saved Name' } as never)).toBeDefined()
    await ui.unmount()
  })
})
