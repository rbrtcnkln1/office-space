import { expect, mock, test } from 'claude-code/testing'

const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, maxRows: 20, bodyColumns: 100 } } as const

const AGENTS = [
  { id: 'a1', description: 'Verify the login fix on staging', type: 'general-purpose', status: 'running' },
  { id: 'a2', description: 'Fix the test environment', type: 'general-purpose', status: 'waiting' },
  { id: 'a3', description: 'Research card routing', type: 'general-purpose', status: 'completed' },
]

test('closed by default: the band falls through to the engine', async ($, on) => {
  mock.clock(on)
  on('ui.render', async ($$: any, e: any) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>engine band</Text>
  })
  on('agent.list', async () => ({ value: AGENTS }) as never)
  const ui = await $.ui.mount({ plugin: 'office-space', surface: 'desktop', ...BAND } as never)
  expect(await ui.find({ type: 'Text', text: /office space/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /engine band/ })).toBeDefined()
  await ui.unmount()
})

test('/office-space band shows the office above the prompt', async ($, on) => {
  mock.clock(on)
  on('agent.list', async () => ({ value: AGENTS }) as never)
  const res = await $.command.run({ command: 'office-space', args: 'band' } as never)
  expect(JSON.stringify(res)).toContain('band is on')
  const term = await $.ui.mount({ plugin: 'office-space', surface: 'terminal', ...BAND } as never)
  expect(await term.find({ type: 'Text', text: /Verify the login fix/ })).toBeDefined()
  await term.unmount()
  const desk = await $.ui.mount({ plugin: 'office-space', surface: 'desktop', ...BAND } as never)
  expect(await desk.find({ type: 'Svg' } as never)).toBeDefined()
  await desk.unmount()
})

test('switching between panel and band keeps the office as it is', async ($, on) => {
  mock.clock(on)
  let agents: unknown[] = []
  on('ui.open', async () => ({ value: undefined }) as never)
  on('agent.list', async () => ({ value: agents }) as never)
  await $.command.run({ command: 'office-space', args: 'band' } as never) // opens on an empty office
  agents = [{ id: 'n1', description: 'Late arrival', type: 'general-purpose', status: 'running' }]
  const first = await $.ui.mount({ plugin: 'office-space', surface: 'terminal', ...BAND } as never)
  expect(await first.find({ type: 'Text', text: /1 arriving/ })).toBeDefined() // walking in through the door
  await first.unmount()
  await $.command.run({ command: 'office-space', args: '' } as never) // open the panel too
  const second = await $.ui.mount({ plugin: 'office-space', surface: 'terminal', ...BAND } as never)
  // a fresh office would have seated the newcomer instantly ("1 working")
  expect(await second.find({ type: 'Text', text: /1 arriving/ })).toBeDefined()
  await second.unmount()
})

test('control characters in a description never reach the drawing', async ($, on) => {
  mock.clock(on)
  on('agent.list', async () => ({ value: [{ id: 'c1', description: 'Bell\u0007 and\u0001 friends', type: 'general-purpose', status: 'running' }] }) as never)
  await $.command.run({ command: 'office-space', args: 'band' } as never)
  const desk = await $.ui.mount({ plugin: 'office-space', surface: 'desktop', ...BAND } as never)
  const svg = (await desk.find({ type: 'Svg' } as never)) as { props?: { source?: string } } | undefined
  expect(svg?.props?.source).toContain('Bell and friends')
  expect(/[\u0000-\u0008]/.test(svg?.props?.source ?? '')).toBe(false)
  await desk.unmount()
})

// ----- the first /office-space of a chat follows what is on screen -----

function fakePanes(on: any, seed: boolean) {
  let up = seed
  on('ui.open', async () => { up = true; return { value: { isPlaced: true } } as never })
  on('ui.close', async () => { up = false; return { value: undefined } as never })
  on('ui.panes', async () => ({ value: up ? [{ id: 'office-space', title: 'Office Space', isShown: true, isFocused: false, isPlaced: true }] : [] }) as never)
  return { drop: () => { up = false } }
}

const run = async ($: any) => JSON.stringify(await $.command.run({ command: 'office-space', args: '' } as never))

test('the first command in a fresh chat opens (no panel is assumed open from before)', async ($, on) => {
  mock.clock(on)
  on('agent.list', async () => ({ value: [] }) as never)
  fakePanes(on, false)
  expect(await run($)).toContain('is open')
})

test('open then command closes; closed with the X then command opens', async ($, on) => {
  mock.clock(on)
  on('agent.list', async () => ({ value: [] }) as never)
  const panes = fakePanes(on, false)
  expect(await run($)).toContain('is open')
  expect(await run($)).toContain('closed for the day')
  expect(await run($)).toContain('is open')
  panes.drop() // the person pressed the panel's X
  expect(await run($)).toContain('is open')
})
