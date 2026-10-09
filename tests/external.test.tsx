import { describe, expect, mock, test } from 'claude-code/testing'

import { expandDir, isWorkerFile, parseWorker, toAgents } from '../hooks/external'
import type { ExternalWorker } from '../hooks/external'

const MIN = 60_000
const NOW = Date.parse('2026-10-08T12:00:00Z')
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString()
const worker = (over: Partial<ExternalWorker> = {}): ExternalWorker => ({
  id: 'w1', name: 'Worker', status: 'working', task: 'Doing a thing', updated: NOW, source: 'remote', ...over,
})

describe('parseWorker', () => {
  test('reads a full worker file', async () => {
    const w = parseWorker(JSON.stringify({
      id: 'backup', name: 'Backup bot', status: 'blocked', task: 'Copy photos', updated: iso(2 * MIN), source: 'cron', note: 'Disk full',
    }), 'backup.json')
    expect(w).toEqual({ id: 'backup', name: 'Backup bot', status: 'blocked', task: 'Copy photos', updated: NOW - 2 * MIN, source: 'cron', note: 'Disk full' })
  })

  test('only status is required: id from the file name, updated from mtime', async () => {
    const w = parseWorker('{"status":"WORKING"}', 'nightly-report.json', NOW)
    expect(w?.id).toBe('nightly-report')
    expect(w?.name).toBe('nightly-report')
    expect(w?.status).toBe('working')
    expect(w?.source).toBe('remote')
    expect(w?.updated).toBe(NOW)
    expect(w?.note).toBeUndefined()
  })

  test('malformed input is null, never a throw', async () => {
    const bad = [
      '', 'not json', '{"status":"working"', 'null', '42', '"working"', '[{"status":"working"}]',
      '{}', '{"status":"sleeping"}', '{"status":7}', '{"status":null}', '{"status":{"x":1}}',
      '{"status":"working","updated":"not a date"}', // and no mtime to fall back on
    ]
    for (const text of bad) expect(parseWorker(text, 'x.json')).toBeNull()
  })

  test('wrong-typed fields fall back instead of failing', async () => {
    const w = parseWorker(JSON.stringify({ id: ['nope'], name: { a: 1 }, status: 'done', task: 12, updated: 'garbage', source: false }), 'odd.json', NOW)
    expect(w).toEqual({ id: 'odd', name: 'odd', status: 'done', task: '12', updated: NOW, source: 'remote' })
  })

  test('long and control-character text is cut and cleaned', async () => {
    const w = parseWorker(JSON.stringify({ status: 'working', task: 'a\nb\u0007c' + 'x'.repeat(500), source: 'a-very-long-source-label' }), 'l.json', NOW)
    expect(w?.task.startsWith('a b c')).toBe(true)
    expect(w?.task.length).toBe(120)
    expect(w?.source.length).toBe(16)
  })

  test('numeric epoch-ms timestamps are accepted', async () => {
    expect(parseWorker(`{"status":"working","updated":${NOW}}`, 'n.json')?.updated).toBe(NOW)
  })
})

describe('toAgents', () => {
  test('maps statuses and flags the ones that need a human', async () => {
    const rows = toAgents([
      worker({ id: 'a', status: 'working' }), worker({ id: 'b', status: 'waiting', note: 'Approve deploy' }),
      worker({ id: 'c', status: 'blocked' }), worker({ id: 'd', status: 'done' }), worker({ id: 'e', status: 'failed' }),
    ], NOW)
    const by = Object.fromEntries(rows.map(r => [r.id, r]))
    expect(by['ext:a']?.status).toBe('running')
    expect(by['ext:a']?.remote?.need).toBeNull()
    expect(by['ext:b']?.status).toBe('waiting')
    expect(by['ext:b']?.remote?.need).toBe('waiting')
    expect(by['ext:b']?.remote?.note).toBe('Approve deploy')
    expect(by['ext:c']?.remote?.need).toBe('blocked')
    expect(by['ext:d']?.status).toBe('completed')
    expect(by['ext:e']?.status).toBe('failed')
    expect(rows.every(r => r.type === 'remote')).toBe(true)
  })

  test('staleness: fresh, faded after 15 min, gone after 4x that', async () => {
    const rows = toAgents([
      worker({ id: 'fresh', updated: NOW - 14 * MIN }),
      worker({ id: 'stale', updated: NOW - 16 * MIN }),
      worker({ id: 'gone', updated: NOW - 61 * MIN }),
      worker({ id: 'future', updated: NOW + 5 * MIN }), // clock skew: treated as fresh
    ], NOW)
    const by = Object.fromEntries(rows.map(r => [r.id, r]))
    expect(by['ext:fresh']?.remote?.stale).toBe(false)
    expect(by['ext:stale']?.remote?.stale).toBe(true)
    expect(by['ext:stale']?.remote?.ageMin).toBe(16)
    expect(by['ext:gone']).toBeUndefined()
    expect(by['ext:future']?.remote?.stale).toBe(false)
  })

  test('staleness is configurable', async () => {
    const rows = toAgents([worker({ updated: NOW - 3 * MIN })], NOW, 2)
    expect(rows[0]?.remote?.stale).toBe(true)
    expect(toAgents([worker({ updated: NOW - 9 * MIN })], NOW, 2)).toEqual([])
  })

  test('a duplicated id keeps the newest entry', async () => {
    const rows = toAgents([worker({ task: 'old', updated: NOW - 5 * MIN }), worker({ task: 'new', updated: NOW - MIN })], NOW)
    expect(rows.length).toBe(1)
    expect(rows[0]?.description).toBe('new')
  })
})

