/**
 * The browser-side source of the published stats snapshot.
 *
 * The host half writes $DSH_HOME/cache/dsh-token-usage/stats.json. The page
 * cannot read files directly, but the shipped workspace-files Remote can: reads
 * may target absolute paths outside the workspace, executed against a session's
 * composed filesystem, and `changes` watches the same target. So this source:
 *
 * 1. derives candidate paths from `remote.$host.home` — which is the OS user
 *    home, so the primary candidate anchors at `<home>/.dsh`, the default
 *    harness home; an `anchor.json` written by the host beside its real cache
 *    carries the true path when `$DSH_HOME` is configured elsewhere;
 * 2. picks a session id from `remote.session.list` (any stored session serves
 *    an absolute-path read; a live one with a cwd is preferred);
 * 3. reads the first candidate that yields a valid snapshot, parses it, publishes;
 * 4. follows that file through a `$stream` watch and re-reads on change, with a
 *    debounce and a reconnecting loop.
 *
 * Lifecycle follows the page: the first subscriber activates the read/watch
 * loop, the last unsubscriber suspends it, and a remount restarts it. The last
 * published state survives suspension so a remounted page paints immediately.
 *
 * Exposed as one observable the settings shell binds into a `useStats` hook.
 */

/** A RemoteResult-shaped answer, read structurally to avoid a value import. */
type RemoteResult<T> = { ok: true; value: T } | { ok: false; error: { code?: string; message?: string } }

/** One watch frame of the workspace-files change feed. */
interface WatchFrame {
  readonly kind: 'ready' | 'change'
}

/** The snapshot the host publishes; fields the page needs, read structurally. */
export interface StatsSnapshot {
  readonly version?: number
  readonly generatedAt?: string
  readonly scan?: {
    readonly status?: 'scanning' | 'ready'
    readonly storedSessions?: number
    readonly foldedSessions?: number
    readonly failedSessions?: number
    readonly archivedCount?: number
    readonly durationMs?: number
  }
  readonly totals?: unknown
  readonly providers?: unknown
}

/** The slice of the browser Remote face this source uses. */
export interface RemoteFace {
  readonly $host: { readonly home: string | undefined }
  readonly session: { list: (request?: unknown, signal?: AbortSignal) => Promise<RemoteResult<{ items: readonly { readonly sessionId: string; readonly cwd?: string; readonly origin?: string; readonly running?: boolean }[] }>> }
  readonly workspaceFiles: {
    /** The gateway validates exact business arity: session, path and range are all required. */
    read: (
      sessionId: string,
      path: string,
      range: { readonly offset?: number; readonly limit?: number },
      signal?: AbortSignal,
    ) => Promise<RemoteResult<{ readonly text: string; readonly eof: boolean }>>
    changes: (sessionId: string, path: string, signal: AbortSignal) => AsyncIterable<WatchFrame>
  }
  readonly $stream: <T>(options: {
    readonly name: string
    readonly open: (signal: AbortSignal) => AsyncIterable<T>
    readonly ended: (accepted: boolean) => Error
  }) => AsyncIterable<{ readonly value: T; accept(): void }> & { dispose(): Promise<void> }
}

/** What the page renders. */
export type StatsState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly snapshot: StatsSnapshot }
  | { readonly status: 'error'; readonly reason: string }

/**
 * The paths the page probes inside the host home.
 *
 * `remote.$host.home` is the OS user home (the host registers its remote-event
 * source with `{ home: homedir() }`), NOT `$DSH_HOME`. So the primary path
 * anchors at the default harness home `<home>/.dsh`; the anchor file, which the
 * host half always writes beside its real cache, carries the true stats path
 * for installations whose `$DSH_HOME` lives elsewhere.
 */
export function statsPathsOf(home: string): { primary: string; anchor: string; legacy: string } {
  const normalized = home.replace(/[\\/]+$/, '')
  const dir = normalized + '/.dsh/cache/dsh-token-usage'
  return { primary: dir + '/stats.json', anchor: dir + '/anchor.json', legacy: normalized + '/cache/dsh-token-usage/stats.json' }
}

/** Pick the session that serves the absolute-path read. */
export function pickSession(
  items: readonly { readonly sessionId: string; readonly cwd?: string; readonly origin?: string; readonly running?: boolean }[],
): string | undefined {
  return (
    items.find((item) => item.running === true && typeof item.cwd === 'string')?.sessionId ??
    items.find((item) => typeof item.cwd === 'string')?.sessionId ??
    items[0]?.sessionId
  )
}

/** Debounce window for watch-triggered re-reads. */
const REREAD_DEBOUNCE_MS = 400

/** Watch reconnect delay after a failure. */
const WATCH_RETRY_MS = 10_000

