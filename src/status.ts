/**
 * The activation report for dsh-token-usage: one small JSON file under
 * `$DSH_HOME/cache` that says whether the scanner mounted, which services it
 * resolved, and how the last sweep went.
 *
 * "The plugin did nothing" must stay distinguishable from "the plugin never
 * mounted". Diagnostics never affect behaviour: every write is best-effort and
 * swallowed on failure.
 */
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Directory of the activation report, relative to `$DSH_HOME`. */
export const STATUS_DIR = ['cache', 'dsh-token-usage'] as const

/** Everything the report carries. */
export interface StatusReport {
  readonly plugin: 'dsh-token-usage'
  readonly version: string
  readonly activatedAt: string
  readonly pid: number
  readonly dshHome: string
  readonly statsPath: string
  readonly enabled: boolean
  readonly pollSeconds: number
  readonly lastSweep?: SweepSummary
  readonly error?: string
}

/** How one sweep of the corpus went. */
export interface SweepSummary {
  readonly startedAt: string
  readonly finishedAt: string
  readonly durationMs: number
  readonly storedSessions: number
  readonly foldedSessions: number
  readonly skippedSessions: number
  readonly failedSessions: number
  /** How many sessions the official seam could not serve and the artifact reader did. */
  readonly fallbackSessions?: number
  readonly archivedCount: number
  /** Bounded sample of per-session failure reasons, for diagnosis. */
  readonly failures?: readonly string[]
}

/**
 * Resolve the harness home directory the way the host does.
 * @returns the absolute `$DSH_HOME`, falling back to `~/.dsh`.
 */
export function resolveDshHome(): string {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv
  return join(homedir(), '.dsh')
}

/** Read this package's version from the manifest next to the built entry. */
export function versionOf(read: () => string): string {
  try {
    return String(JSON.parse(read()).version ?? 'unknown')
  } catch {
    return 'unknown'
  }
}

/** Best-effort activation report writer. */
export class StatusWriter {
  #path: string
  #base: Omit<StatusReport, 'lastSweep' | 'error'>
  #sweep: SweepSummary | undefined
  #error: string | undefined
  #pending: Promise<void> | undefined

  constructor(base: Omit<StatusReport, 'lastSweep' | 'error'>) {
    this.#base = base
    this.#path = join(base.dshHome, ...STATUS_DIR, 'stats-status.json')
  }

  /** Snapshot the report as it stands. */
  report(): StatusReport {
    return {
      ...this.#base,
      ...(this.#sweep === undefined ? {} : { lastSweep: this.#sweep }),
      ...(this.#error === undefined ? {} : { error: this.#error }),
    }
  }

  /** Replace the sweep summary and flush. */
  sweep(summary: SweepSummary): void {
    this.#sweep = summary
    this.#error = undefined
    this.flush()
  }

  /** Record the failure of the latest sweep and flush. */
  failed(reason: string): void {
    this.#error = reason
    this.flush()
  }

  /** Write the report once, coalescing concurrent callers. */
  flush(): void {
    if (this.#pending !== undefined) return
    this.#pending = this.#write().finally(() => {
      this.#pending = undefined
    })
  }

  /** Await the in-flight write, if any. */
  settle(): Promise<void> {
    return this.#pending ?? Promise.resolve()
  }

  async #write(): Promise<void> {
    try {
      await mkdir(join(this.#base.dshHome, ...STATUS_DIR), { recursive: true })
      await writeFile(this.#path, `${JSON.stringify(this.report(), null, 2)}\n`, 'utf8')
    } catch {
      /* diagnostics only */
    }
  }
}

/** Remove the diagnostics of a previous activation (used by tests). */
export async function clearStatus(dshHome: string): Promise<void> {
  await rm(join(dshHome, ...STATUS_DIR, 'stats-status.json'), { force: true })
}
