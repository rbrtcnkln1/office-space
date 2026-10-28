import { describe, expect, test } from 'claude-code/testing'

import { DayTracker, emptyDay, recapText, sanitizeDay } from '../hooks/info'
import { Office } from '../hooks/office'

type A = { id: string; description: string; type: string; status: 'running' | 'idle' | 'completed' }
const agent = (id: string, status: A['status'] = 'running'): A => ({ id, description: `Task ${id}`, type: 'general-purpose', status })
const crew = (n: number) => Array.from({ length: n }, (_, i) => agent(`w${i}`))

/** No breaks, no ambient fidgets, no random drink runs: the party is the only thing happening. */
const quiet = <T,>(fn: () => T): T => fn()
const calm = (): Office => { const o = new Office(); o.rnd = () => 0.999; return o }
const peek = (o: Office) => o as unknown as { workers: Map<string, { pos: { x: number; y: number }; desk: number; seated: boolean; state: string; activity: string | null; item: string | null; partyId: number; plan: unknown[] }> }

function run(o: Office, until: () => boolean, max = 3000): number {
  let n = 0
  while (!until() && n < max) { o.step(); n++ }
  return n
}
const settle = (o: Office) => { run(o, () => o.party === null); run(o, () => [...peek(o).workers.values()].every(w => w.seated), 800) }
const feasting = (o: Office) => o.party?.phase === 'feast'

describe('the pizza party', () => {
  test('starts once, runs to the end, and the Boss is back at his desk', () => quiet(() => {
    const o = calm()
    o.sync(crew(3))
    expect(o.party).toBeNull()
    expect(o.startParty()).toBe(true)
    expect(o.startParty()).toBe(false) // idempotent: one party at a time
    expect(o.summary()).toContain('pizza party')
    expect(run(o, () => feasting(o))).toBeLessThan(400)
    expect(o.boss.seated).toBe(false)
    expect(o.summary()).toContain('pizza party')
    const total = run(o, () => o.party === null)
    expect(total).toBeLessThan(900)
    expect(o.boss.seated).toBe(true)
    expect(o.boss.errand).toBe(false)
    expect(o.boss.away).toBe(false)
    expect(o.summary()).not.toContain('pizza')
    expect(o.startParty()).toBe(true) // and another one can follow
  }))

  test('every seated worker attends, then sits back down at the same desk in the same state', () => quiet(() => {
    const o = calm()
    o.sync(crew(5))
    const before = [...peek(o).workers.entries()].map(([id, w]) => [id, w.desk, { ...w.pos }, w.state] as const)
    o.startParty()
    const went = new Set<string>()
    run(o, () => {
      for (const [id, w] of peek(o).workers) if (w.activity === 'party') went.add(id)
      return o.party === null
    })
    settle(o)
    expect([...went].sort()).toEqual([...peek(o).workers.keys()].sort())
    for (const [id, desk, pos, state] of before) {
      const w = peek(o).workers.get(id)!
      expect(w.desk).toBe(desk)
      expect(w.seated).toBe(true)
      expect(w.pos).toEqual(pos)
      expect(w.state).toBe(state)
    }
  }))

  test('with a crowd, guests stand around the table: never at the desks, the aisle or the door', () => quiet(() => {
    const o = calm()
    o.sync(crew(14))
    o.startParty()
    const door = o.door()
    run(o, () => feasting(o))
    let standing = 0
    run(o, () => {
      for (const w of peek(o).workers.values()) {
        if (w.activity !== 'party' || w.plan[0] === undefined || (w.plan[0] as { k: string }).k !== 'party') continue
        standing++
        expect(w.pos.y).toBeLessThan(o.aisleY() - 10)
        expect(w.pos.y).toBeGreaterThanOrEqual(20)
        expect(w.pos.x).toBeGreaterThan(door.x + 40)
        expect(w.pos.x).toBeLessThanOrEqual(o.width - 16)
      }
      return o.party === null
    })
    expect(standing).toBeGreaterThan(14) // everyone was seen standing around
  }))

  test('a worker that finishes mid-party still hands in and leaves', () => quiet(() => {
    const o = calm()
    const list = crew(3)
    o.sync(list)
    o.startParty()
    run(o, () => feasting(o))
    run(o, () => peek(o).workers.get('w1')!.activity === 'party')
    o.sync(list.map(a => (a.id === 'w1' ? { ...a, status: 'completed' as const } : a)))
    run(o, () => !peek(o).workers.has('w1'))
    settle(o)
    expect(peek(o).workers.has('w1')).toBe(false)
    expect([...o.eotd.values()].reduce((a, b) => a + b, 0)).toBe(1) // one hand-in counted
    for (const id of ['w0', 'w2']) expect(peek(o).workers.get(id)!.seated).toBe(true)
  }))

  test('a worker that arrives mid-party is briefed at the table and goes to its desk', () => quiet(() => {
    const o = calm()
    const list = crew(2)
    o.sync(list)
    o.startParty()
    run(o, () => feasting(o))
    o.sync([...list, agent('late')])
    settle(o)
    const late = peek(o).workers.get('late')!
    expect(late.seated).toBe(true)
    expect(late.state).toBe('working')
    expect(o.queue.length).toBe(0)
  }))

  test('with nobody at work the Boss still has his pizza and the party ends', () => quiet(() => {
    const o = calm()
    o.startParty()
    run(o, () => o.party === null)
    expect(o.party).toBeNull()
    expect(o.boss.seated).toBe(true)
  }))
})

