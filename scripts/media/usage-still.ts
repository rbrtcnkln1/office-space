// A still of the usage objects (in-tray, wall clock, wall calendar), drawn by the
// real renderer with fixed figures and a fixed clock, so it is reproducible.
//
//   bun scripts/media/usage-still.ts out.svg        # then: rsvg-convert out.svg -o docs/media/usage-board.png

import { writeFileSync } from 'node:fs'
import { Office } from '../../plugin/hooks/office'
import { toBoard } from '../../plugin/hooks/usage'

const out = process.argv[2] ?? 'usage-board.svg'
const now = Date.UTC(2026, 9, 11, 15, 0, 0)
let seed = 7
Math.random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)

const o = new Office()
o.clockNow = now
o.usage = toBoard({
  context: { tokens: 52000, window: 200000, percent: 26 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 32, resetsAt: new Date(now + (3 * 60 + 50) * 60_000).toISOString() },
    { kind: 'seven_day', percentUsed: 74, resetsAt: new Date(now + 2 * 86_400_000).toISOString() },
  ],
})
o.sync([
  { id: 'a1', description: 'Implement the login fix', type: 'general-purpose', status: 'running' },
  { id: 'a2', description: 'Research card routing', type: 'general-purpose', status: 'running' },
])
for (let i = 0; i < 120; i++) o.step()
writeFileSync(out, o.render(5))
