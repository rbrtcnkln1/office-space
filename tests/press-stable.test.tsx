import { describe, expect, mock, test } from 'claude-code/testing'

// A desktop (or any remote surface) paints a drawing, the person clicks, and
// the click travels back naming the Button's press handle. The host releases
// every handle a newer drawing of the same pane no longer carries, so a press
// that names a handle from one redraw ago runs nothing ("no Button ... is held
// under handle N; nothing ran"). The panel redraws on every animation tick, so
// its Buttons must carry the same handle from one drawing to the next.

const PANE = { component: 'Pane', requestId: 'office-space', props: { title: 'Office Space', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { bodyRows: 40, top: 0, total: 40 } } }

function handles(tree: unknown, out: Map<string, number> = new Map()): Map<string, number> {
  if (Array.isArray(tree)) { for (const c of tree) handles(c, out); return out }
  if (!tree || typeof tree !== 'object') return out
  const n = tree as { type?: string; props?: { key?: string }; press?: { handle?: number }; children?: unknown }
  if ((n.type === 'Button' || n.type === 'Input') && n.props?.key && typeof n.press?.handle === 'number') out.set(n.props.key, n.press.handle)
  handles(n.children, out)
  return out
}

const host = (on: any, store: Record<string, unknown> = {}) => {
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('ui.toast', async () => ({ value: undefined }) as never)
  on('store.get', async (_$: any, e: any) => ({ value: store[e.key] }) as never)
  on('store.set', async (_$: any, e: any) => { store[e.key] = e.value; return { value: undefined } as never })
  return store
}

describe('panel buttons survive a redraw (desktop press race)', () => {
  for (const surface of ['desktop', 'terminal'] as const) {
    test(`${surface}: Apply, Start over and Cancel keep their press handle across redraws`, async ($, on) => {
      mock.clock(on)
      host(on)
      on('model.complete', async () => ({ value: { isAnswered: true, text: '{"hairColor":"pink"}', usage: { input_tokens: 1, output_tokens: 1 } } }) as never)
      await $.command.run({ command: 'office-space-boss', args: 'pink hair' } as never)
      const a = handles(await $.ui.render({ surface, ...PANE } as never))
      expect(a.has('boss-apply')).toBe(true)
      const b = handles(await $.ui.render({ surface, ...PANE } as never))
      for (const k of ['boss-apply', 'boss-restart', 'boss-cancel']) expect(b.get(k)).toBe(a.get(k))
    })

    test(`${surface}: option buttons and the Other field keep their handle; a new step gets new ones`, async ($, on) => {
      mock.clock(on)
      host(on)
      for (const cmd of ['office-space-boss', 'office-space-office', 'office-space-team']) {
        await $.command.run({ command: cmd, args: '' } as never)
        const a = handles(await $.ui.render({ surface, ...PANE } as never))
        const b = handles(await $.ui.render({ surface, ...PANE } as never))
        expect(a.size).toBeGreaterThan(2)
        for (const [k, h] of a) expect(b.get(k)).toBe(h)
      }
      await $.command.run({ command: 'office-space-boss', args: '' } as never)
      const before = handles(await $.ui.render({ surface, ...PANE } as never))
      await $.ui.press({ plugin: 'office-space', key: 'boss-hair-spiky', surface } as never)
      const after = handles(await $.ui.render({ surface, ...PANE } as never))
      expect(after.has('boss-hairColor-pink')).toBe(true)
      expect(after.get('boss-cancel')).not.toBe(before.get('boss-cancel')) // the step moved on: an old Cancel is not this step's
    })
  }

  test('a theme Apply keeps its handle across redraws, and applies', async ($, on) => {
    mock.clock(on)
    const store = host(on)
    await $.command.run({ command: 'office-space-theme', args: 'night shift' } as never)
    const a = handles(await $.ui.render({ surface: 'desktop', ...PANE } as never))
    expect(a.has('theme-apply')).toBe(true)
    const b = handles(await $.ui.render({ surface: 'desktop', ...PANE } as never))
    for (const [k, h] of a) expect(b.get(k)).toBe(h)
    await $.ui.press({ plugin: 'office-space', key: 'theme-apply', surface: 'desktop' } as never)
    expect(store.bossLook).toBeDefined()
  })
})
