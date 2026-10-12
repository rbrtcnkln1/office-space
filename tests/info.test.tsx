import { describe, expect, mock, test } from 'claude-code/testing'

import { DayTracker, activityDigest, emptyDay, parseSummaries, recapText, rosterPrompt, rosterText, sanitizeDay, workersReport } from '../hooks/info'
import type { FileInfo, RosterRow, WorkersInput } from '../hooks/info'
import { fmtSpan, hasAnyUsage, toBoard, usageText } from '../hooks/usage'
import { usageTray, usageWall } from '../hooks/usageart'
import { Office } from '../hooks/office'

const text = (r: unknown) => JSON.stringify(r)
const NOW = Date.parse('2026-10-11T15:00:00Z')
const MIN = 60_000

// ---------- roster ----------

const row = (over: Partial<RosterRow> = {}): RosterRow => ({ who: 'Explore', state: 'working', since: '4m on it', task: 'Map the hooks', activity: 'recent steps: Read a.ts', ...over })

describe('roster pieces', () => {
  test('activityDigest keeps the last steps and the last words, and never throws on junk', () => {
    const msgs = [
      { role: 'user', text: 'go', toolUses: [] },
      { role: 'assistant', text: 'Looking around', toolUses: [{ tool: 'Read', input: { file_path: 'src/a.ts' } }, { tool: 'Bash', input: { command: 'npm test' } }] },
    ]
    const d = activityDigest(msgs)
    expect(d).toContain('Read src/a.ts')
    expect(d).toContain('Bash npm test')
    expect(d).toContain('last said: Looking around')
    for (const junk of [undefined, null, 5, 'x', {}, [null, 3, 'a', { role: 'assistant', toolUses: 'no' }], { deny: 'no' }]) expect(() => activityDigest(junk)).not.toThrow()
    expect(activityDigest({ deny: 'x' })).toBe('')
  })

  test('activityDigest strips control characters', () => {
    expect(activityDigest([{ role: 'assistant', text: 'hi\u001b[31m there‮', toolUses: [] }])).not.toMatch(/[\u001b‮]/)
  })

  test('the prompt lists only workers that have activity; none means no prompt', () => {
    const p = rosterPrompt([row(), row({ activity: '' }), row({ task: 'Second', activity: 'recent steps: Bash ls' })])
    expect(p).toContain('1. task: Map the hooks')
    expect(p).not.toContain('2. task')
    expect(p).toContain('3. task: Second')
    expect(rosterPrompt([row({ activity: '' })])).toBeNull()
    expect(rosterPrompt([])).toBeNull()
  })

  test('parseSummaries accepts a clean object, fenced or chatty, and keys by worker number', () => {
    expect([...(parseSummaries('{"1": "Reading the hooks", "2": "Running the tests."}', 2) ?? [])]).toEqual([[1, 'Reading the hooks'], [2, 'Running the tests']])
    expect(parseSummaries('Sure!\n```json\n{"1":"Fixing a bug"}\n```', 1)?.get(1)).toBe('Fixing a bug')
  })

  test('parseSummaries rejects what it should: not JSON, wrong shape, bad keys, links, markup, long text', () => {
    for (const bad of ['', 'no json here', '{"1": ', '[1,2]', '"str"', '{"1": 5}', '{"0": "x", "9": "y"}', '{"x": "y"}', '{"1": ""}', null, undefined, 42]) {
      expect(parseSummaries(bad as never, 2)).toBeNull()
    }
    expect(parseSummaries('{"1": "see https://evil.example/x"}', 1)).toBeNull()
    expect(parseSummaries('{"1": "<b>bold</b>"}', 1)).toBeNull()
    expect(parseSummaries('{"1": "`rm -rf`"}', 1)).toBeNull()
    expect(parseSummaries(`{"1": "${'word '.repeat(30)}"}`, 1)).toBeNull()
    // a bad entry does not spoil a good one
    expect([...(parseSummaries('{"1": "ok text", "2": "http://x.y"}', 2) ?? [])]).toEqual([[1, 'ok text']])
  })

  test('rosterText shows AI lines, falls back to Task: per line, and says so', () => {
    const rows = [row(), row({ who: 'Backup bot [cron]', task: 'Copy photos', since: 'updated 2m ago' })]
    const ai = rosterText(rows, new Map([[1, 'Reading hooks']]), null)
    expect(ai).toContain('1. Explore - working, 4m on it')
    expect(ai).toContain('Reading hooks')
    expect(ai).toContain('Task: Copy photos')
    expect(ai).toContain('written by a small model')
    const off = rosterText(rows, null, 'AI summaries unavailable (offline)')
    expect(off).toContain('Task: Map the hooks')
    expect(off).toContain('AI summaries unavailable (offline)')
    expect(off).not.toContain('written by a small model')
    expect(rosterText([], null, null)).toContain('Nobody is at work')
  })
})

