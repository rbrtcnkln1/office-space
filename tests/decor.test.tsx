import { describe, expect, mock, test } from 'claude-code/testing'

import { actOffice, buildPrompt, interpret, officeView, startOffice, stepOptions } from '../hooks/decorate'
import type { OFlow, OfficeIo } from '../hooks/decorate'
import type { Action } from '../hooks/flow'
import {
  DEFAULT_OFFICE, FEATURED, FLOORS, ITEMS, SLOTS, WALLS, applyPatch, changeLines, fits, freeSlot, hasSouth, isDefaultOffice, itemOf, parseOfficePatch, pieceAt, sameOffice,
  sanitizeOffice, slotRect,
} from '../hooks/decor'
import type { OfficeLook, Rect } from '../hooks/decor'
import { DECOR_PAL, FRAMES, floorSvg, itemGrid } from '../hooks/decorart'
import { Office, hash } from '../hooks/office'

const text = (r: unknown) => JSON.stringify(r)
const plain = (): OfficeLook => ({ ...DEFAULT_OFFICE, items: {} })

// A fake host for the flow: scripted model replies and an in-memory saved office.
function fake(opts: { replies?: (string | null)[]; saved?: unknown } = {}) {
  const replies = [...(opts.replies ?? [])]
  const io = {
    prompts: [] as string[],
    saved: opts.saved as unknown,
    complete: async (_s: string, p: string) => { io.prompts.push(p); return replies.length ? (replies.shift() as string | null) : null },
    load: async () => sanitizeOffice(io.saved),
    save: async (l: OfficeLook | null) => { io.saved = l },
  }
  return io satisfies OfficeIo & Record<string, unknown>
}

const pick = (id: string): Action => ({ kind: 'choose', id })
const other = (t: string): Action => ({ kind: 'other', text: t })
const APPLY: Action = { kind: 'apply' }

const hit = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

describe('catalog', () => {
  test('is big enough and every entry has an id and label', () => {
    expect(WALLS.length).toBeGreaterThanOrEqual(6)
    expect(FLOORS.length).toBeGreaterThanOrEqual(4)
    expect(new Set(FLOORS.map((f) => f.pattern)).size).toBeGreaterThanOrEqual(3)
    for (const id of ['vending-machine', 'arcade-cabinet', 'couch', 'lava-lamp', 'fish-tank']) expect(itemOf(id)).toBeDefined()
    expect(ITEMS.filter((i) => i.place === 'wall').length).toBeGreaterThanOrEqual(3) // posters
    expect(ITEMS.filter((i) => i.id.includes('fern') || i.id === 'cactus').length).toBeGreaterThanOrEqual(2) // plants
    for (const list of [WALLS, FLOORS, ITEMS, SLOTS]) {
      const ids = list.map((e) => e.id)
      expect(new Set(ids).size).toBe(ids.length)
      for (const e of list) expect(e.label.length).toBeGreaterThan(2)
    }
  })

  test('the first wall and floor are the original ones', () => {
    expect(WALLS[0]).toMatchObject({ id: 'slate', wall: '#6f86a3', base: '#4e6380' })
    expect(FLOORS[0]).toMatchObject({ id: 'slate-tiles', base: '#8ea1ba' })
  })

  test('every piece draws at exactly the declared size, with no missing color, in every frame', () => {
    for (const it of ITEMS) {
      for (let f = 0; f < (FRAMES[it.id] ?? 1); f++) {
        const g = itemGrid(it.id, f)
        expect(g, it.id).toBeDefined()
        expect(g?.length).toBe(it.h)
        for (const row of g ?? []) {
          expect(row.length).toBe(it.w)
          for (const k of row) if (k !== '.') expect(DECOR_PAL[k], `${it.id} key ${k}`).toBeDefined()
        }
      }
    }
    expect(itemGrid('nonsense')).toBeUndefined()
  })

  test('animated pieces really change between frames', () => {
    for (const id of Object.keys(FRAMES)) expect(itemGrid(id, 0)).not.toEqual(itemGrid(id, 1))
  })

  test('every slot suits at least one piece and the vending machine has a spot of its own', () => {
    for (const s of SLOTS) expect(ITEMS.some((i) => fits(i.id, s.id))).toBe(true)
    expect(SLOTS.filter((s) => fits('vending-machine', s.id)).map((s) => s.id)).toEqual(['break'])
    expect(fits('poster-cat', 'bottom-1')).toBe(false)
  })

  test('each floor pattern is drawn and cached', () => {
    for (const f of FLOORS) {
      const a = floorSvg(f, 368, 200)
      expect(a).toContain(f.base)
      expect(floorSvg(f, 368, 200)).toBe(a)
    }
  })
})

