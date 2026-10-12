// Stills of the team and theme commands, drawn by the real renderer with a
// fixed seed, so they are reproducible. Writes one SVG per scene into OUT_DIR:
//   default.svg          the built-in team
//   custom.svg           a renamed, restyled team with more desks
//   preset-<name>.svg    each built-in theme preset
// Then stack.py turns them into docs/media/team-before-after.png and
// docs/media/theme-presets.png:
//
//   bun scripts/media/team-still.ts OUT_DIR
//   python3 scripts/media/stack.py OUT_DIR docs/media

import { mkdirSync, writeFileSync } from 'node:fs'
import { Office } from '../../plugin/hooks/office'
import { PRESETS } from '../../plugin/hooks/theme'
import type { Team } from '../../plugin/hooks/team'
import type { BossLook } from '../../plugin/hooks/catalog'

const dir = process.argv[2] ?? '.'
mkdirSync(dir, { recursive: true })

const task = (id: string, description: string) => ({ id, description, type: 'general-purpose', status: 'running' }) as const
const THREE = [task('a1', 'Build the new feature'), task('a2', 'Write the docs'), task('a3', 'Review the open pull request')]
const FIVE = [...THREE, task('a4', 'Research card routing'), task('a5', 'Plan the roadmap')]

function scene(file: string, work: readonly object[], boss: BossLook | undefined, team: Team | undefined) {
  let seed = 11
  Math.random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const o = new Office()
  o.bossLook = boss
  o.setTeam(team)
  o.sync([...work] as never)
  for (let i = 0; i < 160; i++) o.step()
  writeFileSync(`${dir}/${file}.svg`, o.render(4))
}

scene('default', THREE, undefined, undefined)
scene('custom', THREE, undefined, {
  titles: { coder: 'Mx. Bytes', writer: 'Scribe', reviewer: 'Nitpicker' },
  looks: {
    coder: { hair: 'curly', hairColor: 'pink', outfit: 'hoodie', accessory: 'headphones' },
    writer: { outfit: 'cardigan', accessory: 'scarf' },
    reviewer: { hairColor: 'blue', accessory: 'cap' },
  },
  desks: 10,
})
for (const p of PRESETS) scene(`preset-${p.name.replace(/\s+/g, '-')}`, FIVE, p.boss, p.team)