// ---------- recap ----------

const agent = (id: string, status: string, over: Record<string, unknown> = {}) => ({ id, description: `Task ${id}`, type: 'general-purpose', status, ...over })

describe('recap', () => {
  test('counts hand-ins and failures when a worker stops, once each', () => {
    const t = new DayTracker()
    t.rollover('d1', undefined)
    expect(t.observe([agent('a', 'running'), agent('b', 'running'), agent('c', 'running')])).toBe(false)
    expect(t.observe([agent('a', 'idle'), agent('b', 'failed'), agent('c', 'killed')])).toBe(true)
    expect(t.log.done).toBe(1)
    expect(t.log.failed).toBe(1)
    expect(t.log.failures[0]).toEqual({ who: 'Task b', task: 'Task b' })
    // staying in the final state does not count again
    expect(t.observe([agent('a', 'idle'), agent('b', 'failed')])).toBe(false)
    expect(t.log.done).toBe(1)
  })

  test('work that was already finished when first seen is not counted', () => {
    const t = new DayTracker()
    t.rollover('d1', undefined)
    expect(t.observe([agent('a', 'completed')])).toBe(false)
    expect(t.log.done).toBe(0)
  })

  test('an outside worker that needs a person is recorded once per stint', () => {
    const t = new DayTracker()
    t.rollover('d1', undefined)
    const w = (need: 'blocked' | null, extra = {}) => agent('ext:b', 'waiting', { name: 'Backup bot', description: 'Copy', type: 'remote', remote: { source: 'cron', need, stale: false, ageMin: 0, note: 'Disk full' }, ...extra })
    expect(t.observe([w(null)])).toBe(false)
    expect(t.observe([w('blocked')])).toBe(true)
    expect(t.observe([w('blocked')])).toBe(false)
    expect(t.log.needed).toBe(1)
    expect(t.log.needs[0]).toEqual({ who: 'Backup bot', note: 'Disk full' })
    expect(t.observe([w(null)])).toBe(false)
    expect(t.observe([w('blocked')])).toBe(true)
    expect(t.log.needed).toBe(2)
  })

  test('a new day starts empty; the same day keeps its tally', () => {
    const t = new DayTracker()
    t.rollover('d1', { done: 3 })
    expect(t.log.done).toBe(3)
    expect(t.rollover('d1', { done: 9 })).toBe(false)
    expect(t.log.done).toBe(3)
    expect(t.rollover('d2', undefined)).toBe(true)
    expect(t.log.done).toBe(0)
  })

  test('sanitizeDay survives anything the store might hold', () => {
    for (const junk of [undefined, null, 4, 'x', [], { done: 'many', failed: -1, byRole: { nope: 3, coder: 'x' }, failures: 'no', needs: [null, 7, { who: 1 }] }]) {
      const d = sanitizeDay(junk)
      expect(d.done).toBeGreaterThanOrEqual(0)
      expect(() => recapText(d)).not.toThrow()
    }
    expect(sanitizeDay({ byRole: { coder: 2, bogus: 5 } }).byRole).toEqual({ coder: 2 })
  })

  test('recapText reads well: empty, and with a busy day', () => {
    const empty = recapText(emptyDay())
    expect(empty).toContain('Handed in: 0')
    expect(empty).toContain('Failed: none')
    expect(empty).toContain('Employee of the Day: nobody yet')
    const log = sanitizeDay({ done: 5, failed: 1, needed: 1, byRole: { coder: 3, reviewer: 2 }, failures: [{ who: 'Tester', task: 'Verify login' }], needs: [{ who: 'Backup bot', note: 'Disk full' }] })
    const t = recapText(log)
    expect(t).toContain('Handed in: 5 (Coder 3, Reviewer 2)')
    expect(t).toContain('Tester - Verify login')
    expect(t).toContain('Backup bot: Disk full')
    expect(t).toContain('Employee of the Day: Coder (3 hand-ins)')
  })
})