describe('the office look', () => {
  test('sanitizeOffice never throws and falls back part by part', () => {
    expect(sanitizeOffice(undefined)).toEqual(DEFAULT_OFFICE)
    expect(sanitizeOffice('junk')).toEqual(DEFAULT_OFFICE)
    expect(sanitizeOffice({ wall: 'teal', floor: 'nope', items: { break: 'vending-machine', 'bottom-1': 'poster-cat', ghost: 'couch', 'bottom-2': 7 } })).toEqual({
      wall: 'teal', floor: 'slate-tiles', items: { break: 'vending-machine' },
    })
    expect(isDefaultOffice(sanitizeOffice({ wall: 'teal' }))).toBe(false)
    expect(isDefaultOffice(undefined)).toBe(true)
  })

  test('parseOfficePatch accepts catalog ids only, and refuses the whole patch otherwise', () => {
    expect(parseOfficePatch({ wall: 'teal', add: [{ item: 'couch', slot: 'bottom-2' }, { item: 'vending-machine' }], remove: ['cactus'] })).toEqual({
      wall: 'teal', add: [{ item: 'couch', slot: 'bottom-2' }, { item: 'vending-machine' }], remove: ['cactus'],
    })
    expect(parseOfficePatch({ wall: null, add: null, extra: 'ignored' })).toEqual({})
    for (const bad of [
      { wall: 'neon' }, { floor: '#fff' }, { add: [{ item: 'jetpack' }] }, { add: [{ item: 'couch', slot: 'wall-door' }] }, { add: [{ item: 'couch', slot: 'roof' }] },
      { add: 'couch' }, { add: [{ item: 5 }] }, { remove: ['ghost'] }, { remove: [7] }, { wall: 'teal', floor: 'lava' }, null, 'x', [], 7,
    ]) expect(parseOfficePatch(bad)).toBeNull()
  })

  test('applyPatch puts pieces in free slots, replaces on request, removes, and says when there is no room', () => {
    let l = applyPatch(plain(), { add: [{ item: 'couch' }, { item: 'couch' }] }).look
    expect(Object.values(l.items)).toEqual(['couch', 'couch'])
    expect(freeSlot(l, 'couch')).toBe('bottom-3')
    l = applyPatch(l, { add: [{ item: 'cactus', slot: 'bottom-1' }] }).look
    expect(l.items['bottom-1']).toBe('cactus')
    expect(applyPatch(l, { remove: ['couch'] }).look.items).toEqual({ 'bottom-1': 'cactus' }) // every copy
    expect(applyPatch(l, { remove: ['bottom-1'] }).look.items['bottom-1']).toBeUndefined()
    expect(applyPatch(plain(), { remove: ['couch'] }).notes[0]).toContain('no couch')
    const full = applyPatch(plain(), { add: Array.from({ length: 5 }, () => ({ item: 'couch' })) }).look
    const more = applyPatch(full, { add: [{ item: 'cactus' }] })
    expect(sameOffice(more.look, full)).toBe(true)
    expect(more.notes[0]).toContain('no free spot')
    // a second vending machine has nowhere to go
    const v = applyPatch(plain(), { add: [{ item: 'vending-machine' }, { item: 'vending-machine' }] })
    expect(Object.values(v.look.items)).toEqual(['vending-machine'])
    expect(v.notes[0]).toContain('no free spot')
  })

  test('changeLines name what changes, old to new', () => {
    const to = applyPatch(plain(), { wall: 'teal', add: [{ item: 'couch', slot: 'bottom-2' }] }).look
    expect(changeLines(plain(), to)).toEqual(['wall color: Slate blue -> Teal', 'add a couch in the bottom wall, left'])
    expect(changeLines(to, to)).toEqual([])
  })
})

