/**
 * The Token-usage settings page.
 *
 * One table per provider, one row per model, fed by the host's published
 * snapshot ($DSH_HOME/cache/dsh-token-usage/stats.json) through the
 * workspace-files Remote. The host rescans the corpus periodically and rewrites
 * the file; the page's watch stream re-reads on change, so numbers follow
 * running sessions without a manual refresh (the button forces one anyway).
 *
 * Every row carries a per-day bucket series, so the date windows (today, 3, 7,
 * 30 days, all) are pure client-side sums over that series — switching a window
 * never asks the host for anything.
 */
import { useMemo, useState, type ReactElement } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  USAGE_RANGES,
  billedOf,
  sumDays,
  type DayBuckets,
  type UsageRange,
} from './range.ts'
import { type StatsState } from './stats-source.ts'

/** One model row as the snapshot serves it. */
interface ModelRow extends DayBuckets {
  readonly id: string
  readonly billedTokens: number
  readonly days?: Readonly<Record<string, DayBuckets>>
}

/** One provider group as the snapshot serves it. */
interface ProviderGroup {
  readonly id: string
  readonly displayName: string
  readonly totals: ModelRow
  readonly models: readonly ModelRow[]
}

/** The snapshot the page renders. */
interface Snapshot {
  readonly version: 1
  readonly generatedAt: string
  readonly scan: {
    readonly status: 'scanning' | 'ready'
    readonly storedSessions?: number
    readonly foldedSessions?: number
    readonly failedSessions?: number
    readonly archivedCount?: number
    readonly durationMs?: number
  }
  readonly totals?: ModelRow
  readonly providers?: readonly ProviderGroup[]
}

/** Props the slot entry injects. */
export interface PageProps {
  readonly t: (key: string, params?: Record<string, unknown>) => string
  readonly useStats: (selector: (state: StatsState) => StatsState) => StatsState
  readonly reload: () => void
}

/** Theme-token styles only, so both themes render unchanged. */
const STYLES = [
  '.tua-page { display: flex; flex-direction: column; gap: 16px; max-width: 860px; }',
  '.tua-heading { margin: 0; font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary); }',
  '.tua-intro { margin: 0; font-size: 11px; line-height: 1.6; color: var(--dsw-alias-label-tertiary); }',
  '.tua-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }',
  '.tua-ranges { display: inline-flex; align-items: center; gap: 4px; margin-right: auto; }',
  '.tua-rangesLabel { font-size: 11px; color: var(--dsw-alias-label-tertiary); margin-right: 2px; }',
  '.tua-rangeActive { outline: 2px solid var(--dsw-alias-label-tertiary); outline-offset: -2px; border-radius: var(--dsw-alias-radius-md, 8px); }',
  '.tua-meta { display: flex; gap: 12px; flex-wrap: wrap; font-size: 11px; color: var(--dsw-alias-label-tertiary); }',
  '.tua-metaItem { display: inline-flex; gap: 4px; }',
  '.tua-grand { display: flex; flex-direction: column; gap: 6px; padding: 12px 14px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-alias-radius-md, 8px); }',
  '.tua-grandLabel { font-size: 11px; color: var(--dsw-alias-label-tertiary); }',
  '.tua-grandNumbers { display: flex; gap: 18px; flex-wrap: wrap; }',
  '.tua-grandItem { display: flex; flex-direction: column; gap: 2px; }',
  '.tua-grandValue { font-size: 14px; font-weight: 600; color: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums; }',
  '.tua-grandKey { font-size: 10px; color: var(--dsw-alias-label-tertiary); }',
  '.tua-provider { display: flex; flex-direction: column; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-alias-radius-md, 8px); overflow: hidden; }',
  '.tua-providerHead { display: flex; align-items: center; gap: 8px; width: 100%; box-sizing: border-box; padding: 10px 12px; margin: 0; border: none; background: none; font: inherit; text-align: left; cursor: pointer; }',
  '.tua-providerHead:hover { background: var(--dsw-alias-bg-layer-3); }',
  '.tua-providerHead:focus-visible { outline: 2px solid var(--dsw-alias-label-tertiary); outline-offset: -2px; }',
  '.tua-chevron { flex: none; width: 6px; height: 6px; margin: 0 4px; border-right: 1.5px solid var(--dsw-alias-label-tertiary); border-bottom: 1.5px solid var(--dsw-alias-label-tertiary); transform: rotate(-45deg); transition: transform 0.12s ease; }',
  '.tua-chevronOpen { transform: rotate(45deg); }',
  '.tua-providerName { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary); }',
  '.tua-providerId { min-width: 0; font-size: 11px; color: var(--dsw-alias-label-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
  '.tua-providerTotal { flex: none; margin-left: auto; font-size: 11px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }',
  '.tua-table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }',
  '.tua-table th, .tua-table td { padding: 6px 12px; font-size: 11px; text-align: right; white-space: nowrap; }',
  '.tua-table th { color: var(--dsw-alias-label-tertiary); font-weight: 500; border-top: 1px solid var(--dsw-alias-border-l2); }',
  '.tua-table td { color: var(--dsw-alias-label-primary); border-top: 1px solid var(--dsw-alias-border-l1); }',
  '.tua-table th:first-child, .tua-table td:first-child { text-align: left; }',
  '.tua-modelName { color: var(--dsw-alias-label-primary); }',
  '.tua-subtotal td { color: var(--dsw-alias-label-secondary); font-weight: 600; }',
  '.tua-status { font-size: 11px; color: var(--dsw-alias-label-tertiary); }',
  '.tua-error { font-size: 11px; color: #d93025; line-height: 1.6; }',
].join('\n')

