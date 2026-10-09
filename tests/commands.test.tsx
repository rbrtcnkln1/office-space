import { expect, mock, test } from 'claude-code/testing'

const text = (r: unknown) => JSON.stringify(r)

// The command table lives in hooks/register.tsx (COMMANDS). The test kit does not
// list registered commands, so this is the one place a new command is also named.
const NAMES = ['office-space', 'office-space-band', 'office-space-help', 'office-space-update']

test('every command is registered as its own entry and answers when run', async ($, on) => {
  mock.clock(on)
  on('ui.open', async () => ({ value: undefined }) as never)
  for (const name of NAMES) {
    const res = text(await $.command.run({ command: name, args: '' } as never))
    expect(res).toContain('text')
    expect(res).not.toContain('Unknown command')
  }
})

test('/office-space-help lists every command with a description, and the docs link', async ($, on) => {
  mock.clock(on)
  const help = text(await $.command.run({ command: 'office-space-help', args: '' } as never))
  for (const name of NAMES) expect(help).toContain('/' + name + ' - ')
  expect(help).toContain('github.com/rbrtcnkln1/office-space')
})

test('/office-space-band toggles the band', async ($, on) => {
  mock.clock(on)
  on('ui.open', async () => ({ value: undefined }) as never)
  expect(text(await $.command.run({ command: 'office-space-band', args: '' } as never))).toContain('band is on')
  expect(text(await $.command.run({ command: 'office-space-band', args: '' } as never))).toContain('band is off')
})

test('the old "/office-space band" spelling still toggles the band', async ($, on) => {
  mock.clock(on)
  on('ui.open', async () => ({ value: undefined }) as never)
  expect(text(await $.command.run({ command: 'office-space', args: 'band' } as never))).toContain('band is on')
})

test('an unknown argument to /office-space points to help and does not toggle anything', async ($, on) => {
  mock.clock(on)
  const res = text(await $.command.run({ command: 'office-space', args: 'bogus' } as never))
  expect(res).toContain('/office-space-help')
  expect(res).not.toContain('is open')
  expect(res).not.toContain('band is')
})