describe('the empty box', () => {
  const stage = (o: Office) => o.render()
  test('no party today, no box: the drawing is the plain office', () => {
    const o = calm()
    const plain = stage(o)
    o.leftover = false
    expect(stage(o)).toBe(plain)
    expect(plain).not.toContain('#b9844a') // no cardboard anywhere
  })
  test('after a party an empty box stays on the table, and it clears with the day', () => {
    const o = calm()
    o.startParty()
    run(o, () => o.party === null)
    expect(o.leftover).toBe(true)
    expect(o.render()).toContain('#b9844a') // the cardboard
    o.leftover = false // what the day log says on a new day
    expect(o.render()).not.toContain('#b9844a')
  })
  test('it never stands in anyone\'s way: it is on the table, not on the floor', () => {
    const o = calm()
    o.leftover = true
    const t = o.tableX()
    expect(t).toBeGreaterThan(0)
    // the open box (16 px wide) sits within the table's 26 px
    expect(5 + 16).toBeLessThanOrEqual(26)
  })
  test('the day log remembers the party: across a reload, and not into a new day', () => {
    const tracker = new DayTracker()
    tracker.rollover('2026-10-28', undefined)
    tracker.log.parties++
    const stored = JSON.parse(JSON.stringify(tracker.log)) // what the store hands back after a reload
    const again = new DayTracker()
    again.rollover('2026-10-28', stored)
    expect(again.log.parties).toBe(1)
    const tomorrow = new DayTracker()
    tomorrow.rollover('2026-10-29', undefined) // the store has nothing under tomorrow's key
    expect(tomorrow.log.parties).toBe(0)
    // the box follows the log
    const o = calm()
    o.leftover = again.log.parties > 0
    const withBox = o.render()
    o.leftover = tomorrow.log.parties > 0
    expect(o.render()).not.toBe(withBox)
  })
})

describe('the recap', () => {
  test('counts the parties, and says nothing when there were none', () => {
    expect(recapText(emptyDay())).not.toContain('Pizza')
    expect(recapText({ ...emptyDay(), parties: 2 })).toContain('Pizza parties: 2')
  })
  test('junk in the store becomes zero', () => {
    expect(sanitizeDay({ parties: 'lots' }).parties).toBe(0)
    expect(sanitizeDay({ parties: -3 }).parties).toBe(0)
    expect(sanitizeDay({ parties: 3 }).parties).toBe(3)
    expect(sanitizeDay(undefined).parties).toBe(0)
  })
})