/** Compact number: 1.2k / 3.4M / 5.6B, exact value in the tooltip. */
function formatCount(value: number): string {
  if (!Number.isFinite(value)) return String(value)
  if (value >= 1_000_000_000) return trim(value / 1_000_000_000) + 'B'
  if (value >= 1_000_000) return trim(value / 1_000_000) + 'M'
  if (value >= 10_000) return trim(value / 1_000) + 'k'
  return value.toLocaleString()
}

/** Two significant decimals at most. */
function trim(value: number): string {
  const text = value.toFixed(2)
  return text.replace(/\.?0+$/, '')
}

/** Cache-hit share of prompt tokens. */
function cacheHit(row: { cacheReadTokens: number; inputTokens: number }): string {
  const prompt = row.inputTokens + row.cacheReadTokens
  if (prompt <= 0) return '—'
  return Math.round((row.cacheReadTokens / prompt) * 100) + '%'
}

/** Local time for the snapshot stamp. */
function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString()
}

/** Zeroed buckets. */
function zeroBuckets(): DayBuckets {
  return { inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, reasoningTokens: 0, calls: 0 }
}

/** One model of the filtered view. */
interface ViewModel extends DayBuckets {
  readonly id: string
  readonly billedTokens: number
}

/** One provider of the filtered view. */
interface ViewProvider {
  readonly id: string
  readonly displayName: string
  readonly totals: ViewModel
  readonly models: readonly ViewModel[]
}

/** The whole filtered view for the selected window. */
interface RangeView {
  readonly providers: readonly ViewProvider[]
  readonly totals: ViewModel
}

/**
 * Sum every model's day series inside the window, dropping models and providers
 * the window never touched.
 * @param groups - the snapshot's provider groups.
 * @param range - the selected window.
 * @param now - the reference instant for calendar-day arithmetic.
 */
export function viewForRange(groups: readonly ProviderGroup[], range: UsageRange, now: Date): RangeView {
  const providers: ViewProvider[] = []
  const totals = zeroBuckets()
  for (const group of groups) {
    const models: ViewModel[] = []
    const groupTotals = zeroBuckets()
    for (const model of group.models) {
      // The all-time view reads the row totals directly, so it stays correct
      // even against a snapshot whose per-day series has not been rebuilt yet;
      // windowed views are sums over the day series.
      const buckets =
        range === 'all'
          ? {
              inputTokens: model.inputTokens,
              cacheReadTokens: model.cacheReadTokens,
              outputTokens: model.outputTokens,
              reasoningTokens: model.reasoningTokens,
              calls: model.calls,
            }
          : sumDays(model.days, range, now)
      if (buckets.calls === 0) continue
      const row: ViewModel = { id: model.id, ...buckets, billedTokens: billedOf(buckets) }
      models.push(row)
      groupTotals.inputTokens += buckets.inputTokens
      groupTotals.cacheReadTokens += buckets.cacheReadTokens
      groupTotals.outputTokens += buckets.outputTokens
      groupTotals.reasoningTokens += buckets.reasoningTokens
      groupTotals.calls += buckets.calls
    }
    if (models.length === 0) continue
    const row: ViewModel = { id: group.id, ...groupTotals, billedTokens: billedOf(groupTotals) }
    providers.push({ id: group.id, displayName: group.displayName, totals: row, models })
    totals.inputTokens += groupTotals.inputTokens
    totals.cacheReadTokens += groupTotals.cacheReadTokens
    totals.outputTokens += groupTotals.outputTokens
    totals.reasoningTokens += groupTotals.reasoningTokens
    totals.calls += groupTotals.calls
  }
  return { providers, totals: { id: 'total', ...totals, billedTokens: billedOf(totals) } }
}