// ---------- usage ----------

const FULL = {
  startedAt: 0,
  context: { tokens: 52000, window: 200000, percent: 26 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 32, resetsAt: new Date(NOW + (3 * 60 + 50) * MIN).toISOString() },
    { kind: 'seven_day', percentUsed: 19.5, resetsAt: new Date(NOW + 3 * 24 * 60 * MIN).toISOString() },
  ],
  cost: { usd: 1.234 },
}

describe('usage', () => {
  test('a full reading prints every figure with reset times', () => {
    const t = usageText(toBoard(FULL), NOW)
    expect(t).toContain('Context: 26% full (52k of 200k tokens)')
    expect(t).toContain('Session limit (5 hours): 32% used, resets in 3h 50m')
    expect(t).toContain('Weekly limit: 19.5% used, resets in 3d 0h')
    expect(t).toContain('Cost this session: $1.23')
  })

  test('missing fields are left out, not zeroed', () => {
    const ctxOnly = usageText(toBoard({ context: { window: 200000, tokens: 1000 } }), NOW)
    expect(ctxOnly).toContain('Context: 1% full')
    expect(ctxOnly).not.toContain('limit')
    expect(ctxOnly).not.toContain('Cost')
    const noPercent = toBoard({ context: { tokens: 50000, window: 200000 } })
    expect(noPercent?.ctxPct).toBe(25)
    const windowOnly = usageText(toBoard({ context: { window: 200000 } }), NOW)
    expect(windowOnly).toContain('no reply measured yet')
    const limitNoReset = usageText(toBoard({ rateLimits: [{ kind: 'five_hour', percentUsed: 10 }] }), NOW)
    expect(limitNoReset).toContain('Session limit (5 hours): 10% used')
    expect(limitNoReset).not.toContain('resets')
  })

  test('nothing at all says so plainly; junk never throws', () => {
    expect(usageText(toBoard({ rateLimits: [] }), NOW)).toContain('No usage figures yet')
    expect(usageText(null, NOW)).toContain('No usage figures yet')
    for (const junk of [undefined, 3, 'x', [], { context: 5, rateLimits: 'no', cost: [] }, { rateLimits: [null, 1, { kind: 3 }, { kind: 'five_hour', percentUsed: 'a' }] }, { context: { percent: NaN, window: 0 } }]) {
      expect(() => usageText(toBoard(junk), NOW)).not.toThrow()
    }
    expect(hasAnyUsage(toBoard({ cost: { usd: 0 } }))).toBe(true)
  })

  test('a passed reset time and unknown windows read sensibly', () => {
    const t = usageText(toBoard({ rateLimits: [{ kind: 'five_hour', percentUsed: 99, resetsAt: new Date(NOW - MIN).toISOString() }, { kind: 'seven_day_opus', percentUsed: 5 }] }), NOW)
    expect(t).toContain('reset time has passed')
    expect(t).toContain('Seven day opus limit: 5% used')
    expect(fmtSpan(30_000)).toBe('under a minute')
    expect(fmtSpan(45 * MIN)).toBe('45m')
  })

  test('the office draws the objects the host gave, and nothing for what it did not', () => {
    const o = new Office()
    const plain = o.render()
    expect(plain).not.toContain('WEEK')
    o.clockNow = NOW
    o.usage = toBoard(FULL)
    const svg = o.render()
    expect(svg).toContain('WEEK')
    expect(svg).toContain('32%')
    expect(svg).toContain('26%')
    o.usage = toBoard({ context: { percent: 40, window: 1, tokens: 1 } })
    const ctxOnly = o.render()
    expect(ctxOnly).toContain('40%')
    expect(ctxOnly).not.toContain('WEEK')
    o.usage = toBoard({})
    expect(() => o.render()).not.toThrow()
    expect(usageWall(null, 0, 0, NOW)).toBe('')
    expect(usageTray(null, 0, 0)).toBe('')
    expect(usageTray(toBoard({ cost: { usd: 1 } }), 0, 0)).toBe('')
    o.usage = null
    expect(o.render()).toBe(plain)
  })
})

// ---------- workers report ----------