test('expandDir and isWorkerFile', async () => {
  expect(expandDir('~/.claude/office-space/workers/', '/home/me')).toBe('/home/me/.claude/office-space/workers')
  expect(expandDir('', '/home/me')).toBe('/home/me/.claude/office-space/workers')
  expect(expandDir('/srv/status', '/home/me')).toBe('/srv/status')
  expect(isWorkerFile('a.json')).toBe(true)
  expect(isWorkerFile('.a.json.tmp')).toBe(false)
  expect(isWorkerFile('.a.json')).toBe(false)
  expect(isWorkerFile('notes.txt')).toBe(false)
})

// ----- end to end through the plugin: a folder with good and bad files -----

const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100 } } as const
const DIR = '/home/me/.claude/office-space/workers'

function feed(on: any, files: Record<string, string>) {
  on('env.get', async (_$: any, e: any) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }) as never)
  on('agent.list', async () => ({ value: [] }) as never)
  on('fs.list', async (_$: any, e: any) => {
    if (e.path !== DIR) throw new Error('ENOENT')
    return { value: Object.entries(files).map(([name, t]) => ({ name, kind: 'file', size: t.length, mtimeMs: 1, isLink: false })) } as never
  })
  on('fs.read', async (_$: any, e: any) => {
    const name = String(e.path).split('/').pop() as string
    if (!(name in files)) throw new Error('ENOENT')
    return { value: files[name] } as never
  })
}

test('external workers show up, malformed files are skipped, blocked ones ask for you', async ($, on) => {
  mock.clock(on)
  const now = new Date().toISOString()
  feed(on, {
    'backup.json': JSON.stringify({ id: 'backup', name: 'Backup bot', status: 'blocked', task: 'Copy photos', updated: now, source: 'cron', note: 'Disk full' }),
    'build.json': JSON.stringify({ status: 'working', task: 'Nightly build', updated: now, source: 'laptop' }),
    'broken.json': '{ this is not json',
    'weird.json': '{"status":"sleeping"}',
    '.partial.json': '{"status":"working"',
    'readme.txt': 'hello',
  })
  await $.command.run({ command: 'office-space', args: 'band' } as never)
  const term = await $.ui.mount({ plugin: 'office-space', surface: 'terminal', ...BAND } as never)
  expect(await term.find({ type: 'Text', text: /\[cron\] Copy photos — BLOCKED: Disk full/ })).toBeDefined()
  expect(await term.find({ type: 'Text', text: /\[laptop\] Nightly build/ })).toBeDefined()
  expect(await term.find({ type: 'Text', text: /1 needs you/ })).toBeDefined()
  expect(await term.find({ type: 'Text', text: /sleeping|this is not/ })).toBeUndefined()
  await term.unmount()
  const desk = await $.ui.mount({ plugin: 'office-space', surface: 'desktop', ...BAND } as never)
  expect(await desk.find({ type: 'Svg' } as never)).toBeDefined()
  await desk.unmount()
})

test('a missing workers folder is just an empty office', async ($, on) => {
  mock.clock(on)
  on('env.get', async (_$: any, e: any) => ({ value: e.name === 'HOME' ? '/nowhere' : undefined }) as never)
  on('agent.list', async () => ({ value: [] }) as never)
  on('fs.list', async () => { throw new Error('ENOENT') })
  await $.command.run({ command: 'office-space', args: 'band' } as never)
  const term = await $.ui.mount({ plugin: 'office-space', surface: 'terminal', ...BAND } as never)
  expect(await term.find({ type: 'Text', text: /no one at work/ })).toBeDefined()
  await term.unmount()
})

test('OFFICE_SPACE_WORKERS_DIR overrides the folder', async ($, on) => {
  mock.clock(on)
  on('env.get', async (_$: any, e: any) => ({ value: e.name === 'OFFICE_SPACE_WORKERS_DIR' ? '/srv/status' : '/home/me' }) as never)
  on('agent.list', async () => ({ value: [] }) as never)
  on('fs.list', async (_$: any, e: any) => {
    if (e.path !== '/srv/status') throw new Error('ENOENT')
    return { value: [{ name: 'job.json', kind: 'file', size: 10, mtimeMs: 1, isLink: false }] } as never
  })
  on('fs.read', async () => ({ value: JSON.stringify({ status: 'working', task: 'Elsewhere', updated: new Date().toISOString() }) }) as never)
  await $.command.run({ command: 'office-space', args: 'band' } as never)
  const term = await $.ui.mount({ plugin: 'office-space', surface: 'terminal', ...BAND } as never)
  expect(await term.find({ type: 'Text', text: /\[remote\] Elsewhere/ })).toBeDefined()
  await term.unmount()
})
