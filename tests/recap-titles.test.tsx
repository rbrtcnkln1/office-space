import { expect, mock, test } from 'claude-code/testing'

import { emptyDay, recapText } from '../hooks/info'

// One engine test per file: the plugin's watcher timer is module state, so it starts once per file.

test('recapText names roles by the team titles it is given, and falls back to the built-in ones', () => {
  const log = { ...emptyDay(), done: 5, byRole: { coder: 3, writer: 2 } }
  const plain = recapText(log)
  expect(plain).toContain('Handed in: 5 (Coder 3, Writer 2)')
  expect(plain).toContain('Employee of the Day: Coder (3 hand-ins)')
  const custom = recapText(log, (r) => (r === 'coder' ? 'Mx. Bytes' : undefined))
  expect(custom).toContain('Handed in: 5 (Mx. Bytes 3, Writer 2)')
  expect(custom).toContain('Employee of the Day: Mx. Bytes (3 hand-ins)')
  // a naming function that throws never breaks the recap
  expect(recapText(log, () => { throw new Error('x') })).toContain('Employee of the Day: Coder (3 hand-ins)')
})

test('/office-space-recap uses the saved team titles', async ($, on) => {
  const clock = mock.clock(on)
  const store: Record<string, unknown> = { team: { titles: { coder: 'Mx. Bytes' }, looks: {} } }
  let list: any[] = []
  on('classic.SubagentStop', async () => ({}) as never)
  on('agent.list', async () => ({ value: list }) as never)
  on('store.get', async (_$: any, e: any) => ({ value: store[e.key] }) as never)
  on('store.set', async (_$: any, e: any) => { store[e.key] = e.value; return { value: undefined } as never })
  on('env.get', async (_$: any, e: any) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }) as never)
  on('fs.list', async () => { throw new Error('ENOENT') })
  on('fs.exists', async () => ({ value: false }) as never)
  on('session.start', async (_$: any, e: any) => ({ cwd: e.cwd }) as never)
  on('command.register', async () => ({ value: undefined }) as never)
  on('session.usage', async () => { throw new Error('no usage here') })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true } as never)
  await clock.advance(1000)
  list = [{ id: 'c1', description: 'Build the signup feature', type: 'general-purpose', status: 'running' }]
  await ($ as any).classic.SubagentStop({ agent_id: 'c1', agent_type: 'general-purpose' })
  const res = String(((await $.command.run({ command: 'office-space-recap', args: '' } as never)) as { text?: unknown }).text)
  expect(res).toContain('Handed in: 1 (Mx. Bytes 1)')
  expect(res).toContain('Employee of the Day: Mx. Bytes (1 hand-in)')
})