const file = (name: string, text: string | null | undefined, over: Partial<FileInfo> = {}): FileInfo => ({
  name, kind: 'file', isLink: false, size: typeof text === 'string' ? text.length : 10, mtimeMs: NOW - MIN, text, ...over,
})
const input = (files: FileInfo[], over: Partial<WorkersInput> = {}): WorkersInput => ({
  dir: '/home/me/.claude/office-space/workers', dirSource: 'default', dirState: 'ok', files, notRead: 0, now: NOW, staleMinutes: 15, hiddenHere: new Set(), ...over,
})
const good = (id: string, over: Record<string, unknown> = {}) => JSON.stringify({ id, status: 'working', task: `Job ${id}`, source: 'cron', updated: new Date(NOW - 2 * MIN).toISOString(), ...over })

describe('workers report', () => {
  test('AE4: one valid file is listed, a typo in the status is skipped with its reason', () => {
    const r = workersReport(input([file('ok.json', good('ok')), file('typo.json', good('t', { status: 'workin' }))]))
    expect(r).toContain('1 worker in the office, 1 file skipped')
    expect(r).toContain('ok [cron] working - Job ok')
    expect(r).toContain('typo.json: unknown status "workin"')
  })

  test('every skip reason is plain and names the file', () => {
    const big = 'x'.repeat(70 * 1024)
    const r = workersReport(input([
      file('bad.json', '{ nope'),
      file('arr.json', '[1]'),
      file('nostatus.json', '{"id":"x"}'),
      file('scope.json', good('s', { scope: 'relative/path' })),
      file('big.json', big),
      file('link.json', good('l'), { isLink: true }),
      file('dir.json', undefined, { kind: 'directory' }),
      file('.tmp.json', good('h')),
      file('unread.json', null),
      file('ancient.json', good('old', { updated: new Date(NOW - 5 * 60 * MIN).toISOString() })),
      file('notes.txt', 'hello'),
    ]))
    for (const bit of ['bad.json: not valid JSON', 'arr.json: not a JSON object', 'nostatus.json: missing "status"', 'scope.json: bad "scope"', 'big.json: too big (70 KB', 'link.json: a symlink', 'dir.json: a folder', '.tmp.json: hidden file', 'unread.json: could not be read', 'ancient.json: too old', '1 other file in the folder ignored']) {
      expect(r).toContain(bit)
    }
    expect(r).toContain('0 workers in the office, 10 files skipped')
  })

  test('older duplicates, other-folder scopes and stale workers are explained', () => {
    const r = workersReport(input([
      file('new.json', good('dup', { updated: new Date(NOW - MIN).toISOString() }), { mtimeMs: NOW }),
      file('old.json', good('dup', { updated: new Date(NOW - 3 * MIN).toISOString() }), { mtimeMs: NOW - 3 * MIN }),
      file('elsewhere.json', good('far')),
      file('slow.json', good('slow', { updated: new Date(NOW - 20 * MIN).toISOString() })),
      file('wait.json', good('w', { status: 'blocked', note: 'Free some space' })),
    ], { hiddenHere: new Set(['far']) }))
    expect(r).toContain('old.json: an older copy of "dup"')
    expect(r).toContain('elsewhere.json: scoped to another folder')
    expect(r).toContain('faded (stale)')
    expect(r).toContain('BLOCKED: Free some space')
  })

  test('folder missing, unreadable, empty and unset are plain messages', () => {
    expect(workersReport(input([], { dirState: 'missing' }))).toContain('does not exist yet')
    expect(workersReport(input([], { dirState: 'error' }))).toContain('could not be read')
    expect(workersReport(input([]))).toContain('The folder is empty')
    expect(workersReport(input([file('a.txt', 'x')]))).toContain('No .json files')
    expect(workersReport(input([], { dirSource: 'environment' }))).toContain('OFFICE_SPACE_WORKERS_DIR')
    expect(workersReport(input([], { dirSource: 'setting' }))).toContain('setting')
    expect(workersReport(input([], { notRead: 7 }))).toContain('7 older files were not read')
  })

  test('hostile file names and contents never break the report', () => {
    const r = workersReport(input([file('‮bad\u0007.json', '{'), file('x.json', good('a', { name: 'Evil‮\u001b[2J', task: 'T\u0000' }))]))
    expect(r).not.toMatch(/[‮\u0007\u001b\u0000]/)
    expect(() => workersReport(input(Array.from({ length: 300 }, (_, i) => file(`f${i}.json`, '{'))))).not.toThrow()
  })
})

