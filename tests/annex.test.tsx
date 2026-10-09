import { describe, expect, mock, test } from 'claude-code/testing'

import { Office } from '../hooks/office'
import type { AgentLike } from '../hooks/office'

const local = (id: string): AgentLike => ({ id, description: `Local job ${id}`, type: 'general-purpose', status: 'running' })
const remote = (id: string, status: AgentLike['status'] = 'running'): AgentLike => ({
  id: `ext:${id}`, name: id, description: `Remote job ${id}`, type: 'remote', status, remote: { source: 'cron', need: null, stale: false, ageMin: 0 },
})

/** An office that has opened, then seen `agents`, with everyone walked to their desk. */
function seated(agents: AgentLike[]): Office {
  const o = new Office()
  o.sync([]) // the office is open before anyone arrives
  o.sync(agents)
  settle(o)
  return o
}
function settle(o: Office, ticks = 1500) {
  for (let i = 0; i < ticks; i++) o.step()
}

describe('remote annex', () => {
  test('no external workers: no annex, the layout is the one it always was', () => {
    const o = seated([local('a'), local('b'), local('c')])
    expect(o.annex.length).toBe(0)
    expect(o.annexRows).toBe(0)
    expect(o.desks.length).toBe(5)
    expect(o.height).toBe(o.rowY(o.rows - 1) + 46)
    expect(o.render()).not.toContain('REMOTE ANNEX')
  })

  test('an external worker sits in the annex, local agents keep the main floor', () => {
    const o = seated([local('a'), remote('r1')])
    expect(o.workers.get('a')?.desk).toBeLessThan(1000)
    expect(o.workers.get('ext:r1')?.desk).toBeGreaterThanOrEqual(1000)
    expect(o.desks.includes('ext:r1')).toBe(false)
    expect(o.annex.includes('ext:r1')).toBe(true)
    expect(o.annexRows).toBe(1)
    expect(o.render()).toContain('REMOTE ANNEX')
  })

  test('the local floor does not change when remote workers come and go', () => {
    const base = seated([local('a'), local('b')])
    const mixed = seated([local('a'), local('b'), remote('r1'), remote('r2')])
    expect(mixed.desks.length).toBe(base.desks.length)
    expect(mixed.cols).toBe(base.cols)
    expect(mixed.width).toBe(base.width)
    expect(mixed.height).toBeGreaterThan(base.height) // only taller, by the annex
  })

  test('zero, few and many remote workers all get their own seat, none overlap', () => {
    for (const n of [0, 1, 4, 5, 6, 13, 40]) {
      const o = seated(Array.from({ length: n }, (_, i) => remote(`r${i}`)))
      const slots = [...o.workers.values()].map(w => w.desk)
      expect(slots.every(s => s >= 1000)).toBe(true)
      expect(new Set(slots).size).toBe(n)
      expect(o.annex.length % o.cols).toBe(0)
      expect(o.annex.length).toBeGreaterThanOrEqual(n === 0 ? 0 : n + 1)
      expect(() => o.render()).not.toThrow()
    }
  })

  test('the annex shrinks away once the remote workers have left', () => {
    const o = seated([remote('r1'), remote('r2'), remote('r3')])
    expect(o.annex.length).toBe(5)
    o.sync([]) // their files are gone: they walk out
    settle(o, 800)
    expect(o.workers.size).toBe(0)
    expect(o.annex.length).toBe(0)
    expect(o.height).toBe(o.rowY(o.rows - 1) + 46)
  })

  test('never yanks a desk from under someone: the annex keeps a seated worker\'s row', () => {
    const many = Array.from({ length: 7 }, (_, i) => remote(`r${i}`))
    const o = seated(many)
    const last = o.workers.get('ext:r6')
    expect(last?.desk).toBe(1000 + 6)
    expect(o.annex.length).toBe(10)
    o.sync([many[6] as AgentLike]) // everyone but the one in the second row leaves
    for (let i = 0; i < 400; i++) {
      o.step()
      if (o.workers.get('ext:r6')) expect(o.annex[6]).toBe('ext:r6')
    }
    expect(o.workers.get('ext:r6')?.desk).toBe(1000 + 6)
    expect(o.annex.length).toBeGreaterThanOrEqual(7)
  })

  test('a worker that needs you is drawn in the annex too', () => {
    const o = seated([{ ...remote('r1', 'waiting'), remote: { source: 'cron', need: 'blocked', stale: false, ageMin: 0, note: 'Disk full' } }])
    expect(o.render()).toContain('Disk full')
    expect(o.needing().map(n => n.id)).toEqual(['ext:r1'])
  })
})