describe('placement never blocks a path', () => {
  // The room at several sizes: more workers widen the floor and add rows.
  const rooms = [0, 6, 13, 20].map((n) => {
    const o = new Office()
    o.sync(Array.from({ length: n }, (_, i) => ({ id: `w${i}`, description: `Task ${i}`, type: 'general-purpose', status: 'running' as const })))
    return o
  })

  test('slots stay clear of walkways, desks, the door, the Boss and every break spot', () => {
    for (const o of rooms) {
      const g = o.geometry()
      const W = g.W
      const reserved: Record<string, Rect> = {
        aisle: { x: 0, y: o.aisleY(), w: W, h: 24 },
        leftCorridor: { x: 0, y: 30, w: 24, h: g.baseH - 30 },
        rightCorridor: { x: W - 24, y: 30, w: 24, h: g.baseH - 30 },
        door: { x: 0, y: 8, w: 28, h: 40 },
        boss: { x: o.bossX(), y: o.bossY(), w: 96, h: 40 },
        gymMat: { x: o.bossRight() + 6, y: 58, w: 24, h: 8 },
      }
      for (const k of ['cooler', 'trash', 'gym', 'station'] as const) { const p = o.areaSpot(k); reserved[k] = { x: p.x, y: p.y, w: 16, h: 22 } }
      for (const side of [0, 1]) { const p = o.areaSpot('chat', side); reserved[`chat${side}`] = { x: p.x, y: p.y, w: 16, h: 22 } }
      for (let i = 0; i < o.desks.length; i++) { const c = o.cell(i); reserved[`desk${i}`] = { x: c.x, y: c.y, w: 64, h: 46 } }
      // furniture already in the break area and on the wall (see Office.breakArea / backWall)
      const furniture: Record<string, Rect> = {
        station: { x: o.stationX(), y: 30, w: 18, h: 12 },
        trash: { x: W - 80, y: 44, w: 8, h: 8 },
        cooler: { x: W - 40, y: 30, w: 8, h: 14 },
        table: { x: o.tableX(), y: 44, w: 26, h: 7 },
        windowA: { x: o.bossX() + 36, y: 13, w: 24, h: 15 },
        windowB: { x: o.tableX() - 4, y: 13, w: 24, h: 15 },
        sign: { x: W - 104, y: 11, w: 44, h: 18 },
        usage: { x: o.bossX() + 71 - 8, y: 11, w: 72, h: 20 },
      }
      for (const s of SLOTS) {
        const r = slotRect(s.id, g)
        for (const [name, b] of Object.entries(reserved)) expect(hit(r, b), `${s.id} vs ${name} (W=${W})`).toBe(false)
        for (const [name, b] of Object.entries(furniture)) expect(hit(r, b), `${s.id} vs ${name} (W=${W})`).toBe(false)
        for (const other of SLOTS) if (other.id !== s.id) expect(hit(r, slotRect(other.id, g)), `${s.id} vs ${other.id}`).toBe(false)
      }
      // the way from the aisle up to the vending machine is clear (it is the machine's own spot, so it is left out above)
      const v = o.areaSpot('vending')
      const walk: Rect = { x: v.x, y: v.y, w: 16, h: o.aisleY() - v.y }
      for (const [name, b] of Object.entries(furniture)) if (name !== 'usage' && !name.startsWith('window') && name !== 'sign') expect(hit(walk, b), `vending walk vs ${name}`).toBe(false)
      for (const k of ['cooler', 'trash', 'gym', 'station'] as const) expect(hit(walk, reserved[k] as Rect), `vending walk vs ${k} spot`).toBe(false)
    }
  })

  test('every piece stays inside its slot and inside the room', () => {
    for (const o of rooms) {
      const g = o.geometry()
      for (const it of ITEMS) for (const s of SLOTS) {
        if (!fits(it.id, s.id)) continue
        const r = slotRect(s.id, g)
        const at = pieceAt(it.id, s.id, g)
        expect(at.x).toBeGreaterThanOrEqual(r.x)
        expect(at.y).toBeGreaterThanOrEqual(r.y)
        expect(at.x + it.w).toBeLessThanOrEqual(r.x + r.w)
        expect(at.y + it.h).toBeLessThanOrEqual(r.y + r.h)
        expect(at.x).toBeGreaterThanOrEqual(0)
        expect(at.x + it.w).toBeLessThanOrEqual(g.W)
      }
    }
  })

  test('the bottom strip is added only when something stands along the bottom wall', () => {
    const o = new Office()
    const base = o.height
    o.decor = sanitizeOffice({ items: { break: 'vending-machine', 'wall-door': 'poster-cat' } })
    expect(o.height).toBe(base)
    expect(hasSouth(o.decor)).toBe(false)
    o.decor = sanitizeOffice({ items: { 'bottom-3': 'couch' } })
    expect(o.height).toBe(base + 30)
    expect(o.render()).toContain(`viewBox="0 0 ${o.width} ${o.height}"`)
    expect(o.baseHeight).toBe(base)
  })
})

describe('the default office is unchanged', () => {
  // Hashes of the renderer before decor existed (0.11.0 plus the two-line desk label), for scenes that need no randomness.
  const scenes = () => {
    const a = new Office().render(2)
    const o = new Office()
    o.sync([{ id: 'a1', description: 'Implement the login fix', type: 'general-purpose', status: 'running' }, { id: 'a2', description: 'Research card routing', type: 'general-purpose', status: 'idle' }])
    const b = o.render(2)
    const o3 = new Office()
    o3.sync(Array.from({ length: 9 }, (_, i) => ({ id: 'b' + i, description: 'Task ' + i, type: 'general-purpose', status: 'running' as const })))
    const c = o3.render(2, 0.3)
    return { a, b, c }
  }
  test('draws byte for byte as before', () => {
    const { a, b, c } = scenes()
    expect([hash(a), a.length, hash(b), b.length, hash(c), c.length]).toEqual([4224029829, 23421, 875836005, 25566, 437568474, 70173])
  })
  test('a saved default (or none) draws the same as no decor at all', () => {
    const o = new Office()
    const a = o.render()
    o.decor = sanitizeOffice(undefined)
    expect(o.render()).toEqual(a)
    expect(o.floorColor()).toBe('#8ea1ba')
  })
  test('decorating changes the drawing, undoing it restores it', () => {
    const o = new Office()
    const a = o.render()
    o.decor = sanitizeOffice({ wall: 'teal', floor: 'oak-planks', items: { break: 'vending-machine', 'bottom-1': 'arcade-cabinet' } })
    const b = o.render()
    expect(b).not.toEqual(a)
    expect(b).toContain('#2f9aa0') // teal wall
    expect(o.floorColor()).toBe('#c9a06b')
    o.decor = undefined
    expect(o.render()).toEqual(a)
  })
})

