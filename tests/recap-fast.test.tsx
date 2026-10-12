import { expect, mock, test } from 'claude-code/testing'

// One test per file: the plugin's watcher timer is module state, so it starts once per file.

test('agents that start and finish between two looks, or end as idle/completed, still count', async ($, on) => {
  const clock = mock.clock(on)
  let phase = 0
  on('agent.list', async () => ({ value: phase === 0
    ? [{ id: 'old', description: 'Finished before the mod looked', type: 'general-purpose', status: 'completed' }]
    : [
      { id: 'old', description: 'Finished before the mod looked', type: 'general-purpose', status: 'completed' },
      { id: 'q1', description: 'Quick lookup', type: 'general-purpose', status: 'completed' },
      { id: 'q2', description: 'Quick broken one', type: 'general-purpose', status: 'failed' },
    ] }) as never)
  on('env.get', async (_$: any, e: any) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }) as never)
  on('fs.list', async () => { throw new Error('ENOENT') })
  on('fs.exists', async () => ({ value: false }) as never)
  on('session.start', async (_$: any, e: any) => ({ cwd: e.cwd }) as never)
  on('command.register', async () => ({ value: undefined }) as never)
  on('session.usage', async () => { throw new Error('no usage here') })
  const recap = async () => String(((await $.command.run({ command: 'office-space-recap', args: '' } as never)) as { text?: unknown }).text)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true } as never)
  await clock.advance(1000)
  expect(await recap()).toContain('Handed in: 0')
  phase = 1
  await clock.advance(6000)
  const res = await recap()
  expect(res).toContain('Handed in: 1')
  expect(res).toContain('Failed: 1')
  expect(res).toContain('Quick broken one')
  expect(res).not.toContain('Finished before')
})
