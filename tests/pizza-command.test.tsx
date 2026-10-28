import { expect, mock, test } from 'claude-code/testing'

// One test per file: the plugin's office and watcher are module state.

test('/office-space-pizza opens a closed office, answers in one line, says so when run again, and shows in the recap', async ($, on) => {
  const clock = mock.clock(on)
  let opened = 0
  on('ui.open', async () => { opened++; return { value: undefined } as never })
  on('agent.list', async () => ({ value: [{ id: 'a1', description: 'Implement the login fix', type: 'general-purpose', status: 'running' }] }) as never)
  on('env.get', async (_$: any, e: any) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }) as never)
  on('fs.list', async () => { throw new Error('ENOENT') })
  on('fs.exists', async () => ({ value: false }) as never)
  on('session.start', async (_$: any, e: any) => ({ cwd: e.cwd }) as never)
  on('command.register', async () => ({ value: undefined }) as never)
  on('session.usage', async () => { throw new Error('no usage here') })
  const say = async (command: string) => String(((await $.command.run({ command, args: '' } as never)) as { text?: unknown }).text)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true } as never)
  const first = await say('office-space-pizza')
  expect(opened).toBe(1) // the closed office opened
  expect(first).toContain('Pizza party')
  expect(first.split('\n').length).toBe(1)
  expect(await say('office-space-pizza')).toContain('already on')
  expect(opened).toBe(1)
  expect(await say('office-space-recap')).toContain('Pizza parties: 1')
  await clock.advance(1000)
})