/** Reconnect delay after a clean watch end. */
const WATCH_RECONNECT_MS = 500

/** One candidate read's outcome. */
type ProbeResult =
  | { readonly kind: 'ok'; readonly snapshot: StatsSnapshot }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'error'; readonly reason: string }

/**
 * The observable controller. The first subscriber activates it, the last one
 * suspends it; `reload()` forces an immediate read.
 */
export class StatsSource {
  readonly #remote: RemoteFace
  #state: StatsState = { status: 'loading' }
  #listeners = new Set<() => void>()
  #active = false
  #home: string | undefined
  #sessionId: string | undefined
  /** The candidate path that last yielded a valid snapshot; watched while active. */
  #resolvedPath: string | undefined
  #reloadTimer: ReturnType<typeof setTimeout> | undefined
  #watchAbort: AbortController | undefined
  #readGeneration = 0

  constructor(remote: RemoteFace) {
    this.#remote = remote
  }

  getSnapshot(): StatsState {
    return this.#state
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    if (this.#listeners.size === 1) this.#activate()
    return () => {
      this.#listeners.delete(listener)
      if (this.#listeners.size === 0) this.#suspend()
    }
  }

  /** Whether the read/watch loop is currently active. */
  isActive(): boolean {
    return this.#active
  }

  /** Force an immediate re-read (the refresh button). */
  reload(): void {
    if (!this.#active) this.#activate()
    else if (this.#sessionId !== undefined && this.#home !== undefined) void this.#resolveAndRead()
  }

  #activate(): void {
    if (this.#active) return
    this.#active = true
    void this.#bootstrap()
  }

  #suspend(): void {
    if (!this.#active) return
    this.#active = false
    if (this.#reloadTimer !== undefined) clearTimeout(this.#reloadTimer)
    this.#reloadTimer = undefined
    this.#watchAbort?.abort()
    this.#watchAbort = undefined
    this.#readGeneration += 1
  }

  async #bootstrap(): Promise<void> {
    if (!this.#active) return
    const home = this.#remote.$host?.home
    if (typeof home !== 'string' || home.length === 0) {
      this.#publish({ status: 'error', reason: 'no-home' })
      return
    }
    this.#home = home
    try {
      const listed = await this.#remote.session.list({})
      if (!this.#active) return
      if (!listed.ok) {
        this.#publish({ status: 'error', reason: 'session-list: ' + (listed.error.message ?? listed.error.code ?? 'failed') })
        return
      }
      this.#sessionId = pickSession(listed.value.items)
      if (this.#sessionId === undefined) {
        this.#publish({ status: 'error', reason: 'no-session' })
        return
      }
    } catch (error) {
      if (!this.#active) return
      this.#publish({ status: 'error', reason: 'session-list: ' + String(error) })
      return
    }
    await this.#resolveAndRead()
    if (this.#active) void this.#watchLoop()
  }

  /** Read one candidate path and classify the outcome. */
  async #probe(path: string, generation: number): Promise<ProbeResult> {
    const sessionId = this.#sessionId
    if (sessionId === undefined) return { kind: 'error', reason: 'no-session' }
    let text: string
    try {
      // An empty range reads the whole file; the argument itself is mandatory.
      const read = await this.#remote.workspaceFiles.read(sessionId, path, {})
      if (generation !== this.#readGeneration) return { kind: 'not-found' }
      if (!read.ok) {
        const code = read.error.code ?? 'failed'
        return code === 'workspace-file/not-found' ? { kind: 'not-found' } : { kind: 'error', reason: 'read: ' + code }
      }
      text = read.value.text
    } catch (error) {
      return { kind: 'error', reason: 'read: ' + String(error) }
    }
    try {
      const parsed = JSON.parse(text) as StatsSnapshot & { statsPath?: unknown }
      if (parsed?.version === 1) return { kind: 'ok', snapshot: parsed }
      return { kind: 'error', reason: 'bad-data: unsupported snapshot version' }
    } catch (error) {
      return { kind: 'error', reason: 'bad-data: ' + String(error) }
    }
  }

  /**
   * Walk the candidates: the default-anchored path first, then the anchor file
   * (which names the real path), then the legacy guess. The winner becomes the
   * watched path.
   */
  async #resolveAndRead(): Promise<void> {
    const home = this.#home
    if (home === undefined) return
    const generation = ++this.#readGeneration
    const paths = statsPathsOf(home)
    const home_ = this.#remote.$host.home as string
    void home_

    // 1) The default-anchored stats file (the common case).
    const primary = await this.#probe(paths.primary, generation)
    if (!this.#active || generation !== this.#readGeneration) return
    if (primary.kind === 'ok') {
      this.#resolvedPath = paths.primary
      this.#publish({ status: 'ready', snapshot: primary.snapshot })
      return
    }
    if (primary.kind === 'error') {
      // A file that exists but cannot be read or parsed: report it instead of
      // hunting further candidates, because the host did publish something.
      this.#publish({ status: 'error', reason: primary.reason })
      return
    }

    // 2) The anchor file: a custom $DSH_HOME install points at its real cache.
    const anchor = await this.#probeAnchor(paths.anchor, generation)
    if (!this.#active || generation !== this.#readGeneration) return
    if (anchor.kind === 'ok') {
      this.#resolvedPath = anchor.path
      this.#publish({ status: 'ready', snapshot: anchor.snapshot })
      return
    }
    if (anchor.kind === 'error') {
      this.#publish({ status: 'error', reason: anchor.reason })
      return
    }

    // 3) The legacy guess (a host build that assumed home === $DSH_HOME).
    const legacy = await this.#probe(paths.legacy, generation)
    if (!this.#active || generation !== this.#readGeneration) return
    if (legacy.kind === 'ok') {
      this.#resolvedPath = paths.legacy
      this.#publish({ status: 'ready', snapshot: legacy.snapshot })
      return
    }
    if (legacy.kind === 'error') {
      this.#publish({ status: 'error', reason: legacy.reason })
      return
    }

    this.#publish({ status: 'error', reason: 'not-found' })
  }

  /** Read the anchor file and follow the absolute path it names. */
  async #probeAnchor(
    anchorPath: string,
    generation: number,
  ): Promise<{ kind: 'ok'; snapshot: StatsSnapshot; path: string } | { kind: 'not-found' } | { kind: 'error'; reason: string }> {
    const sessionId = this.#sessionId
    if (sessionId === undefined) return { kind: 'error', reason: 'no-session' }
    let text: string
    try {
      const read = await this.#remote.workspaceFiles.read(sessionId, anchorPath, {})
      if (generation !== this.#readGeneration) return { kind: 'not-found' }
      if (!read.ok) {
        const code = read.error.code ?? 'failed'
        return code === 'workspace-file/not-found' ? { kind: 'not-found' } : { kind: 'error', reason: 'read anchor: ' + code }
      }
      text = read.value.text
    } catch (error) {
      return { kind: 'error', reason: 'read anchor: ' + String(error) }
    }
    let statsPath: unknown
    try {
      statsPath = (JSON.parse(text) as { statsPath?: unknown }).statsPath
    } catch (error) {
      return { kind: 'error', reason: 'bad anchor: ' + String(error) }
    }
    if (typeof statsPath !== 'string' || statsPath.length === 0) {
      return { kind: 'error', reason: 'bad anchor: no statsPath' }
    }
    const stats = await this.#probe(statsPath, generation)
    if (stats.kind === 'ok') return { kind: 'ok', snapshot: stats.snapshot, path: statsPath }
    if (stats.kind === 'not-found') return { kind: 'not-found' }
    return stats
  }

  async #watchLoop(): Promise<void> {
    while (this.#active) {
      const sessionId = this.#sessionId
      const home = this.#home
      if (sessionId === undefined || home === undefined) return
      const watchPath = this.#resolvedPath ?? statsPathsOf(home).primary
      const controller = new AbortController()
      this.#watchAbort = controller
      const stream = this.#remote.$stream({
        name: 'token-usage stats',
        open: (signal) => this.#remote.workspaceFiles.changes(sessionId, watchPath, signal),
        ended: () => new Error('stats watch ended'),
      })
      const abort = () => {
        void stream.dispose()
      }
      controller.signal.addEventListener('abort', abort, { once: true })
      let failed = false
      try {
        for await (const item of stream) {
          if (!this.#active || controller.signal.aborted) break
          item.accept()
          if (item.value.kind === 'change') this.#scheduleReload()
        }
      } catch {
        failed = true
      } finally {
        controller.signal.removeEventListener('abort', abort)
        await stream.dispose().catch(() => {})
      }
      if (!this.#active) return
      // A watch that ended without failure reconnects immediately; a failure backs off.
      await delay(failed ? WATCH_RETRY_MS : WATCH_RECONNECT_MS)
    }
  }

  #scheduleReload(): void {
    if (this.#reloadTimer !== undefined) return
    this.#reloadTimer = setTimeout(() => {
      this.#reloadTimer = undefined
      if (this.#active) void this.#resolveAndRead()
    }, REREAD_DEBOUNCE_MS)
  }

  #publish(state: StatsState): void {
    this.#state = state
    for (const listener of [...this.#listeners]) listener()
  }
}

/** Promise-based delay that never rejects. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