/** One provider's collapsible section. */
function ProviderSection(props: { readonly group: ViewProvider; readonly t: (key: string, params?: Record<string, unknown>) => string; readonly expanded: boolean; readonly onToggle: () => void }) {
  const { group, t, expanded, onToggle } = props
  return (
    <section className="tua-provider">
      <button type="button" className="tua-providerHead" aria-expanded={expanded} onClick={onToggle}>
        <span className={expanded ? 'tua-chevron tua-chevronOpen' : 'tua-chevron'} />
        <span className="tua-providerName">{group.displayName}</span>
        {group.displayName !== group.id ? <span className="tua-providerId">{group.id}</span> : null}
        <span className="tua-providerTotal" title={t('totals.billed')}>
          {formatCount(group.totals.billedTokens)}
        </span>
      </button>
      {expanded ? (
        <table className="tua-table">
          <thead>
            <tr>
              <th>{t('model')}</th>
              <th>{t('totals.input')}</th>
              <th>{t('totals.cacheRead')}</th>
              <th>{t('totals.output')}</th>
              <th>{t('totals.billed')}</th>
              <th>{t('totals.hit')}</th>
              <th>{t('totals.calls')}</th>
            </tr>
          </thead>
          <tbody>
            {group.models.map((model) => (
              <tr key={model.id}>
                <td className="tua-modelName">{model.id}</td>
                <td title={model.inputTokens.toLocaleString()}>{formatCount(model.inputTokens)}</td>
                <td title={model.cacheReadTokens.toLocaleString()}>{formatCount(model.cacheReadTokens)}</td>
                <td title={model.outputTokens.toLocaleString()}>{formatCount(model.outputTokens)}</td>
                <td title={model.billedTokens.toLocaleString()}>{formatCount(model.billedTokens)}</td>
                <td>{cacheHit(model)}</td>
                <td title={model.calls.toLocaleString()}>{formatCount(model.calls)}</td>
              </tr>
            ))}
            <tr className="tua-subtotal">
              <td>{t('provider.total')}</td>
              <td title={group.totals.inputTokens.toLocaleString()}>{formatCount(group.totals.inputTokens)}</td>
              <td title={group.totals.cacheReadTokens.toLocaleString()}>{formatCount(group.totals.cacheReadTokens)}</td>
              <td title={group.totals.outputTokens.toLocaleString()}>{formatCount(group.totals.outputTokens)}</td>
              <td title={group.totals.billedTokens.toLocaleString()}>{formatCount(group.totals.billedTokens)}</td>
              <td>{cacheHit(group.totals)}</td>
              <td title={group.totals.calls.toLocaleString()}>{formatCount(group.totals.calls)}</td>
            </tr>
          </tbody>
        </table>
      ) : null}
    </section>
  )
}