describe('the vending machine on breaks', () => {
  const crew = (o: Office) => o.sync([
    { id: 'a1', description: 'Fix it', type: 'general-purpose', status: 'waiting' },
    { id: 'a2', description: 'Test it', type: 'general-purpose', status: 'waiting' },
    { id: 'a3', description: 'Ship it', type: 'general-purpose', status: 'waiting' },
  ])
  test('a worker walks to it, buys something, and goes back to the desk', () => {
    {
      const o = new Office()
      o.decor = sanitizeOffice({ items: { break: 'vending-machine' } })
      crew(o)
      const w = [...(o as any).workers.values()][0]
      ;(o as any).takeBreak(w, 'vending')
      const spot = o.areaSpot('vending')
      let atMachine = false
      let carried: string | null = null
      for (let i = 0; i < 400; i++) {
        o.step()
        if (w.activity === 'vending') { atMachine = true; expect(w.pos).toEqual(spot) }
        if (w.item) carried = w.item
        if (atMachine && w.seated) break // back at the desk (stop before any later random break)
      }
      expect(atMachine).toBe(true)
      expect(['soda', 'donut', 'cookie']).toContain(carried)
      expect(w.seated).toBe(true)
      expect(w.pos).toEqual(o.seatOf(w.desk))
    }
  })

  test('workers choose it on their own, but only when the machine is there', () => {
    const visits = (decor: unknown) => {
      const o = new Office()
      if (decor) o.decor = sanitizeOffice(decor)
      crew(o)
      let n = 0
      const was = new Map<string, unknown>()
      for (let i = 0; i < 30000; i++) {
        o.step()
        for (const w of (o as any).workers.values()) {
          if (w.activity === 'vending' && was.get(w.id) !== 'vending') n++
          was.set(w.id, w.activity)
        }
      }
      return n
    }
    expect(visits({ items: { break: 'vending-machine' } })).toBeGreaterThan(0)
    expect(visits({ items: { 'bottom-1': 'couch' } })).toBe(0)
    expect(visits(undefined)).toBe(0)
  })

  test('the machine lights up while someone is at it', () => {
    {
      const o = new Office()
      o.decor = sanitizeOffice({ items: { break: 'vending-machine' } })
      crew(o)
      const idle = o.render()
      const w = [...(o as any).workers.values()][0]
      ;(o as any).takeBreak(w, 'vending')
      let busy = ''
      for (let i = 0; i < 200 && !busy; i++) { o.step(); if (w.activity === 'vending') busy = o.render() }
      expect(busy).not.toEqual('')
      expect(busy).not.toEqual(idle)
    }
  })
})

describe('words', () => {
  test('one model call, a summary to confirm, and Apply saves', async () => {
    const io = fake({ replies: ['{"wall":"teal","add":[{"item":"vending-machine"},{"item":"arcade-cabinet"}]}'] })
    const o = await startOffice('teal walls, a vending machine and an arcade cabinet', io)
    expect(io.prompts).toHaveLength(1)
    expect(io.prompts[0]).toContain('teal walls')
    const f = o.flow as OFlow
    expect(f.stage).toBe('confirm')
    expect(io.saved).toBeUndefined() // nothing saved before Apply
    const v = officeView(f)
    expect(v?.summary).toEqual(['wall color: Slate blue -> Teal', 'add a vending machine in the break area', 'add a arcade cabinet in the bottom wall, far left'])
    const done = await actOffice(f, APPLY, io)
    expect(done.look?.wall).toBe('teal')
    expect(done.look?.items).toEqual({ break: 'vending-machine', 'bottom-1': 'arcade-cabinet' })
    expect(sanitizeOffice(io.saved)).toEqual(done.look)
  })

  test('an explicit slot is honoured and a fenced reply still parses', async () => {
    const io = fake({ replies: ['```json\n{"add":[{"item":"couch","slot":"bottom-5"}]}\n```'] })
    const f = (await startOffice('a couch on the far right', io)).flow as OFlow
    expect((await actOffice(f, APPLY, io)).look?.items).toEqual({ 'bottom-5': 'couch' })
  })

  test('something not in the catalog is named with the closest options (AE3 for the office)', async () => {
    const io = fake({ replies: ['{"unknown":[{"text":"a hot tub","kind":"furniture"}]}'] })
    const o = await startOffice('a hot tub', io)
    expect(o.flow).toBeUndefined()
    expect(o.text).toContain('"a hot tub" is not in the catalog yet')
    expect(o.text).toContain('vending machine')
    expect(o.text).toContain('arcade cabinet')
    expect(io.saved).toBeUndefined()
  })

  test('part known, part not: the known part is offered, the rest is explained', async () => {
    const io = fake({ replies: ['{"wall":"sage","unknown":[{"text":"neon floor","kind":"floor"}]}'] })
    const f = (await startOffice('sage walls and a neon floor', io)).flow as OFlow
    expect(f.stage).toBe('confirm')
    expect(f.notes.join(' ')).toContain('"neon floor" is not in the catalog yet')
    expect(f.notes.join(' ')).toContain('oak planks')
  })

  test('invented ids are rejected as a whole, before anything is shown or saved (R18)', async () => {
    for (const bad of ['{"wall":"neon-pink"}', '{"add":[{"item":"jetpack"}]}', '{"add":[{"item":"couch","slot":"wall-door"}]}', 'sure, I will do that', '[]', '', '{"remove":["ghost"]}']) {
      const io = fake({ replies: [bad] })
      const o = await startOffice('anything', io)
      expect(o.flow).toBeUndefined()
      expect(o.look).toBeUndefined()
      expect(o.text).toContain('nothing changed')
      expect(io.saved).toBeUndefined()
    }
  })

  test('AI unavailable: a friendly message, nothing changes, and the steps are suggested', async () => {
    const io = fake({ replies: [null] })
    const o = await startOffice('teal walls', io)
    expect(o.text).toContain('nothing changed')
    expect(o.text).toContain('no words')
    const thrown = fake()
    thrown.complete = async () => { throw new Error('offline') }
    expect((await startOffice('teal walls', thrown)).text).toContain('nothing changed')
  })

  test('vague asks walk the open steps only', async () => {
    const io = fake({ replies: ['{"wall":"cream","vague":["floor","wall"]}'] })
    const o = await startOffice('make it cozy', io)
    const f = o.flow as OFlow
    expect(f.stage).toBe('pick')
    expect(f.step).toBe('floor') // the wall was named plainly, so only the floor is asked
    expect(f.draft.wall).toBe('cream')
    const done = await actOffice(f, pick('oak-planks'), io)
    expect((done.flow as OFlow).stage).toBe('confirm')
  })

  test('the model is only told catalog ids', () => {
    const p = buildPrompt('x', plain())
    for (const id of ['vending-machine', 'teal', 'oak-planks', 'bottom-3']) expect(p).toContain(id)
  })

  test('words that change nothing say so', async () => {
    const io = fake({ saved: { wall: 'teal' }, replies: ['{"wall":"teal"}'] })
    expect((await startOffice('teal walls', io)).text).toContain('nothing changed')
    expect((await startOffice('', fake())).flow).toBeDefined()
    expect(interpret('{"wall":"teal","unknown":"x"}')).toBeNull()
  })
})

