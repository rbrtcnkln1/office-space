import { describe, expect, test } from 'claude-code/testing'

import { LABEL_CHARS, Office, wrapLabel } from '../hooks/office'
import type { AgentLike } from '../hooks/office'

describe('wrapLabel', () => {
  test('short text stays on one line', () => {
    expect(wrapLabel('Debug recap')).toEqual(['Debug recap'])
  })
  test('long text wraps on word boundaries into two lines', () => {
    expect(wrapLabel('Build team + theme commands')).toEqual(['Build team + theme', 'commands'])
  })
  test('very long text is cut to two lines ending in an ellipsis', () => {
    const lines = wrapLabel('Debug the recap showing zero hand-ins after the restart of the session today')
    expect(lines.length).toBe(2)
    expect(lines[1].endsWith('…')).toBe(true)
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(LABEL_CHARS)
  })
  test('a single long word is hard-broken', () => {
    expect(wrapLabel('x'.repeat(40))).toEqual(['x'.repeat(24), 'x'.repeat(16)])
    const cut = wrapLabel('y'.repeat(100))
    expect(cut.length).toBe(2)
    expect(cut[1].length).toBe(LABEL_CHARS)
    expect(cut[1].endsWith('…')).toBe(true)
  })
  test('empty text gives no lines', () => {
    expect(wrapLabel('')).toEqual([])
    expect(wrapLabel('   ')).toEqual([])
  })
})

describe('desk labels in the render', () => {
  test('no label line is wider than the desk cell', () => {
    const o = new Office()
    const agents: AgentLike[] = [
      'Build /office-space-office', 'Build team + theme commands', 'Debug recap showing zero',
      'Investigate the intermittent failure in the nightly integration suite across all regions and report back',
    ].map((d, i) => ({ id: `a${i}`, description: d, type: 'general-purpose', status: 'running' }))
    o.sync([])
    o.sync(agents)
    const lines = () => [...o.render().matchAll(/<text [^>]*font-size="4"[^>]*>([^<]*)<\/text>/g)].map(m => m[1] as string)
    for (let i = 0; i < 1500; i++) o.step()
    // a label is drawn only while its worker is seated; working agents now and then stand up for a stretch
    for (let i = 0; i < 6000 && lines().length <= 4; i++) o.step()
    const texts = lines()
    expect(texts.length).toBeGreaterThan(4)
    for (const t of texts) expect(t.length * 0.6 * 4).toBeLessThanOrEqual(58.5)
  })
})
