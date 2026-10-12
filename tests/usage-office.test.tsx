import { expect, mock, test } from 'claude-code/testing'

const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100 } } as const
const USAGE = {
  startedAt: 0,
  context: { tokens: 90000, window: 200000, percent: 45 },
  rateLimits: [{ kind: 'five_hour', percentUsed: 61, resetsAt: new Date(Date.now() + 90 * 60_000).toISOString() }],
}

async function drawn($: any, on: any): Promise<string> {
  mock.clock(on)
  on('agent.list', async () => ({ value: [] }) as never)
  on('session.usage', async () => ({ value: USAGE }) as never)
  await $.command.run({ command: 'office-space', args: 'band' } as never)
  const ui = await $.ui.mount({ plugin: 'office-space', surface: 'desktop', ...BAND } as never)
  const svg = (await ui.find({ type: 'Svg' } as never)) as { props?: { source?: string } } | undefined
  await ui.unmount()
  return svg?.props?.source ?? ''
}

test('showUsage on (the default): the office draws the usage objects the host reports', async ($, on) => {
  const src = await drawn($, on)
  expect(src).toContain('61%') // wall clock
  expect(src).toContain('45%') // in-tray
  expect(src).not.toContain('WEEK') // no weekly window reported, so no calendar
})

test('showUsage off: nothing about usage is drawn', { options: { showUsage: false } }, async ($, on) => {
  const src = await drawn($, on)
  expect(src).toContain('OFFICE SPACE')
  expect(src).not.toContain('61%')
  expect(src).not.toContain('45%')
})