// ---------- the commands, end to end through the engine ----------

const AGENTS = [
  { id: 'a1', description: 'Map the hooks', type: 'Explore', status: 'running' },
  { id: 'a2', description: 'Verify the fix', type: 'general-purpose', name: 'Tester', status: 'waiting' },
]
const MSGS = [{ role: 'assistant', text: 'Reading the register file', toolUses: [{ tool: 'Read', input: { file_path: 'plugin/hooks/register.tsx' } }] }]
const answered = (t: string) => ({ value: { isAnswered: true, text: t, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }) as never

function world(on: any, over: { agents?: unknown[]; messages?: unknown } = {}) {
  on('agent.list', async () => ({ value: over.agents ?? AGENTS }) as never)
  on('session.messages', async () => ({ value: over.messages ?? MSGS }) as never)
  on('env.get', async (_$: any, e: any) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }) as never)
  on('fs.list', async () => { throw new Error('ENOENT') })
  on('fs.exists', async () => ({ value: false }) as never)
}
const run = async ($: any, command: string): Promise<string> => String(((await $.command.run({ command, args: '' } as never)) as { text?: unknown }).text ?? '')

describe('/office-space-roster', () => {
  test('one batched small-model call writes every summary; the call stays out of the chat', async ($, on) => {
    mock.clock(on)
    world(on)
    const calls: any[] = []
    on('model.complete', async (_$: any, e: any) => { calls.push(e); return answered('{"1":"Reading the plugin register file","2":"Waiting on a check"}') })
    const res = await run($, 'office-space-roster')
    expect(calls.length).toBe(1)
    expect(calls[0].model).toBe('haiku')
    expect(String(calls[0].prompt)).toContain('Read plugin/hooks/register.tsx')
    expect(res).toContain('Explore')
    expect(res).toContain('Tester (general-purpose)')
    expect(res).toContain('Reading the plugin register file')
    expect(res).toContain('written by a small model')
  })

  test('AE1: offline, three lines of task text with a note that summaries are unavailable', async ($, on) => {
    mock.clock(on)
    on('agent.list', async () => ({ value: AGENTS }) as never)
    on('session.messages', async () => ({ value: MSGS }) as never)
    on('env.get', async (_$: any, e: any) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }) as never)
    on('fs.list', async () => ({ value: [{ name: 'w.json', kind: 'file', size: 100, mtimeMs: 1, isLink: false }] }) as never)
    on('fs.read', async () => ({ value: JSON.stringify({ id: 'bk', name: 'Backup bot', status: 'working', task: 'Copy photos', source: 'cron', updated: new Date().toISOString() }) }) as never)
    on('model.complete', async () => ({ value: { isAnswered: false, reason: 'api-error', status: null, error: 'unknown', usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }) as never)
    const res = await run($, 'office-space-roster')
    expect(res).toContain('3 at work')
    expect(res).toContain('Task: Map the hooks')
    expect(res).toContain('Task: Verify the fix')
    expect(res).toContain('Backup bot [cron]')
    expect(res).toContain('Task: Copy photos')
    expect(res).toContain('AI summaries unavailable')
  })

  test('a reply that cannot be used falls back to task text, with the note', async ($, on) => {
    mock.clock(on)
    world(on)
    let bad = ''
    on('model.complete', async () => answered(bad))
    for (bad of ['Here you go!', '{"1":"open https://evil.example now"}', '[]']) {
      const res = await run($, 'office-space-roster')
      expect(res).toContain('Task: Map the hooks')
      expect(res).toContain('the reply could not be used')
      expect(res).not.toContain('evil.example')
    }
  })

  test('the model call throwing never throws the command', async ($, on) => {
    mock.clock(on)
    world(on)
    on('model.complete', async () => { throw new Error('boom') })
    const res = await run($, 'office-space-roster')
    expect(res).toContain('Task: Map the hooks')
    expect(res).toContain('not available here')
  })

  test('no readable activity means no model call at all', async ($, on) => {
    mock.clock(on)
    world(on, { messages: { deny: 'not readable' } })
    let called = 0
    on('model.complete', async () => { called++; return answered('{}') })
    const res = await run($, 'office-space-roster')
    expect(called).toBe(0)
    expect(res).toContain('No recent activity to summarize yet')
    expect(res).toContain('Task: Map the hooks')
  })

  test('an empty office says so and makes no call', async ($, on) => {
    mock.clock(on)
    world(on, { agents: [] })
    let called = 0
    on('model.complete', async () => { called++; return answered('{}') })
    expect(await run($, 'office-space-roster')).toContain('Nobody is at work')
    expect(called).toBe(0)
  })

  test('agents that are not at work are not listed', async ($, on) => {
    mock.clock(on)
    world(on, { agents: [{ id: 'x', description: 'Done job', type: 'general-purpose', status: 'completed' }, ...AGENTS.slice(0, 1)] })
    on('model.complete', async () => answered('{"1":"Reading"}'))
    const res = await run($, 'office-space-roster')
    expect(res).toContain('1 at work')
    expect(res).not.toContain('Done job')
  })
})