/** The grand-total card for the filtered window. */
function GrandTotals(props: { readonly totals: ViewModel; readonly t: (key: string, params?: Record<string, unknown>) => string }) {
  const { totals, t } = props
  const items: readonly { readonly value: number; readonly key: string }[] = [
    { value: totals.inputTokens, key: 'totals.input' },
    { value: totals.cacheReadTokens, key: 'totals.cacheRead' },
    { value: totals.outputTokens, key: 'totals.output' },
    { value: totals.billedTokens, key: 'totals.billed' },
    { value: totals.calls, key: 'totals.calls' },
  ]
  return (
    <div className="tua-grand">
      <span className="tua-grandLabel">{t('grand.total')}</span>
      <div className="tua-grandNumbers">
        {items.map((item) => (
          <div className="tua-grandItem" key={item.key}>
            <span className="tua-grandValue" title={item.value.toLocaleString()}>{formatCount(item.value)}</span>
            <span className="tua-grandKey">{t(item.key)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** The page. */
export function TokenUsagePage(props: PageProps): ReactElement {
  const { t, useStats, reload } = props
  // The shell binds this hook through useSyncExternalStoreWithSelector, whose
  // selector is mandatory — calling it without one throws on first render.
  const state = useStats((value: StatsState) => value) as StatsState
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [range, setRange] = useState<UsageRange>('all')
  const snapshot: Snapshot | undefined = state.status === 'ready' ? (state.snapshot as unknown as Snapshot) : undefined
  const groups = useMemo(() => snapshot?.providers ?? [], [snapshot])
  // The reference instant is re-taken whenever the snapshot changes, so a page
  // left open across midnight re-anchors on the next host rewrite.
  const now = useMemo(() => new Date(), [snapshot])
  const view = useMemo(() => viewForRange(groups, range, now), [groups, range, now])

  if (state.status === 'loading') {
    return (
      <div className="tua-page">
        <style>{STYLES}</style>
        <p className="tua-status">{t('status.loading')}</p>
      </div>
    )
  }

  if (state.status === 'error') {
    const reason = state.reason
    let text: string
    if (reason === 'no-home') text = t('status.noHome')
    else if (reason === 'no-session') text = t('status.noSession')
    else if (reason === 'not-found') text = t('status.notFound')
    else if (reason.startsWith('read: ')) text = t('status.readFailed', { reason: reason.slice(6) })
    else if (reason.startsWith('bad-data: ')) text = t('status.badData', { reason: reason.slice(10) })
    else text = t('status.readFailed', { reason })
    return (
      <div className="tua-page">
        <style>{STYLES}</style>
        <p className="tua-error">{text}</p>
      </div>
    )
  }

  const scan = snapshot?.scan
  if (snapshot !== undefined && scan !== undefined && scan.status === 'scanning') {
    return (
      <div className="tua-page">
        <style>{STYLES}</style>
        <p className="tua-status">{t('status.scanning')}</p>
      </div>
    )
  }

  if (snapshot === undefined || groups.length === 0) {
    return (
      <div className="tua-page">
        <style>{STYLES}</style>
        <p className="tua-status">{t('status.empty')}</p>
      </div>
    )
  }

  const toggle = (id: string): void => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const allCollapsed = view.providers.every((group) => collapsed.has(group.id))

  return (
    <div className="tua-page">
      <style>{STYLES}</style>
      <h2 className="tua-heading">{t('title')}</h2>
      <p className="tua-intro">{t('intro')}</p>

      <div className="tua-toolbar">
        <div className="tua-ranges" role="group" aria-label={t('range.label')}>
          <span className="tua-rangesLabel">{t('range.label')}</span>
          {USAGE_RANGES.map((option) => (
            <Button key={option} onClick={() => setRange(option)}>
              <span className={option === range ? 'tua-rangeActive' : undefined}>{t('range.' + option)}</span>
            </Button>
          ))}
        </div>
        <Button onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(view.providers.map((group) => group.id)))}>
          {allCollapsed ? t('expand.all') : t('collapse.all')}
        </Button>
        <Button onClick={reload}>{t('refresh')}</Button>
      </div>

      <div className="tua-meta">
        <span className="tua-metaItem">{t('updated', { time: formatTime(snapshot.generatedAt) })}</span>
        {scan?.storedSessions !== undefined ? (
          <span className="tua-metaItem">{t('sessions', { count: scan.storedSessions })}</span>
        ) : null}
        {scan?.archivedCount !== undefined && scan.archivedCount > 0 ? (
          <span className="tua-metaItem">{t('archived', { count: scan.archivedCount })}</span>
        ) : null}
        {scan?.durationMs !== undefined ? (
          <span className="tua-metaItem">{t('scan.duration', { seconds: (scan.durationMs / 1000).toFixed(1) + 's' })}</span>
        ) : null}
        {scan?.failedSessions !== undefined && scan.failedSessions > 0 ? (
          <span className="tua-metaItem">{t('scan.failed', { count: scan.failedSessions })}</span>
        ) : null}
      </div>

      {view.providers.length === 0 ? (
        <p className="tua-status">{t('status.emptyRange', { range: t('range.' + range) })}</p>
      ) : (
        <>
          <GrandTotals totals={view.totals} t={t} />
          {view.providers.map((group) => (
            <ProviderSection
              key={group.id}
              group={group}
              t={t}
              expanded={!collapsed.has(group.id)}
              onToggle={() => toggle(group.id)}
            />
          ))}
        </>
      )}
    </div>
  )
}
