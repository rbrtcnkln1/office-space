import { describe, expect, mock, test } from 'claude-code/testing'

import { alertText, newlyNeeding, parseUrl, parseWorker, toAgents } from '../hooks/external'
import type { ExternalWorker } from '../hooks/external'
import type { AgentLike } from '../hooks/office'

const MIN = 60_000
const NOW = Date.parse('2026-10-08T12:00:00Z')
const worker = (over: Partial<ExternalWorker> = {}): ExternalWorker => ({
  id: 'w1', name: 'Worker', status: 'working', task: 'Doing a thing', updated: NOW, source: 'remote', ...over,
})

describe('worker url', () => {
  test('only http and https addresses are kept', async () => {
    expect(parseUrl('https://example.com/job/42?x=1#top')).toBe('https://example.com/job/42?x=1#top')
    expect(parseUrl('  http://localhost:8080/a ')).toBe('http://localhost:8080/a')
    for (const bad of [
      'javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'ftp://host/x', 'vscode://x', '//example.com', 'example.com',
      'https://', 'https:///nohost', 'http://exa mple.com', 'https://a.com/‮bad', 'https://a.com/\nb', 'https://a.com/' + 'x'.repeat(400),
      '', '   ', 5, null, undefined, {}, ['https://a.com'], true,
    ]) expect(parseUrl(bad)).toBeUndefined()
  })
  test('parseWorker keeps a good url, drops a bad one but keeps the worker', async () => {
    expect(parseWorker('{"status":"blocked","url":"https://ci.example.com/run/7"}', 'w.json', NOW)?.url).toBe('https://ci.example.com/run/7')
    const w = parseWorker('{"status":"blocked","url":"javascript:alert(1)","note":"Approve"}', 'w.json', NOW)
    expect(w?.url).toBeUndefined()
    expect(w?.note).toBe('Approve')
    expect(parseWorker('{"status":"blocked","url":42}', 'w.json', NOW)?.status).toBe('blocked')
  })
  test('toAgents carries note and url to the office', async () => {
    const [a] = toAgents([worker({ status: 'blocked', note: 'Approve', url: 'https://x.test/a' })], NOW)
    expect(a?.remote).toMatchObject({ need: 'blocked', note: 'Approve', url: 'https://x.test/a' })
  })
})

describe('newlyNeeding', () => {
  const agent = (id: string, status: ExternalWorker['status'], over: Partial<ExternalWorker> = {}) => toAgents([worker({ id, status, ...over })], NOW)[0] as AgentLike
  test('announces a worker that starts needing you, once per stint', async () => {
    let known = new Set<string>()
    let r = newlyNeeding(known, [agent('a', 'working')], false)
    expect(r.fresh).toEqual([])
    known = r.known
    r = newlyNeeding(known, [agent('a', 'blocked')], false)
    expect(r.fresh.map(a => a.id)).toEqual(['ext:a'])
    known = r.known
    // still blocked, then waiting instead of blocked: same stint, no repeat
    expect(newlyNeeding(known, [agent('a', 'blocked')], false).fresh).toEqual([])
    expect(newlyNeeding(known, [agent('a', 'waiting')], false).fresh).toEqual([])
    // it recovers, then needs you again: a new stint
    known = newlyNeeding(known, [agent('a', 'working')], false).known
    expect(newlyNeeding(known, [agent('a', 'blocked')], false).fresh.map(a => a.id)).toEqual(['ext:a'])
  })
  test('the first look after startup records but does not announce', async () => {
    const first = newlyNeeding(new Set(), [agent('a', 'blocked'), agent('b', 'waiting')], true)
    expect(first.fresh).toEqual([])
    expect([...first.known].sort()).toEqual(['ext:a', 'ext:b'])
    expect(newlyNeeding(first.known, [agent('a', 'blocked'), agent('b', 'waiting')], false).fresh).toEqual([])
    // a worker that shows up already blocked after startup is news
    expect(newlyNeeding(first.known, [agent('a', 'blocked'), agent('c', 'blocked')], false).fresh.map(a => a.id)).toEqual(['ext:c'])
  })
  test('a stale worker is not a stint, and a worker that leaves ends its stint', async () => {
    const stale = toAgents([worker({ id: 's', status: 'blocked', updated: NOW - 20 * MIN })], NOW)[0] as AgentLike
    expect(stale.remote?.stale).toBe(true)
    expect(newlyNeeding(new Set(), [stale], false).fresh).toEqual([])
    const known = newlyNeeding(new Set(), [agent('a', 'blocked')], false).known
    expect(newlyNeeding(known, [], false).known.size).toBe(0)
  })
  test('alertText names one worker or counts several, and stays short', async () => {
    expect(alertText([agent('a', 'blocked', { name: 'Backup bot', note: 'Disk full' })])).toBe('Office Space: Backup bot is blocked - Disk full')
    expect(alertText([agent('a', 'waiting', { name: 'Deploy', task: 'Ship it' })])).toBe('Office Space: Deploy is waiting - Ship it')
    const many = alertText(['a', 'b', 'c', 'd'].map(i => agent(i, 'blocked', { name: `Job ${i}` })))
    expect(many).toBe('Office Space: 4 workers need you: Job a, Job b, Job c, ...')
    expect(alertText([agent('a', 'blocked', { note: 'x'.repeat(120), name: 'N'.repeat(40) })]).length).toBeLessThanOrEqual(160)
    expect(alertText([])).toBe('')
  })
})

