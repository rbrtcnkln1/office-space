import { expect, mock, test } from 'claude-code/testing'

import { cliVersion, compareVersions, looksLikeLocalFolder, parseVersion, updateOffice, versionFromManifest } from '../hooks/update'
import type { UpdateIo } from '../hooks/update'

// The update flow takes its file, network and process access as a parameter
// (UpdateIo), because the test kit cannot move `$.plugin.root` to an
// installed-looking path. These tests fake that parameter and record every call.

const ROOT = '/home/me/.claude/plugins/cache/office-space/office-space/0.8.0'
const URL = 'https://raw.githubusercontent.com/rbrtcnkln1/office-space/main/plugin/.claude-plugin/plugin.json'
const UPDATE_ARGV = ['claude', 'plugin', 'update', 'office-space@office-space']
const manifest = (v: string) => JSON.stringify({ name: 'office-space', version: v })

type Setup = { root?: string; installed?: string; remote?: string | null | 'throw'; cli?: string | 'throw'; update?: number | 'throw'; git?: boolean }

function rig(o: Setup = {}) {
  const calls: string[][] = []
  const fetched: string[] = []
  const io: UpdateIo = {
    root: o.root ?? ROOT,
    readText: async () => manifest(o.installed ?? '0.8.0'),
    exists: async () => o.git === true,
    fetchText: async (url) => {
      fetched.push(url)
      if (o.remote === 'throw') throw new Error('offline')
      return o.remote === undefined ? manifest('0.9.0') : o.remote
    },
    run: async (argv) => {
      calls.push([...argv])
      if (argv[1] === '--version') {
        if (o.cli === 'throw') throw new Error('ENOENT')
        return { exitCode: 0, stdout: (o.cli ?? '2.1.293') + ' (Claude Code)\n' }
      }
      if (o.update === 'throw') throw new Error('boom')
      return { exitCode: o.update ?? 0, stdout: '' }
    },
  }
  return { io, calls, fetched }
}

test('a newer release is installed with the exact argv and ends with a reload hint', async () => {
  const { io, calls, fetched } = rig()
  const text = await updateOffice(io)
  expect(text).toContain('0.8.0 to 0.9.0')
  expect(text).toContain('/reload-plugins')
  expect(calls[1]).toEqual(UPDATE_ARGV)
  expect(fetched).toEqual([URL])
})

test('the same version says up to date and runs nothing', async () => {
  const { io, calls } = rig({ remote: manifest('0.8.0') })
  expect(await updateOffice(io)).toContain('up to date')
  expect(calls).toEqual([])
})

test('an older remote version is also up to date', async () => {
  const { io, calls } = rig({ remote: manifest('0.7.9') })
  expect(await updateOffice(io)).toContain('up to date')
  expect(calls).toEqual([])
})

test('versions compare as numbers, not text', async () => {
  const { io, calls } = rig({ installed: '0.9.0', remote: manifest('0.10.0') })
  expect(await updateOffice(io)).toContain('0.9.0 to 0.10.0')
  expect(calls[1]).toEqual(UPDATE_ARGV)
})

test('malformed remote versions are unknown, never shown, and run nothing', async () => {
  for (const bad of ['1.0.0; rm -rf', '<b>', '1.0', 'v1.0.0', '1.0.0-beta', 'x']) {
    const { io, calls } = rig({ remote: manifest(bad) })
    const text = await updateOffice(io)
    expect(text).toContain('Could not check')
    expect(text).not.toContain(bad)
    expect(calls).toEqual([])
  }
})

test('a body that is not JSON, or no body, is unknown and runs nothing', async () => {
  for (const remote of ['<html>not json</html>', null]) {
    const { io, calls } = rig({ remote })
    expect(await updateOffice(io)).toContain('Could not check')
    expect(calls).toEqual([])
  }
})

test('a network error gives the manual steps and does not throw', async () => {
  const { io, calls } = rig({ remote: 'throw' })
  const text = await updateOffice(io)
  expect(text).toContain('Could not check')
  expect(text).toContain('/plugin')
  expect(text).toContain('/reload-plugins')
  expect(calls).toEqual([])
})

test('an old claude command is not used for the update', async () => {
  const { io, calls } = rig({ cli: '2.1.200' })
  const text = await updateOffice(io)
  expect(text).toContain('0.9.0 is available')
  expect(text).toContain('/reload-plugins')
  expect(calls).toEqual([['claude', '--version']])
})

test('a missing claude command is not used for the update', async () => {
  const { io, calls } = rig({ cli: 'throw' })
  expect(await updateOffice(io)).toContain('/plugin')
  expect(calls).toEqual([['claude', '--version']])
})

test('a failed update gives the manual steps', async () => {
  for (const update of [1, 'throw'] as const) {
    const { io } = rig({ update })
    const text = await updateOffice(io)
    expect(text).toContain('did not complete')
    expect(text).toContain('/reload-plugins')
  }
})

test('a local-folder install only gets the pull hint and touches nothing', async () => {
  const { io, calls, fetched } = rig({ root: '/home/me/dev/office-space' })
  const text = await updateOffice(io)
  expect(text).toContain('local folder')
  expect(text).toContain('Pull the repo')
  expect(calls).toEqual([])
  expect(fetched).toEqual([])
})

test('a cache path with a .git folder still counts as local', async () => {
  const { io, calls } = rig({ git: true })
  expect(await updateOffice(io)).toContain('local folder')
  expect(calls).toEqual([])
})

test('/office-space-update through the command table never throws and never goes online from a local copy', async ($, on) => {
  mock.clock(on)
  let net = 0
  let proc = 0
  on('http.fetch', async () => { net++; throw new Error('no network in tests') })
  on('process.run', async () => { proc++; throw new Error('no processes in tests') })
  on('ui.open', async () => ({ value: undefined }) as never)
  const res = JSON.stringify(await $.command.run({ command: 'office-space-update', args: '' } as never))
  expect(res).toContain('text')
  expect(res).not.toContain('Unknown command')
  expect(res).toContain('local folder') // the test plugin is a folder, not a cache copy
  expect(net).toBe(0)
  expect(proc).toBe(0)
})

test('version helpers are strict and numeric', () => {
  expect(parseVersion('1.2.3')).toEqual([1, 2, 3])
  for (const bad of ['1.2', '1.2.3.4', ' 1.2.3', '1.2.3\n', 'a.b.c', '1.2.3; ls', 1, null]) expect(parseVersion(bad)).toBeNull()
  expect(compareVersions([0, 10, 0], [0, 9, 0])).toBe(1)
  expect(compareVersions([0, 9, 0], [0, 10, 0])).toBe(-1)
  expect(compareVersions([1, 0, 0], [1, 0, 0])).toBe(0)
  expect(versionFromManifest('{"version":"2.0.1"}')).toBe('2.0.1')
  expect(versionFromManifest('{"version":"2.0.1 "}')).toBeNull()
  expect(versionFromManifest('nope')).toBeNull()
  expect(cliVersion('2.1.293 (Claude Code)')).toEqual([2, 1, 293])
  expect(cliVersion('Claude 2.1.293')).toBeNull()
  expect(looksLikeLocalFolder('C:\\Users\\me\\.claude\\plugins\\cache\\a\\b\\1.0.0', false)).toBe(false)
})
