import { expect, mock, test } from 'claude-code/testing'

// One test per file: the plugin's watcher timer is module state, so it starts once per file.

test('the stop event counts an agent once, with or without the watcher seeing it', async ($, on) => {
  const clock = mock.clock(on)
  let list: any[] = []
  on('classic.SubagentStop', async () => ({}) as never)
  on('agent.list', async () => ({ value: list }) as never)
  on('env.get', async (_$: any, e: any) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }) as never)
  on('fs.list', async () => { throw new Error('ENOENT') })
  on('fs.exists', async () => ({ value: false }) as never)
  on('session.start', async (_$: any, e: any) => ({ cwd: e.cwd }) as never)
  on('command.register', async () => ({ value: undefined }) as never)
  on('session.usage', async () => { throw new Error('no usage here') })
  const recap = async () => String(((await $.command.run({ command: 'office-space-recap', args: '' } as never)) as { text?: unknown }).text)
  const stop = (id: string) => ($ as any).classic.SubagentStop({ agent_id: id, agent_type: 'general-purpose' })
  list = [{ id: 'base', description: 'Done before', type: 'general-purpose', status: 'completed' }, { id: 'w', description: 'Watched one', type: 'general-purpose', status: 'running' }]
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true } as never)
  await clock.advance(1000)
  expect(await recap()).toContain('Handed in: 0')
  // event only: the list already dropped the agent
  await stop('gone')
  expect(await recap()).toContain('Handed in: 1')
  await stop('gone')
  expect(await recap()).toContain('Handed in: 1')
  // event, then the watcher sees the same agent finish
  await stop('w')
  expect(await recap()).toContain('Handed in: 2')
  list = [{ id: 'base', description: 'Done before', type: 'general-purpose', status: 'completed' }, { id: 'w', description: 'Watched one', type: 'general-purpose', status: 'completed' }]
  await clock.advance(6000)
  expect(await recap()).toContain('Handed in: 2')
  // watcher first, then the event
  list = [...list, { id: 'x', description: 'Quick one', type: 'general-purpose', status: 'completed' }]
  await clock.advance(6000)
  expect(await recap()).toContain('Handed in: 3')
  await stop('x')
  expect(await recap()).toContain('Handed in: 3')
  // a failure still on the list is counted as failed
  list = [...list, { id: 'f', description: 'Broken one', type: 'general-purpose', status: 'failed' }]
  await stop('f')
  const res = await recap()
  expect(res).toContain('Failed: 1')
  expect(res).toContain('Handed in: 3')
  // the baseline rule still holds: 'base' was never counted
  expect(res).not.toContain('Done before')
})