describe('the stepped flow', () => {
  test('no words: what to change, which piece, where, summary, Apply (AE2 for the office)', async () => {
    const io = fake()
    let o = await startOffice('', io)
    let f = o.flow as OFlow
    expect(f.step).toBe('what')
    expect(stepOptions(f).map((x) => x.id)).toEqual(['furniture', 'wall', 'floor']) // nothing to remove yet
    expect(io.prompts).toHaveLength(0)
    f = (await actOffice(f, pick('furniture'), io)).flow as OFlow
    expect(f.step).toBe('furniture')
    expect(stepOptions(f).length).toBeGreaterThanOrEqual(2)
    expect(stepOptions(f).length).toBeLessThanOrEqual(4)
    f = (await actOffice(f, pick('arcade-cabinet'), io)).flow as OFlow
    expect(f.step).toBe('where')
    expect(officeView(f)?.heading).toContain('Where should the arcade cabinet go?')
    expect(stepOptions(f).map((x) => x.id)).toEqual(['bottom-1', 'bottom-2', 'bottom-3', 'bottom-4']) // 2 to 4 options
    f = (await actOffice(f, pick('bottom-3'), io)).flow as OFlow
    expect(f.stage).toBe('confirm')
    expect(officeView(f)?.summary).toEqual(['add a arcade cabinet in the bottom wall, middle'])
    expect(io.saved).toBeUndefined()
    o = await actOffice(f, APPLY, io)
    expect(o.look?.items).toEqual({ 'bottom-3': 'arcade-cabinet' })
    expect(io.prompts).toHaveLength(0) // no AI anywhere on the button path
  })

  test('a piece with one possible spot skips the where step', async () => {
    const io = fake()
    let f = (await startOffice('', io)).flow as OFlow
    f = (await actOffice(f, pick('furniture'), io)).flow as OFlow
    f = (await actOffice(f, pick('vending-machine'), io)).flow as OFlow
    expect(f.stage).toBe('confirm')
  })

  test('wall and floor steps offer the current choice and a few others', async () => {
    const io = fake({ saved: { wall: 'teal' } })
    let f = (await startOffice('', io)).flow as OFlow
    f = (await actOffice(f, pick('wall'), io)).flow as OFlow
    const opts = stepOptions(f)
    expect(opts[0]).toEqual({ id: 'teal', label: 'Keep Teal' })
    expect(opts.length).toBe(4)
    expect(new Set(opts.map((x) => x.id)).size).toBe(4)
    f = (await actOffice(f, pick('cream'), io)).flow as OFlow
    expect(officeView(f)?.summary).toEqual(['wall color: Teal -> Cream'])
    // keeping the current choice changes nothing
    let g = (await startOffice('', io)).flow as OFlow
    g = (await actOffice(g, pick('floor'), io)).flow as OFlow
    const kept = await actOffice(g, pick('slate-tiles'), io)
    expect(kept.text).toContain('nothing changed')
  })

  test('Other: an exact name needs no AI, other words go through the same AI path and are validated', async () => {
    const io = fake({ replies: ['{"add":[{"item":"potted-fern"}]}', '{"wall":"neon"}', '{"unknown":[{"text":"a jetpack","kind":"furniture"}]}'] })
    let f = (await startOffice('', io)).flow as OFlow
    f = (await actOffice(f, pick('furniture'), io)).flow as OFlow
    // exact label: handled locally
    const exact = await actOffice(f, other('Fish tank'), io)
    expect(io.prompts).toHaveLength(0)
    expect((exact.flow as OFlow).step).toBe('where')
    // words: one model call, then the summary to confirm
    const words = await actOffice(f, other('something green with leaves'), io)
    expect(io.prompts).toHaveLength(1)
    expect((words.flow as OFlow).stage).toBe('confirm')
    expect(officeView(words.flow as OFlow)?.summary[0]).toContain('potted fern')
    // an invalid reply keeps the step and says so
    const bad = await actOffice(f, other('glowing walls'), io)
    expect((bad.flow as OFlow).step).toBe('furniture')
    expect((bad.flow as OFlow).notes[0]).toContain('could not read')
    // not in the catalog: named, with options, the step stays
    const unk = await actOffice(f, other('a jetpack'), io)
    expect((unk.flow as OFlow).notes[0]).toContain('"a jetpack" is not in the catalog yet')
    // offline
    const off = await actOffice(f, other('a sofa'), io)
    expect((off.flow as OFlow).notes[0]).toContain('could not reach the AI')
    expect((off.flow as OFlow).step).toBe('furniture')
  })

  test('Other at the where step reaches the AI with the piece as context', async () => {
    const io = fake({ replies: ['{"add":[{"item":"couch","slot":"bottom-5"}]}'] })
    let f = (await startOffice('', io)).flow as OFlow
    f = (await actOffice(f, pick('furniture'), io)).flow as OFlow
    f = (await actOffice(f, pick('couch'), io)).flow as OFlow
    expect(f.step).toBe('where')
    const r = await actOffice(f, other('in the corner on the right'), io)
    expect(io.prompts[0]).toContain('couch')
    expect(officeView(r.flow as OFlow)?.summary).toEqual(['add a couch in the bottom wall, far right'])
  })

  test('Cancel changes nothing, Start over begins again, a stale press is ignored', async () => {
    const io = fake()
    let f = (await startOffice('', io)).flow as OFlow
    f = (await actOffice(f, pick('wall'), io)).flow as OFlow
    expect((await actOffice(f, pick('not-an-option'), io)).flow).toEqual(f)
    f = (await actOffice(f, pick('teal'), io)).flow as OFlow
    expect(f.stage).toBe('confirm')
    const again = await actOffice(f, { kind: 'restart' }, io)
    expect((again.flow as OFlow).step).toBe('what')
    expect((again.flow as OFlow).draft).toEqual(plain())
    const c = await actOffice(f, { kind: 'cancel' }, io)
    expect(c.text).toContain('nothing changed')
    expect(c.look).toBeUndefined()
    expect(io.saved).toBeUndefined()
    // while an AI call is running, nothing else happens
    const busy = await actOffice({ ...f, busy: true, stage: 'pick', step: 'what' }, pick('wall'), io)
    expect((busy.flow as OFlow).step).toBe('what')
  })

  test('removing a piece by buttons', async () => {
    const io = fake({ saved: { items: { 'bottom-1': 'couch', 'wall-door': 'poster-cat' } } })
    let f = (await startOffice('', io)).flow as OFlow
    expect(stepOptions(f).map((x) => x.id)).toContain('remove')
    f = (await actOffice(f, pick('remove'), io)).flow as OFlow
    expect(stepOptions(f).map((x) => x.label)).toEqual(['Cat poster (the wall by the door)', 'Couch (the bottom wall, far left)'])
    f = (await actOffice(f, pick('bottom-1'), io)).flow as OFlow
    expect(officeView(f)?.summary).toEqual(['remove the couch from the bottom wall, far left'])
    const done = await actOffice(f, APPLY, io)
    expect(done.look?.items).toEqual({ 'wall-door': 'poster-cat' })
  })
})

