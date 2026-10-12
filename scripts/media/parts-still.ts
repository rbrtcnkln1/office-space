// The clothing-color and drawn-parts still, drawn by the real renderer:
//   portrait.svg   the Boss before and after: silver (gray) hair, a white tee
//                  with a drawn smiley print, blue jeans, headphones, drawn
//                  white sneakers and a drawn cowboy hat
//   office.svg     the same look in the office at its usual size, with the
//                  Coder wearing the reused cowboy hat
// The drawn parts are the examples in examples/drawn-parts.json (the exact
// format a drawing reply has). Then:
//
//   bun scripts/media/parts-still.ts OUT_DIR
//   python3 scripts/media/parts-sheet.py OUT_DIR docs/media/drawn-parts.png

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { Office, portraitSvg } from '../../plugin/hooks/office'
import { DEFAULT_LOOK } from '../../plugin/hooks/catalog'
import type { BossLook } from '../../plugin/hooks/catalog'
import { gridProblem, libraryMap, makePart, resolveParts } from '../../plugin/hooks/parts'
import type { PartSlot } from '../../plugin/hooks/parts'

const dir = process.argv[2] ?? '.'
mkdirSync(dir, { recursive: true })

const raw = JSON.parse(readFileSync(new URL('../../examples/drawn-parts.json', import.meta.url), 'utf8')) as { name: string; slot: PartSlot; rows: string[] }[]
const parts = raw.map((p) => {
  const why = gridProblem(p.slot, p.rows)
  if (why) throw new Error(`${p.name}: ${why}`)
  return makePart(p.name, p.slot, p.rows)
})
const lib = libraryMap(parts)
const id = (name: string) => (parts.find((p) => p.name === name) as { id: string }).id

const after: BossLook = {
  hair: 'short', hairColor: 'gray', outfit: 'tee', accessory: 'headphones', top: 'white', bottom: 'denim',
  parts: { hat: id('cowboy hat'), shoes: id('white sneakers'), graphic: id('smiley print') },
}
const fig = (look: BossLook) => {
  const p = resolveParts(look.parts, lib)
  return { role: 'boss' as const, look, ...(p ? { parts: p } : {}) }
}
writeFileSync(`${dir}/portrait.svg`, portraitSvg([fig(DEFAULT_LOOK), fig(after)], 10))

let seed = 11
Math.random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
const o = new Office()
o.partLib = lib
o.bossLook = after
o.setTeam({ titles: {}, looks: { coder: { parts: { hat: id('cowboy hat') }, top: 'black' }, writer: { parts: { face: id('big beard') }, outfit: 'cardigan' } } })
const task = (i: string, description: string) => ({ id: i, description, type: 'general-purpose', status: 'running' })
o.sync([task('a1', 'Build the new feature'), task('a2', 'Write the docs'), task('a3', 'Review the open pull request')] as never)
for (let i = 0; i < 160; i++) o.step()
writeFileSync(`${dir}/office.svg`, o.render(3))