// ----- toasts when an external worker needs you -----

const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100 } } as const
const DIR = '/home/me/.claude/office-space/workers'

function feed(on: any, files: Record<string, string>, mtime: () => number) {
  on('env.get', async (_$: any, e: any) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }) as never)
  on('agent.list', async () => ({ value: [] }) as never)
  on('fs.list', async (_$: any, e: any) => {
    if (e.path !== DIR) throw new Error('ENOENT')
    return { value: Object.entries(files).map(([name, t]) => ({ name, kind: 'file', size: t.length, mtimeMs: mtime(), isLink: false })) } as never
  })
  on('fs.read', async (_$: any, e: any) => ({ value: files[String(e.path).split('/').pop() as string] }) as never)
}
const body = (status: string, extra: object = {}) => JSON.stringify({ id: 'job', name: 'Nightly job', status, task: 'Sync', updated: new Date().toISOString(), source: 'cron', note: 'Approve it', ...extra })

describe('blocked alerts', () => {
  test('toast once on the transition into blocked, never again while it holds', async ($, on) => {
    const clock = mock.clock(on)
    const toasts: string[] = []
    on('ui.toast', async (_$: any, e: any) => { toasts.push(String(e.text)); return { value: undefined } as never })
    let v = 1
    const files: Record<string, string> = { 'job.json': body('working') }
    feed(on, files, () => v)
    await $.command.run({ command: 'office-space', args: 'band' } as never)
    const ui = await $.ui.mount({ plugin: 'office-space', surface: 'terminal', ...BAND } as never)
    expect(toasts).toEqual([])
    files['job.json'] = body('blocked'); v++
    await clock.advance(6_000)
    expect(toasts.length).toBe(1)
    expect(toasts[0]).toContain('Nightly job is blocked - Approve it')
    // it keeps being blocked (and is rewritten, and flips to waiting): no more toasts
    files['job.json'] = body('blocked', { task: 'Sync again' }); v++
    await clock.advance(6_000)
    files['job.json'] = body('waiting'); v++
    await clock.advance(6_000)
    expect(toasts.length).toBe(1)
    // it recovers and blocks again: a second stint, a second toast
    files['job.json'] = body('working'); v++
    await clock.advance(6_000)
    files['job.json'] = body('blocked'); v++
    await clock.advance(6_000)
    expect(toasts.length).toBe(2)
    await ui.unmount()
  })

  test('a worker already blocked when the office opens is silent', async ($, on) => {
    const clock = mock.clock(on)
    const toasts: string[] = []
    on('ui.toast', async (_$: any, e: any) => { toasts.push(String(e.text)); return { value: undefined } as never })
    feed(on, { 'job.json': body('blocked') }, () => 1)
    await $.command.run({ command: 'office-space', args: 'band' } as never)
    const ui = await $.ui.mount({ plugin: 'office-space', surface: 'terminal', ...BAND } as never)
    await clock.advance(12_000)
    expect(toasts).toEqual([])
    await ui.unmount()
  })

  test('alertOnBlocked off: no toast at all', { options: { alertOnBlocked: false } }, async ($, on) => {
    const clock = mock.clock(on)
    const toasts: string[] = []
    on('ui.toast', async (_$: any, e: any) => { toasts.push(String(e.text)); return { value: undefined } as never })
    let v = 1
    const files: Record<string, string> = { 'job.json': body('working') }
    feed(on, files, () => v)
    await $.command.run({ command: 'office-space', args: 'band' } as never)
    const ui = await $.ui.mount({ plugin: 'office-space', surface: 'terminal', ...BAND } as never)
    files['job.json'] = body('blocked'); v++
    await clock.advance(6_000)
    expect(toasts).toEqual([])
    await ui.unmount()
  })
})