// ----- pressing a waiting/blocked worker, end to end through the plugin -----

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

const iso = () => new Date().toISOString()

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: pressing a blocked worker shows its note and url as text; pressing again hides it`, async ($, on) => {
    mock.clock(on)
    feed(on, {
      'ci.json': JSON.stringify({ id: 'ci', name: 'CI bot', status: 'blocked', task: 'Deploy', updated: iso(), source: 'ci', note: 'Approve the release', url: 'https://ci.example.com/run/7' }),
      'ok.json': JSON.stringify({ id: 'ok', name: 'Fine', status: 'working', task: 'Busy', updated: iso(), source: 'ci' }),
    })
    await $.command.run({ command: 'office-space', args: 'band' } as never)
    const ui = await $.ui.mount({ plugin: 'office-space', surface, ...BAND } as never)
    expect(await ui.find({ type: 'Button', key: 'need:ext:ok' } as never)).toBeUndefined() // only workers that need you
    expect(await ui.find({ type: 'Button', key: 'need:ext:ci' } as never)).toBeDefined()
    await ui.press({ key: 'need:ext:ci' } as never)
    expect(await ui.find({ type: 'Text', text: /CI bot \[ci\] is blocked/ } as never)).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'https://ci.example.com/run/7' } as never)).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'need-copy' } as never)).toBeDefined()
    await ui.press({ key: 'need:ext:ci' } as never)
    expect(await ui.find({ type: 'Text', text: /is blocked/ } as never)).toBeUndefined()
    await ui.unmount()
  })
}

test('a worker with no note or a bad url still opens, with a fallback line and no link', async ($, on) => {
  mock.clock(on)
  feed(on, { 'w.json': JSON.stringify({ id: 'w', name: 'Bare', status: 'waiting', task: 'Wait for me', updated: iso(), url: 'javascript:alert(1)' }) })
  await $.command.run({ command: 'office-space', args: 'band' } as never)
  const ui = await $.ui.mount({ plugin: 'office-space', surface: 'terminal', ...BAND } as never)
  await ui.press({ key: 'need:ext:w' } as never)
  expect(await ui.find({ type: 'Text', text: /No note left. Task: Wait for me/ } as never)).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /javascript/ } as never)).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'need-copy' } as never)).toBeUndefined()
  await ui.unmount()
})

test('no worker needs you: no extra rows', async ($, on) => {
  mock.clock(on)
  feed(on, { 'ok.json': JSON.stringify({ id: 'ok', status: 'working', task: 'Busy', updated: iso() }) })
  await $.command.run({ command: 'office-space', args: 'band' } as never)
  const ui = await $.ui.mount({ plugin: 'office-space', surface: 'terminal', ...BAND } as never)
  expect(await ui.find({ type: 'Text', text: /press one to read/ } as never)).toBeUndefined()
  await ui.unmount()
})