describe('remove, list, reset and help', () => {
  test('"remove couch" needs no AI and still asks you to confirm', async () => {
    const io = fake({ saved: { items: { 'bottom-2': 'couch' } } })
    const o = await startOffice('remove couch', io)
    expect(io.prompts).toHaveLength(0)
    const f = o.flow as OFlow
    expect(officeView(f)?.summary).toEqual(['remove the couch from the bottom wall, left'])
    expect((await actOffice(f, APPLY, io)).look?.items).toEqual({})
    expect(isDefaultOffice(sanitizeOffice(io.saved))).toBe(true)
  })

  test('removing what is not there says so; bare "remove" with nothing placed says so', async () => {
    expect((await startOffice('remove couch', fake())).text).toContain('no couch')
    expect((await startOffice('remove', fake())).text).toContain('no extra furniture')
    const f = (await startOffice('remove', fake({ saved: { items: { break: 'vending-machine' } } }))).flow as OFlow
    expect(f.step).toBe('remove')
  })

  test('"remove" with other words goes through the AI path', async () => {
    const io = fake({ saved: { items: { 'bottom-2': 'couch', 'bottom-3': 'cactus' } }, replies: ['{"remove":["bottom-3"]}'] })
    const f = (await startOffice('remove the spiky plant', io)).flow as OFlow
    expect(io.prompts).toHaveLength(1)
    expect(officeView(f)?.summary).toEqual(['remove the cactus from the bottom wall, middle'])
  })

  test('list shows the catalog and what is in the office, with no AI', async () => {
    const io = fake({ saved: { wall: 'teal' } })
    const o = await startOffice('list', io)
    expect(io.prompts).toHaveLength(0)
    for (const w of ['teal', 'vending machine', 'oak planks', 'slate tiles']) expect(o.text).toContain(w)
  })

  test('reset clears the saved office and returns the plain one', async () => {
    const io = fake({ saved: { wall: 'teal', items: { break: 'vending-machine' } } })
    const r = await startOffice('reset', io)
    expect(io.saved).toBeNull()
    expect(r.look).toEqual(DEFAULT_OFFICE)
    expect(sanitizeOffice(io.saved)).toEqual(DEFAULT_OFFICE)
    expect(io.prompts).toHaveLength(0)
  })

  test('help says the words path uses a little plan usage (R20)', async () => {
    const t = (await startOffice('help', fake())).text as string
    expect(t).toContain('plan usage')
    expect(t).toContain('reset')
    expect(t).toContain('remove')
  })

  test('a failing store never breaks the command', async () => {
    const io = fake({ replies: ['{"wall":"rose"}'] })
    io.save = async () => { throw new Error('disk full') }
    io.load = async () => { throw new Error('no store') }
    const o = await startOffice('rose walls', io)
    expect((await actOffice(o.flow as OFlow, APPLY, io)).look?.wall).toBe('rose')
  })
})

