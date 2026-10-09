// Self-update helpers: strict version parsing and the wording of every reply.
// Pure on purpose (no `$`): the command in ./register.tsx does the I/O and
// hands the results here, which keeps each branch easy to test.

export const LATEST_URL = 'https://raw.githubusercontent.com/rbrtcnkln1/office-space/main/.claude-plugin/plugin.json'
export const UPDATE_ARGV = ['claude', 'plugin', 'update', 'office-space@office-space'] as const

export type Version = [number, number, number]

// Hook modules need Claude Code 2.1.290 or newer (the README says "2.1.29x").
export const MIN_CLI: Version = [2, 1, 290]

// Accepts exactly MAJOR.MINOR.PATCH and nothing else (no prefix, suffix or spaces).
export function parseVersion(s: unknown): Version | null {
  if (typeof s !== 'string' || s.length > 32) return null
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(s)
  if (!m) return null
  const v: Version = [Number(m[1]), Number(m[2]), Number(m[3])]
  return v.every((n) => Number.isSafeInteger(n)) ? v : null
}

export function compareVersions(a: Version, b: Version): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
  return 0
}

// The manifest's version string, or null when the text is not JSON or the field is not a clean version.
export function versionFromManifest(text: unknown): string | null {
  if (typeof text !== 'string') return null
  try {
    const v = (JSON.parse(text) as { version?: unknown } | null)?.version
    return parseVersion(v) ? (v as string) : null
  } catch { return null }
}

// "2.1.293 (Claude Code)" -> [2, 1, 293]; anything else -> null.
export function cliVersion(stdout: unknown): Version | null {
  if (typeof stdout !== 'string') return null
  const m = /^\s*(\d+\.\d+\.\d+)(?:\s|$)/.exec(stdout.slice(0, 200))
  return m ? parseVersion(m[1]) : null
}

export function cliIsNewEnough(v: Version | null): boolean {
  return v !== null && compareVersions(v, MIN_CLI) >= 0
}

// An installed copy lives in the plugins cache; anything else (a clone, --plugin-dir) is a local folder.
export function looksLikeLocalFolder(root: string, hasGit: boolean): boolean {
  const p = root.replace(/\\/g, '/')
  return hasGit || !p.includes('/plugins/cache/')
}

const MANUAL = 'To update by hand: type /plugin, choose Marketplaces > office-space > Update, then run /reload-plugins.'
const RELOAD = 'Run /reload-plugins to load it.'

export const toastText = (latest: string) => `Office Space ${latest} is available - run /office-space-update`

export type UpdateState =
  | { kind: 'local' }
  | { kind: 'offline'; installed: string }
  | { kind: 'current'; installed: string }
  | { kind: 'cli-old'; installed: string; latest: string }
  | { kind: 'failed'; installed: string; latest: string }
  | { kind: 'updated'; installed: string; latest: string }

export function updateText(s: UpdateState): string {
  switch (s.kind) {
    case 'local':
      return 'This copy of Office Space is read from a local folder. Pull the repo there, then run /reload-plugins.'
    case 'offline':
      return `Office Space ${s.installed} is installed. Could not check for a newer version. ${MANUAL}`
    case 'current':
      return `Office Space ${s.installed} is up to date.`
    case 'cli-old':
      return `Office Space ${s.latest} is available (you have ${s.installed}). The claude command on your PATH is missing or too old to update from here. ${MANUAL}`
    case 'failed':
      return `Office Space ${s.latest} is available (you have ${s.installed}), but the automatic update did not complete. ${MANUAL}`
    case 'updated':
      return `Office Space updated from ${s.installed} to ${s.latest}. ${RELOAD}`
  }
}

// ----- the flow -----

export type UpdateIo = {
  root: string
  readText: (path: string) => Promise<string | null>
  exists: (path: string) => Promise<boolean>
  fetchText: (url: string) => Promise<string | null> // null on any failure or timeout
  run: (argv: readonly string[], timeoutMs: number) => Promise<{ exitCode: number; stdout: string }>
}

const CHECK_CLI_MS = 10_000
const UPDATE_MS = 120_000

export async function installedVersion(io: UpdateIo): Promise<string | null> {
  try { return versionFromManifest(await io.readText(`${io.root}/.claude-plugin/plugin.json`)) } catch { return null }
}

// The newest released version from the one fixed URL, only if it is a clean MAJOR.MINOR.PATCH.
export async function latestVersion(io: UpdateIo): Promise<string | null> {
  try { return versionFromManifest(await io.fetchText(LATEST_URL)) } catch { return null }
}

// Never throws. Returns the text to show.
export async function updateOffice(io: UpdateIo): Promise<string> {
  try {
    let hasGit = false
    try { hasGit = await io.exists(`${io.root}/.git`) } catch {}
    if (looksLikeLocalFolder(io.root, hasGit)) return updateText({ kind: 'local' })
    const installed = (await installedVersion(io)) ?? 'unknown'
    const latest = await latestVersion(io)
    const a = parseVersion(installed)
    const b = parseVersion(latest)
    if (!a || !b || !latest) return updateText({ kind: 'offline', installed })
    if (compareVersions(a, b) >= 0) return updateText({ kind: 'current', installed })
    const base = { installed, latest }
    let cli: Version | null = null
    try { cli = cliVersion((await io.run(['claude', '--version'], CHECK_CLI_MS)).stdout) } catch {}
    if (!cliIsNewEnough(cli)) return updateText({ kind: 'cli-old', ...base })
    try {
      const r = await io.run(UPDATE_ARGV, UPDATE_MS)
      if (r.exitCode === 0) return updateText({ kind: 'updated', ...base })
    } catch {}
    return updateText({ kind: 'failed', ...base })
  } catch {
    return `Could not check for updates. ${MANUAL}`
  }
}
