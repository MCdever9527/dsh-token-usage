/**
 * Host half of dsh-token-usage.
 *
 * One background scanner. It enumerates every stored session — archived and
 * historical sessions included — folds each log with the provider-by-model
 * usage fold (same replacement/retry accounting as the shipped tokenUsage
 * projection), and publishes one aggregate snapshot:
 *
 *   $DSH_HOME/cache/dsh-token-usage/stats.json
 *
 * Reading has two paths on purpose:
 *
 * 1. `ctx.sessionPersistence.open(id, 'read')` — the official seam, which
 *    migrates historical generations and validates replay. Preferred because
 *    its events are current-logical no matter what the file on disk says.
 * 2. {@link readSessionLogFile} — a direct artifact reader used when the seam
 *    refuses a session (a historical generation whose migration fails in this
 *    environment, or a composition without a read-capable backend). Losing a
 *    session's tokens because of a reader failure would silently understate
 *    every number on the page.
 *
 * The session list is likewise the union of `sessionPersistence.list()` and a
 * filesystem walk of the persistence root, so a seam that hides or cannot see a
 * session still cannot hide its tokens.
 *
 * The browser half reads the snapshot through the shipped workspace-files
 * Remote (reads may target absolute paths outside the workspace) and follows the
 * change feed for live updates, so no custom host-to-browser channel exists.
 *
 * Freshness: a full sweep runs at mount; afterwards a poll re-checks revisions
 * (metadata only) and refolds just the sessions that moved. Service seams are
 * resolved at call time, never snapshotted at mount — the loader creates
 * same-layer entries concurrently and a mount-time read can lock in a transient
 * `undefined` forever.
 */
import { readFileSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { foldEvents, foldRows, type DayTotals, type FoldEvent, type RouteUsage } from './fold.ts'
import { newestLogFile, readSessionLogFile } from './log-file.ts'
import { resolveDshHome, StatusWriter, versionOf, type SweepSummary } from './status.ts'

/** Row id of this plugin in a profile patch. */
export const name = 'token-usage'

/** Directory of the published snapshot, relative to `$DSH_HOME`. */
export const CACHE_DIR = ['cache', 'dsh-token-usage'] as const

/** The llm-pi-ai namespace that declares provider display names. */
const PROVIDER_NAMESPACE = 'llm-pi-ai'

/** Persistence backend whose config names the sessions root. */
const SESSIONS_BACKEND = '@deepseek-ai/dsh-session-persistence-jsonl'

/** How many per-session failure reasons the status report keeps. */
const FAILURE_SAMPLES = 8

/** Config the host half reads; a plain patch object, no schema is shipped. */
export interface TokenUsageConfig {
  readonly enabled: boolean
  readonly pollSeconds: number
}

/** Read the row config with defaults. */
export function readConfig(config: unknown): TokenUsageConfig {
  const record = config === null || typeof config !== 'object' ? {} : (config as Record<string, unknown>)
  const enabled = record.enabled !== false
  const rawPoll = record.pollSeconds
  const pollSeconds =
    typeof rawPoll === 'number' && Number.isFinite(rawPoll) && rawPoll >= 5 ? Math.floor(rawPoll) : 30
  return { enabled, pollSeconds }
}

/** Structural view of the persistence seam the scanner uses. */
interface PersistenceFace {
  list: () => Promise<readonly { header: { readonly id: string }; revision?: unknown }[]>
  open: (
    id: string,
    mode: 'read',
  ) => Promise<{
    header: unknown
    read: (offset?: number, length?: number) => Promise<{ events: readonly unknown[] }>
    close: () => Promise<void>
  }>
}

/** Structural view of the settings service (provider display names). */
interface SettingsFace {
  describe: () => { readonly ns?: unknown; readonly value?: unknown }[]
}

/** Structural view of the loader (sessions root lookup). */
interface LoaderFace {
  entries: () => Iterable<{ readonly options?: { readonly name?: unknown; readonly config?: unknown } }>
}

/** One session's folded contribution, with the revision it was folded at. */
interface SessionFold {
  readonly revision: string
  readonly rows: readonly RouteUsage[]
}

/** The published snapshot's shape. */
export interface StatsSnapshot {
  readonly version: 1
  generatedAt: string
  readonly scan: {
    readonly status: 'scanning' | 'ready'
    readonly storedSessions?: number
    readonly foldedSessions?: number
    readonly skippedSessions?: number
    readonly failedSessions?: number
    readonly fallbackSessions?: number
    readonly archivedCount?: number
    readonly durationMs?: number
  }
  readonly totals?: Totals
  readonly providers?: readonly ProviderGroup[]
}

/** Bucket totals shared by the grand row, providers and models. */
interface Totals {
  inputTokens: number
  cacheReadTokens: number
  outputTokens: number
  reasoningTokens: number
  billedTokens: number
  calls: number
}

/** The counted buckets every totals shape carries. */
type BucketShape = Pick<
  RouteUsage,
  'inputTokens' | 'cacheReadTokens' | 'outputTokens' | 'reasoningTokens' | 'calls'
>

/** The per-day bucket shape one model row carries. */
type DayBuckets = Pick<
  RouteUsage,
  'inputTokens' | 'cacheReadTokens' | 'outputTokens' | 'reasoningTokens' | 'calls'
>

/** One model row of the published snapshot: totals plus the per-day series. */
type ModelRow = Totals & { readonly id: string; readonly days: Readonly<Record<string, DayBuckets>> }

/** One provider group of the published snapshot. */
interface ProviderGroup {
  readonly id: string
  readonly displayName: string
  readonly totals: Totals
  readonly models: readonly ModelRow[]
}

/** Structural view of the cordis context this plugin uses. */
interface PluginContext {
  get: (service: string) => unknown
  effect: (callback: () => () => void, label?: string) => () => void
  readonly root?: { readonly loader?: { readonly await?: () => Promise<unknown> } }
  readonly logger?: {
    warn: (message: string, ...rest: unknown[]) => void
    info: (message: string, ...rest: unknown[]) => void
    error: (message: string, ...rest: unknown[]) => void
  }
}

/** Read this package's version from the manifest next to the built entry. */
function readVersion(): string {
  return versionOf(() => readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
}

/** Read the pinned provider display names out of the pi-ai namespace. */
function readDisplayNames(settings: SettingsFace | undefined): Map<string, string> {
  const names = new Map<string, string>()
  if (settings === undefined || typeof settings.describe !== 'function') return names
  try {
    const descriptor = settings.describe().find((view) => view?.ns === PROVIDER_NAMESPACE)
    const value = descriptor?.value
    if (value === null || typeof value !== 'object') return names
    const providers = (value as Record<string, unknown>).providers
    if (providers === null || typeof providers !== 'object') return names
    for (const [id, entry] of Object.entries(providers as Record<string, unknown>)) {
      if (entry === null || typeof entry !== 'object') continue
      const displayName = (entry as Record<string, unknown>).displayName
      if (typeof displayName === 'string' && displayName.length > 0) names.set(id, displayName)
    }
  } catch {
    /* display names are cosmetic */
  }
  return names
}

/** Resolve the persistence root: the backend entry's config, then the default. */
export function resolveSessionsRoot(loader: LoaderFace | undefined, dshHome: string): string {
  try {
    for (const entry of loader?.entries() ?? []) {
      if (entry?.options?.name !== SESSIONS_BACKEND) continue
      const config = entry.options.config
      if (config === null || typeof config !== 'object') continue
      const root = (config as Record<string, unknown>).root
      if (typeof root === 'string' && root.length > 0) return root
    }
  } catch {
    /* fall through to the default */
  }
  return join(dshHome, 'sessions')
}

/** Count how many stored sessions the workspace registry marks archived. */
async function countArchived(dshHome: string, storedIds: ReadonlySet<string>): Promise<number> {
  try {
    const raw = await readFile(join(dshHome, 'storages', 'workspace.json'), 'utf8')
    const parsed = JSON.parse(raw) as { global?: { archivedSessionIds?: unknown } }
    const ids = parsed?.global?.archivedSessionIds
    if (!Array.isArray(ids)) return 0
    let count = 0
    for (const id of ids) if (typeof id === 'string' && storedIds.has(id)) count += 1
    return count
  } catch {
    return 0
  }
}

/** Sum rows into bucket totals; billed = every counted token. */
function totalsOf(rows: readonly BucketShape[]): Totals {
  let inputTokens = 0
  let cacheReadTokens = 0
  let outputTokens = 0
  let reasoningTokens = 0
  let calls = 0
  for (const row of rows) {
    inputTokens += row.inputTokens
    cacheReadTokens += row.cacheReadTokens
    outputTokens += row.outputTokens
    reasoningTokens += row.reasoningTokens
    calls += row.calls
  }
  return {
    inputTokens,
    cacheReadTokens,
    outputTokens,
    reasoningTokens,
    billedTokens: inputTokens + cacheReadTokens + outputTokens,
    calls,
  }
}

/** Build the publishable snapshot out of the per-session folds. */
export function buildSnapshot(
  sessions: Iterable<{ rows: readonly RouteUsage[] }>,
  displayNames: ReadonlyMap<string, string>,
): { totals: Totals; providers: ProviderGroup[] } {
  const byKey = new Map<string, RouteUsage>()
  for (const session of sessions) {
    for (const row of session.rows) {
      const key = row.provider + '\u0000' + row.model
      const current = byKey.get(key)
      if (current === undefined) {
        // The first sighting adopts the session row as-is: nothing merges into
        // it, and the published snapshot is a read-only view for the browser.
        byKey.set(key, row)
        continue
      }
      // Merge the day series with fresh copies, so the per-session rows that
      // stay cached for the next sweep are never mutated by aggregation.
      const days: Record<string, DayTotals> = { ...current.days }
      for (const [day, buckets] of Object.entries(row.days)) {
        const existing = days[day]
        days[day] =
          existing === undefined
            ? { ...buckets }
            : {
                inputTokens: existing.inputTokens + buckets.inputTokens,
                cacheReadTokens: existing.cacheReadTokens + buckets.cacheReadTokens,
                outputTokens: existing.outputTokens + buckets.outputTokens,
                reasoningTokens: existing.reasoningTokens + buckets.reasoningTokens,
                calls: existing.calls + buckets.calls,
              }
      }
      byKey.set(key, {
        provider: row.provider,
        model: row.model,
        inputTokens: current.inputTokens + row.inputTokens,
        cacheReadTokens: current.cacheReadTokens + row.cacheReadTokens,
        outputTokens: current.outputTokens + row.outputTokens,
        reasoningTokens: current.reasoningTokens + row.reasoningTokens,
        calls: current.calls + row.calls,
        days,
      })
    }
  }
  const rows = [...byKey.values()].sort((a, b) =>
    a.provider === b.provider ? (a.model < b.model ? -1 : 1) : a.provider < b.provider ? -1 : 1,
  )
  const providers: ProviderGroup[] = []
  for (const row of rows) {
    const last = providers[providers.length - 1]
    if (last === undefined || last.id !== row.provider) {
      providers.push({
        id: row.provider,
        displayName: displayNames.get(row.provider) ?? row.provider,
        totals: totalsOf([row]),
        models: [withId(row)],
      })
      continue
    }
    const models = [...last.models, withId(row)]
    providers[providers.length - 1] = { ...last, models, totals: totalsOf(models) }
  }
  return { totals: totalsOf(rows), providers }
}

/** Attach the model id and per-day series to one row's totals. */
function withId(row: RouteUsage): ModelRow {
  return { id: row.model, ...totalsOf([row]), days: row.days }
}

/** List the session directories under the persistence root. */
async function listSessionDirectories(sessionsRoot: string): Promise<string[]> {
  const ids: string[] = []
  let projects: string[]
  try {
    projects = await readdir(sessionsRoot)
  } catch {
    return ids
  }
  for (const project of projects) {
    const projectPath = join(sessionsRoot, project)
    let entries: string[]
    try {
      entries = await readdir(projectPath)
    } catch {
      continue
    }
    for (const entry of entries) {
      const directory = join(projectPath, entry)
      try {
        const info = await stat(directory)
        if (!info.isDirectory()) continue
      } catch {
        continue
      }
      if (newestLogFile(directory) === undefined) continue
      ids.push(entry)
    }
  }
  return ids
}

/** A cheap revision fingerprint of one session's newest log file. */
async function fileRevision(sessionsRoot: string, sessionId: string): Promise<string | undefined> {
  let projects: string[]
  try {
    projects = await readdir(sessionsRoot)
  } catch {
    return undefined
  }
  for (const project of projects) {
    const directory = join(sessionsRoot, project, sessionId)
    let file: string | undefined
    try {
      file = newestLogFile(directory)
    } catch {
      continue
    }
    if (file === undefined) continue
    try {
      const info = await stat(file)
      return `file:${info.size}:${Math.trunc(info.mtimeMs)}`
    } catch {
      return undefined
    }
  }
  return undefined
}

/** Write one JSON document atomically (tmp file + rename, best-effort). */
async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const body = JSON.stringify(value) + '\n'
  const tmp = path + '.tmp'
  try {
    await writeFile(tmp, body, 'utf8')
    await rename(tmp, path)
  } catch {
    await writeFile(path, body, 'utf8')
  }
}

/** Write the stats snapshot atomically. */
function writeStats(path: string, snapshot: StatsSnapshot): Promise<void> {
  return writeJsonAtomic(path, snapshot)
}

/**
 * The anchor file the browser half reads first.
 *
 * `remote.$host.home` is the OS user home, while the snapshot lives under
 * `$DSH_HOME` — which defaults to `<user home>/.dsh` and may be configured
 * elsewhere. The browser therefore probes `<user home>/.dsh/cache/...` and, when
 * that file is absent, follows this anchor to the real path. Writing it always
 * keeps both layouts working with one rule.
 */
export function anchorPathOf(userHome: string): string {
  return join(userHome, '.dsh', ...CACHE_DIR, 'anchor.json')
}

/** Publish the anchor beside the default harness home (best-effort). */
async function writeAnchor(userHome: string, statsPath: string): Promise<void> {
  try {
    await writeJsonAtomic(anchorPathOf(userHome), { version: 1, statsPath, updatedAt: new Date().toISOString() })
  } catch {
    /* the anchor is a convenience; the stats file is the deliverable */
  }
}

/**
 * Fold one session through the seam, falling back to the artifact reader.
 *
 * @returns the folded rows and whether the fallback served them.
 */
async function foldSession(
  persistence: PersistenceFace | undefined,
  sessionsRoot: string,
  sessionId: string,
): Promise<{ rows: RouteUsage[]; fallback: boolean }> {
  let seamFailure: unknown
  if (persistence !== undefined && typeof persistence.open === 'function') {
    try {
      const handle = await persistence.open(sessionId, 'read')
      try {
        const read = await handle.read(0, undefined)
        return { rows: foldRows(foldEvents(read.events as readonly FoldEvent[])), fallback: false }
      } finally {
        await handle.close()
      }
    } catch (error) {
      seamFailure = error
    }
  }
  try {
    const { events } = readSessionLogFile(sessionsRoot, sessionId)
    return { rows: foldRows(foldEvents(events)), fallback: true }
  } catch (error) {
    throw new Error(
      seamFailure === undefined
        ? `artifact read failed: ${String(error)}`
        : `seam read failed: ${String(seamFailure)}; artifact read failed: ${String(error)}`,
    )
  }
}

/**
 * Mount the scanner.
 * @param ctx - the host context.
 * @param config - the row's config.
 */
export function apply(ctx: PluginContext, config: unknown): void {
  const { enabled, pollSeconds } = readConfig(config)
  const dshHome = resolveDshHome()
  const statsPath = join(dshHome, ...CACHE_DIR, 'stats.json')
  const status = new StatusWriter({
    plugin: 'dsh-token-usage',
    version: readVersion(),
    activatedAt: new Date().toISOString(),
    pid: process.pid,
    dshHome,
    statsPath,
    enabled,
    pollSeconds,
  })
  status.flush()

  if (!enabled) {
    ctx.logger?.warn('dsh-token-usage: mounted with enabled off; nothing is scanned or published')
    return
  }

  ctx.effect(() => {
    let stopped = false
    let running = false
    /** Per-session folds keyed by session id, with the revision each was folded at. */
    const sessions = new Map<string, SessionFold>()
    /** True once the first complete snapshot has been published. */
    let published = false

    const sweep = async (): Promise<void> => {
      if (running || stopped) return
      running = true
      const startedAt = new Date()
      const start = Date.now()
      try {
        await (ctx.root?.loader?.await?.() ?? Promise.resolve())
        if (stopped) return
        const persistence = ctx.get('sessionPersistence') as PersistenceFace | undefined
        const loader = ctx.get('loader') as LoaderFace | undefined
        const sessionsRoot = resolveSessionsRoot(loader, dshHome)

        // Union of the seam's list and the filesystem walk: neither may hide a session.
        const listed =
          persistence !== undefined && typeof persistence.list === 'function'
            ? await persistence
                .list()
                .catch(() => [] as readonly { header: { readonly id: string }; revision?: unknown }[])
            : []
        const revisions = new Map<string, string>()
        for (const entry of listed) {
          if (typeof entry?.header?.id === 'string') revisions.set(entry.header.id, `seam:${String(entry.revision)}`)
        }
        const ids = new Set<string>(revisions.keys())
        for (const id of await listSessionDirectories(sessionsRoot)) ids.add(id)
        for (const id of [...sessions.keys()]) if (!ids.has(id)) sessions.delete(id)

        let folded = 0
        let skipped = 0
        let failed = 0
        let fallback = 0
        const failures: string[] = []
        for (const id of ids) {
          if (stopped) return
          let revision = revisions.get(id)
          if (revision === undefined) revision = await fileRevision(sessionsRoot, id)
          if (revision === undefined) revision = 'unknown'
          const known = sessions.get(id)
          if (known !== undefined && known.revision === revision) {
            skipped += 1
            continue
          }
          try {
            const result = await foldSession(persistence, sessionsRoot, id)
            if (result.fallback) fallback += 1
            sessions.set(id, { revision, rows: result.rows })
            folded += 1
          } catch (error) {
            failed += 1
            if (failures.length < FAILURE_SAMPLES) failures.push(`${id}: ${String(error)}`)
            ctx.logger?.warn(`dsh-token-usage: folding session "${id}" failed: ${String(error)}`)
          }
        }

        const settings = ctx.get('settings') as SettingsFace | undefined
        const displayNames = readDisplayNames(settings)
        const aggregate = buildSnapshot(sessions.values(), displayNames)
        const archivedCount = await countArchived(dshHome, ids)
        const durationMs = Date.now() - start
        published = true
        await writeStats(statsPath, {
          version: 1,
          generatedAt: new Date().toISOString(),
          scan: {
            status: 'ready',
            storedSessions: ids.size,
            foldedSessions: folded,
            skippedSessions: skipped,
            failedSessions: failed,
            fallbackSessions: fallback,
            archivedCount,
            durationMs,
          },
          totals: aggregate.totals,
          providers: aggregate.providers,
        })
        await writeAnchor(homedir(), statsPath)
        status.sweep({
          startedAt: startedAt.toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs,
          storedSessions: ids.size,
          foldedSessions: folded,
          skippedSessions: skipped,
          failedSessions: failed,
          fallbackSessions: fallback,
          archivedCount,
          failures,
        })
      } catch (error) {
        status.failed(`sweep failed: ${String(error)}`)
        ctx.logger?.warn(`dsh-token-usage: sweep failed: ${String(error)}`)
        if (!published) {
          await writeStats(statsPath, {
            version: 1,
            generatedAt: new Date().toISOString(),
            scan: { status: 'scanning' },
          }).catch(() => {})
        }
      } finally {
        running = false
      }
    }

    // Publish a scanning marker immediately, then run the first full sweep.
    void writeStats(statsPath, { version: 1, generatedAt: new Date().toISOString(), scan: { status: 'scanning' } })
      .catch(() => {})
      .then(() => sweep())
    const interval = setInterval(() => {
      if (!running) void sweep()
    }, pollSeconds * 1000)

    return () => {
      stopped = true
      clearInterval(interval)
    }
  }, 'dsh-token-usage: corpus scanner')
}

export { foldEvents, foldRows } from './fold.ts'
export { decodeArtifact, frameSpans, newestLogFile, readSessionLogFile } from './log-file.ts'
export type { RouteUsage, FoldEvent, FoldState } from './fold.ts'
