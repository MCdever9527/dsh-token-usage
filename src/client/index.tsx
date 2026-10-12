/**
 * Browser half of dsh-token-usage.
 *
 * One Settings section beside General, Models and Plugins: the host half's
 * published aggregate ($DSH_HOME/cache/dsh-token-usage/stats.json) rendered as
 * provider-by-model token totals. The section's inject face carries the stats
 * observable (bound into the `useStats` hook by the settings renderer) and a
 * `reload` action for the refresh button.
 *
 * The data path is all shipped surface: `remote.$host.home` for the path,
 * `remote.session.list` for a session identity, `remote.workspaceFiles`
 * read/watch for the file itself. No custom host-to-browser channel exists.
 */
import type { ComponentType } from 'react'
import { TokenUsagePage } from './page.tsx'
import { StatsSource, type RemoteFace } from './stats-source.ts'
import { en, zh } from './locales.ts'

/** Dictionary namespace owned by this plugin; also the settings section id. */
export const NS = 'token-usage'

/**
 * Settings navigation order.
 *
 * The shipped sections are General, Models (10) and Plugins (15);
 * dsh-subagent-model takes 16, dsh-mcp-tools 17 and dsh-model-fields 18, so
 * this one follows them.
 */
export const SECTION_ORDER = 19

/** Required browser services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'remote', 'remote.session', 'remote.workspaceFiles']

/** Minimal structural view of the browser plugin context. */
interface ClientContext {
  readonly locale: {
    bind: (ns: string) => (key: string) => string
    register: (ns: string, dictionaries: { zh: Record<string, string>; en: Record<string, string> }) => unknown
  }
  readonly remote: RemoteFace
  readonly slots: {
    inject: (name: string, callback: () => unknown) => unknown
    register: (options: Record<string, unknown>, component: ComponentType<never>) => unknown
  }
  effect: (callback: () => unknown, label?: string) => () => void
}

/**
 * Take the Token-usage settings section.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-token-usage: dictionaries')

  const source = new StatsSource(ctx.remote)

  ctx.effect(
    () =>
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: NS,
            order: SECTION_ORDER,
            label: () => t('nav'),
            locale: NS,
            inject: () => ({
              hooks: { stats: source },
              reload: () => source.reload(),
            }),
          },
          TokenUsagePage as unknown as ComponentType<never>,
        ),
      ),
    'dsh-token-usage: settings section',
  )
}

export { StatsSource, statsPathsOf, pickSession } from './stats-source.ts'
export type { RemoteFace, StatsState, StatsSnapshot } from './stats-source.ts'
export { TokenUsagePage, viewForRange } from './page.tsx'
export { USAGE_RANGES, dayKeyOf, dayInRange, startDayOf, sumDays, billedOf } from './range.ts'
export type { UsageRange, DayBuckets } from './range.ts'
