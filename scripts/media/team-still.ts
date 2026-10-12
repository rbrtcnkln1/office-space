// Stills of the team and theme commands, drawn by the real renderer with a
// fixed seed, so they are reproducible. Writes one SVG per scene into OUT_DIR:
//   default.svg          the built-in team
//   custom.svg           a renamed, restyled team with more desks
//   preset-<name>.svg    each built-in theme preset (Boss, team and decor)
//   combined.svg         everything at once: a customized Boss, a renamed team,
//                        a decorated office and long tasks wrapped under the desks
// Then stack.py turns them into docs/media/team-before-after.png,
// docs/media/theme-presets.png and docs/media/make-it-yours.png:
//
//   bun scripts/media/team-still.ts OUT_DIR
//   python3 scripts/media/stack.py OUT_DIR docs/media

import { mkdirSync, writeFileSync } from 'node:fs'
import { Office } from '../../plugin/hooks/office'
import { PRESETS } from '../../plugin/hooks/theme'
import type { Team } from '../../plugin/hooks/team'
import type { BossLook } from '../../plugin/hooks/catalog'
import type { OfficeLook } from '../../plugin/hooks/decor'

const dir = process.argv[2] ?? '.'
mkdirSync(dir, { recursive: true })

const task = (id: string, description: string) => ({ id, description, type: 'general-purpose', status: 'running' }) as const
const THREE = [task('a1', 'Build the new feature'), task('a2', 'Write the docs'), task('a3', 'Review the open pull request')]
const FIVE = [...THREE, task('a4', 'Research card routing'), task('a5', 'Plan the roadmap')]

function scene(file: string, work: readonly object[], boss: BossLook | undefined, team: Team | undefined, decor?: OfficeLook) {
  let seed = 11
  Math.random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const o = new Office()
  o.bossLook = boss
  o.setTeam(team)
  o.decor = decor
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
for (const p of PRESETS) scene(`preset-${p.name.replace(/\s+/g, '-')}`, FIVE, p.boss, p.team, p.office)
scene('combined', [
  task('c1', 'Implement the new payments feature with saved cards and receipts'),
  task('c2', 'Write the welcome guide for new teammates joining this month'),
  task('c3', 'Review the open pull request'),
  task('c4', 'Research card routing across regions'),
  task('c5', 'Plan the roadmap'),
], { hair: 'frosted', hairColor: 'pink', outfit: 'early-2000s', accessory: 'headphones' }, {
  titles: { coder: 'Mx. Bytes', writer: 'Scribe', reviewer: 'Nitpicker' },
  looks: {
    coder: { hair: 'curly', hairColor: 'pink', outfit: 'hoodie', accessory: 'headphones' },
    writer: { outfit: 'cardigan', accessory: 'scarf' },
    reviewer: { hairColor: 'blue', accessory: 'cap' },
  },
}, { wall: 'teal', floor: 'oak-planks', items: { break: 'vending-machine', 'wall-door': 'poster-rocket', 'wall-cooler': 'poster-cat', 'bottom-1': 'arcade-cabinet', 'bottom-3': 'couch', 'bottom-5': 'fish-tank' } })