describe('in the engine', () => {
  const NAME = 'office-space-office'
  const PANE_PROPS = { title: 'Office Space', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { bodyRows: 40, top: 0, total: 40 } }
  const SURFACES = ['terminal', 'desktop'] as const
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
    expect(help).toContain('/office-space-office')
    expect(help).toContain('plan usage')
  })

  test('with no words: the command answers itself, opens the panel, and the panel shows the first step on both surfaces', async ($, on) => {
    mock.clock(on)
    const opened: unknown[] = []
    host(on, {}, opened)
    let sawModel = 0
    let fellThrough = 0
    on('model.complete', async () => { sawModel++; return { value: { isAnswered: false, reason: 'aborted' } } as never })
    on('prompt.submit', async (_$: any, e: any) => { fellThrough++; return e })
    const res = text(await $.command.run({ command: NAME, args: '' } as never))
    expect(res).toContain('Office Space panel')
    expect(sawModel).toBe(0)
    expect(fellThrough).toBe(0)
    expect(opened.length).toBeGreaterThan(0)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'office-space', surface, component: 'Pane', requestId: 'office-space', props: PANE_PROPS } as never)
      expect(await ui.find({ type: 'Text', text: /What would you like to change\?/ })).toBeDefined()
      expect(await ui.find({ key: 'office-what-furniture' } as never)).toBeDefined()
      expect(await ui.find({ key: 'office-what-wall' } as never)).toBeDefined()
      expect(await ui.find({ key: 'office-what-floor' } as never)).toBeDefined()
      expect(await ui.find({ key: 'office-other-what' } as never)).toBeDefined() // the Other field
      expect(await ui.find({ key: 'office-cancel' } as never)).toBeDefined()
      await ui.unmount()
    }
  })

  test('buttons walk the steps; Apply saves to the store and the office draws it', async ($, on) => {
    mock.clock(on)
    const store = host(on)
    on('model.complete', async () => ({ value: { isAnswered: false, reason: 'aborted' } }) as never)
    await $.command.run({ command: NAME, args: '' } as never)
    const ui = await $.ui.mount({ plugin: 'office-space', surface: 'terminal', component: 'Pane', requestId: 'office-space', props: PANE_PROPS } as never)
    for (const key of ['office-what-furniture', 'office-furniture-arcade-cabinet', 'office-where-bottom-2']) {
      expect(await ui.find({ key } as never)).toBeDefined()
      await ui.press({ key } as never)
    }
    expect(await ui.find({ type: 'Text', text: /apply this change/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /add a arcade cabinet in the bottom wall, left/ })).toBeDefined()
    expect(store.officeLook).toBeUndefined() // not saved until Apply
    await ui.press({ key: 'office-apply' } as never)
    expect(store.officeLook).toEqual({ wall: 'slate', floor: 'slate-tiles', items: { 'bottom-2': 'arcade-cabinet' } })
    await ui.unmount()
    // the desktop drawing now includes the arcade cabinet (the strip along the bottom wall)
    const desk = await $.ui.mount({ plugin: 'office-space', surface: 'desktop', component: 'Pane', requestId: 'office-space', props: PANE_PROPS } as never)
    const svg = (await desk.find({ type: 'Svg' } as never)) as any
    expect(JSON.stringify(svg)).toContain('#d6408f') // the cabinet's marquee
    await desk.unmount()
  })

  test('Cancel in the panel saves nothing', async ($, on) => {
    mock.clock(on)
    const store = host(on)
    await $.command.run({ command: NAME, args: '' } as never)
    const ui = await $.ui.mount({ plugin: 'office-space', surface: 'terminal', component: 'Pane', requestId: 'office-space', props: PANE_PROPS } as never)
    await ui.press({ key: 'office-what-wall' } as never)
    await ui.press({ key: 'office-wall-teal' } as never)
    await ui.press({ key: 'office-cancel' } as never)
    expect(store.officeLook).toBeUndefined()
    expect(await ui.find({ key: 'office-what-wall' } as never)).toBeUndefined()
    await ui.unmount()
  })

  test('Other in the panel goes through one validated model call', async ($, on) => {
    mock.clock(on)
    host(on)
    const calls: any[] = []
    on('model.complete', async (_$: any, e: any) => { calls.push(e); return { value: { isAnswered: true, text: '{"wall":"lavender"}', usage: { input_tokens: 1, output_tokens: 1 } } } as never })
    await $.command.run({ command: NAME, args: '' } as never)
    const ui = await $.ui.mount({ plugin: 'office-space', surface: 'desktop', component: 'Pane', requestId: 'office-space', props: PANE_PROPS } as never)
    await ui.input({ key: 'office-other-what', text: 'purple-ish walls please', kind: 'submit' } as never)
    expect(calls).toHaveLength(1)
    expect(calls[0].model).toBe('haiku')
    expect(await ui.find({ type: 'Text', text: /wall color: Slate blue -> Lavender/ })).toBeDefined()
    await ui.unmount()
  })

  test('words: one small model call, shown in the panel for confirmation, never reaching the chat', async ($, on) => {
    mock.clock(on)
    const store = host(on)
    const calls: any[] = []
    let fellThrough = 0
    on('prompt.submit', async (_$: any, e: any) => { fellThrough++; return e })
    on('model.complete', async (_$: any, e: any) => {
      calls.push(e)
      return { value: { isAnswered: true, text: '{"wall":"teal","add":[{"item":"vending-machine"}]}', usage: { input_tokens: 1, output_tokens: 1 } } } as never
    })
    const res = text(await $.command.run({ command: NAME, args: 'teal walls and a vending machine' } as never))
    expect(res).toContain('Office Space panel')
    expect(calls).toHaveLength(1)
    expect(calls[0].prompt).toContain('teal walls and a vending machine')
    expect(fellThrough).toBe(0)
    const ui = await $.ui.mount({ plugin: 'office-space', surface: 'desktop', component: 'Pane', requestId: 'office-space', props: PANE_PROPS } as never)
    expect(await ui.find({ type: 'Text', text: /add a vending machine in the break area/ })).toBeDefined()
    expect(store.officeLook).toBeUndefined()
    await ui.press({ key: 'office-apply' } as never)
    expect(store.officeLook).toEqual({ wall: 'teal', floor: 'slate-tiles', items: { break: 'vending-machine' } })
    await ui.unmount()
  })

  test('commands that need no AI never call the model and never fall through to the chat', async ($, on) => {
    mock.clock(on)
    const store = host(on, { officeLook: { wall: 'rose', floor: 'slate-tiles', items: { 'bottom-1': 'couch' } } })
    let sawModel = 0
    let fellThrough = 0
    on('model.complete', async () => { sawModel++; return { value: { isAnswered: false, reason: 'aborted' } } as never })
    on('prompt.submit', async (_$: any, e: any) => { fellThrough++; return e })
    expect(text(await $.command.run({ command: NAME, args: 'list' } as never))).toContain('rose')
    expect(text(await $.command.run({ command: NAME, args: 'help' } as never))).toContain('plan usage')
    expect(text(await $.command.run({ command: NAME, args: 'reset' } as never))).toContain('plain')
    expect(store.officeLook).toBeNull()
    expect(sawModel).toBe(0)
    expect(fellThrough).toBe(0)
  })

  test('AI unavailable in the engine: one friendly line, nothing saved', async ($, on) => {
    mock.clock(on)
    const store = host(on)
    on('model.complete', async () => ({ value: { isAnswered: false, reason: 'aborted' } }) as never)
    const res = text(await $.command.run({ command: NAME, args: 'teal walls' } as never))
    expect(res).toContain('nothing changed')
    expect(store.officeLook).toBeUndefined()
  })

  test('the saved office is used when the module loads, and reset clears it', async ($, on) => {
    mock.clock(on)
    const store = host(on, { officeLook: { wall: 'teal', floor: 'slate-tiles', items: { break: 'vending-machine', 'bottom-1': 'couch' } } })
    const res = text(await $.command.run({ command: NAME, args: 'remove couch' } as never))
    expect(res).toContain('Office Space panel')
    const ui = await $.ui.mount({ plugin: 'office-space', surface: 'terminal', component: 'Pane', requestId: 'office-space', props: PANE_PROPS } as never)
    expect(await ui.find({ type: 'Text', text: /remove the couch from the bottom wall, far left/ })).toBeDefined()
    await ui.unmount()
    expect(text(await $.command.run({ command: NAME, args: 'reset' } as never))).toContain('plain')
    expect(store.officeLook).toBeNull()
  })

  test('starting the Boss command replaces an open office step, and both draw through the one view', async ($, on) => {
    mock.clock(on)
    host(on)
    await $.command.run({ command: NAME, args: '' } as never)
    await $.command.run({ command: 'office-space-boss', args: '' } as never)
    const ui = await $.ui.mount({ plugin: 'office-space', surface: 'terminal', component: 'Pane', requestId: 'office-space', props: PANE_PROPS } as never)
    expect(await ui.find({ type: 'Text', text: /Which hair style for the Boss\?/ })).toBeDefined()
    expect(await ui.find({ key: 'office-what-wall' } as never)).toBeUndefined()
    await ui.unmount()
  })
})

describe('the featured options are real', () => {
  test('every featured id exists', () => {
    for (const id of FEATURED.furniture) expect(itemOf(id)).toBeDefined()
    for (const id of FEATURED.wall) expect(WALLS.some((w) => w.id === id)).toBe(true)
    for (const id of FEATURED.floor) expect(FLOORS.some((f) => f.id === id)).toBe(true)
  })
})