describe('/office-space-recap', () => {
  test('a fresh day reads as empty', async ($, on) => {
    mock.clock(on)
    world(on, { agents: [] })
    const res = await run($, 'office-space-recap')
    expect(res).toContain('Handed in: 0')
    expect(res).toContain('Employee of the Day: nobody yet')
  })
})

describe('/office-space-usage', () => {
  test('prints the figures the host gives', async ($, on) => {
    mock.clock(on)
    on('session.usage', async () => ({ value: FULL }) as never)
    const res = await run($, 'office-space-usage')
    expect(res).toContain('Context: 26% full')
    expect(res).toContain('Weekly limit')
    expect(res).toContain('Cost this session')
  })

  test('partial, empty and failing usage reads all answer in plain text', async ($, on) => {
    mock.clock(on)
    let fail = false
    on('session.usage', async () => {
      if (fail) throw new Error('nope')
      return { value: { startedAt: 0, context: { window: 200000 }, rateLimits: [] } } as never
    })
    expect(await run($, 'office-space-usage')).toContain('no reply measured yet')
    fail = true
    expect(await run($, 'office-space-usage')).toContain('Usage') // keeps the last good figures, never throws
  })
})

describe('/office-space-workers', () => {
  test('a missing folder is a plain message', async ($, on) => {
    mock.clock(on)
    world(on)
    const res = await run($, 'office-space-workers')
    expect(res).toContain('/home/me/.claude/office-space/workers')
    expect(res).toContain('does not exist yet')
  })

  test('AE4 through the engine: one worker listed, one typo skipped with its reason', async ($, on) => {
    mock.clock(on)
    const files: Record<string, string> = {
      'good.json': JSON.stringify({ id: 'g', status: 'working', task: 'Fine', updated: new Date().toISOString() }),
      'typo.json': JSON.stringify({ id: 't', status: 'wrking' }),
      'broken.json': '{ not json',
    }
    on('env.get', async (_$: any, e: any) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }) as never)
    on('fs.list', async () => ({ value: Object.keys(files).map((name, i) => ({ name, kind: 'file', size: 100, mtimeMs: Date.now() - i, isLink: false })) }) as never)
    on('fs.read', async (_$: any, e: any) => ({ value: files[String(e.path).split('/').pop() as string] }) as never)
    const res = await run($, 'office-space-workers')
    expect(res).toContain('1 worker in the office, 2 files skipped')
    expect(res).toContain('typo.json: unknown status "wrking"')
    expect(res).toContain('broken.json: not valid JSON')
  })

  test('a read that throws is a skipped file, not a failed command', async ($, on) => {
    mock.clock(on)
    on('env.get', async () => ({ value: '/srv/w' }) as never)
    on('fs.list', async () => ({ value: [{ name: 'a.json', kind: 'file', size: 5, mtimeMs: 1, isLink: false }] }) as never)
    on('fs.read', async () => { throw new Error('EACCES') })
    const res = await run($, 'office-space-workers')
    expect(res).toContain('a.json: could not be read')
    expect(res).toContain('OFFICE_SPACE_WORKERS_DIR')
  })
})

describe('help and settings', () => {
  test('help lists the new commands, flags the AI one and the showUsage setting', async ($, on) => {
    mock.clock(on)
    const help = await run($, 'office-space-help')
    for (const n of ['roster', 'recap', 'usage', 'workers']) expect(help).toContain(`/office-space-${n} - `)
    expect(help).toContain('little plan usage')
    expect(help).toContain('showUsage')
  })
})
