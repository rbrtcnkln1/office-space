import { expect, mock, test } from 'claude-code/testing'

// One test per file: the plugin's watcher timer is module state, so it starts once per file.

test('hand-ins and failures seen over time show up in the recap, even with the office closed', async ($, on) => {
  const clock = mock.clock(on)
  let phase = 0
  on('agent.list', async () => ({ value: [
    { id: 'a1', description: 'Implement the login fix', type: 'general-purpose', status: phase ? 'idle' : 'running' },
    { id: 'a2', description: 'Verify it', type: 'general-purpose', status: phase ? 'failed' : 'running' },
  ] }) as never)
  on('env.get', async (_$: any, e: any) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }) as never)
  on('fs.list', async () => { throw new Error('ENOENT') })
  on('fs.exists', async () => ({ value: false }) as never)
  on('session.start', async (_$: any, e: any) => ({ cwd: e.cwd }) as never)
  on('command.register', async () => ({ value: undefined }) as never)
  on('session.usage', async () => { throw new Error('no usage here') })
  const recap = async () => String(((await $.command.run({ command: 'office-space-recap', args: '' } as never)) as { text?: unknown }).text)
  // the session starts its watcher; let it see everyone at work, then finish them
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true } as never)
  expect(await recap()).toContain('Handed in: 0')
  await clock.advance(6000)
  phase = 1
  await clock.advance(6000)
  const res = await recap()
  expect(res).toContain('Handed in: 1')
  expect(res).toContain('Failed: 1')
  expect(res).toContain('Verify it')
})
