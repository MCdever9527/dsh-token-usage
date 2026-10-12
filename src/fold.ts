/**
 * The provider-by-model usage fold, with a per-day dimension.
 *
 * One pure state machine folds a session's durable event log into
 * per-(provider, model) token totals and, inside each route, per-calendar-day
 * buckets (local time). It reproduces the accounting semantics the shipped
 * `tokenUsage` projection uses, extended with the route and day dimensions:
 *
 * - A usage sample is `data.usage` when present, otherwise the last `usage`
 *   frame embedded in the assistant stream (same `usageOf` order as
 *   dsh-token-meter).
 * - Each assistant settlement lands in a replacement slot keyed by
 *   `(turn, step)`. A later settlement of the same step REPLACES the earlier
 *   sample — the previous buckets leave their route AND their day; the new
 *   buckets join theirs. `llm/retry-started` on the open slot closes it, so the
 *   retried attempt ADDS its own billing usage instead of replacing the failed
 *   one.
 * - The route of an `assistant/message` is its own `message.source`
 *   (`kind: 'model'`); an `assistant/attempt` carries no source, so it is
 *   attributed to the route the surrounding request declared — tracked from
 *   `model/selection`, `request/context` and `request/header` in arrival
 *   order (the last declaration before the attempt wins).
 * - `compaction/summary` reports its own provider/model/usage and is added
 *   directly: compaction calls bill real tokens but never pass through the
 *   attempt lifecycle.
 * - The day of a sample is the local calendar day of the event's own `time`.
 *   A sample without a usable timestamp lands in the `unknown` bucket, which
 *   all-name totals include and date windows exclude.
 *
 * Browser-safe: no Node imports, so the same module can serve a client-side
 * fold if a future surface wants window-scoped numbers.
 *
 * @module dsh-token-usage/fold
 */

/** Bucket arithmetic key: provider NUL model. */
export type RouteKey = string

/** The counted buckets of one usage slice. */
export interface Buckets {
  readonly inputTokens: number
  readonly cacheReadTokens: number
  readonly outputTokens: number
  readonly reasoningTokens: number
}

/** The mutable bucket shape of one day inside one route. */
export interface DayTotals {
  inputTokens: number
  cacheReadTokens: number
  outputTokens: number
  reasoningTokens: number
  calls: number
}

/** One route's totals, plus its per-day breakdown. */
export interface RouteUsage {
  readonly provider: string
  readonly model: string
  inputTokens: number
  cacheReadTokens: number
  outputTokens: number
  reasoningTokens: number
  calls: number
  /** Per-day buckets keyed `YYYY-MM-DD` (local), plus `unknown`. */
  days: Record<string, DayTotals>
}

/** The immutable-ish fold state; entries is a plain record so it stays JSON. */
export interface FoldState {
  /** Per-route totals, keyed `${provider}\u0000${model}`. */
  readonly entries: Readonly<Record<RouteKey, RouteUsage>>
  /** Last route declaration seen from selection/context/header events. */
  readonly route: { readonly provider: string; readonly model: string } | null
  /** The open replacement slot: the last settled usage sample. */
  readonly slot: {
    readonly turn: number
    readonly step: number
    readonly key: RouteKey | null
    readonly day: string
    readonly buckets: Buckets
  } | null
}

/** A session event as the persistence seam serves it. */
export interface FoldEvent {
  readonly type: string
  readonly time?: number
  readonly data?: any
}

/** The day bucket name for samples the fold cannot date. */
export const UNKNOWN_DAY = 'unknown'

/** The route key of one provider/model pair. */
function routeKeyOf(provider: string, model: string): RouteKey {
  return provider + '\u0000' + model
}

/** A non-negative safe integer, the only counts the fold trusts. */
function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** The local calendar day of one event timestamp. */
export function dayKeyOf(time: unknown): string {
  if (typeof time !== 'number' || !Number.isFinite(time)) return UNKNOWN_DAY
  const date = new Date(time)
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const day = date.getDate()
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** The last `usage` frame of an assistant stream record, official order. */
export function lastStreamUsage(stream: unknown): unknown {
  if (!Array.isArray(stream)) return undefined
  for (let index = stream.length - 1; index >= 0; index -= 1) {
    const entry = stream[index] as { type?: string; chunk?: { type?: string; usage?: unknown } } | null
    if (entry === null || typeof entry !== 'object') continue
    if (entry.type === 'chunk' && entry.chunk !== undefined && entry.chunk.type === 'usage') {
      return entry.chunk.usage
    }
  }
  return undefined
}

/**
 * The usage sample of one settlement event, or undefined.
 *
 * `assistant/message` prefers its explicit `data.usage` (the assembled
 * settlement) and falls back to the stream's last frame; `assistant/attempt`
 * has no settlement field and reads the stream only. Same order as the shipped
 * tokenUsage projection's `usageOf`.
 */
export function usageOf(event: FoldEvent): unknown {
  const data = event.data
  if (typeof data !== 'object' || data === null) return undefined
  if (event.type === 'assistant/message' && data.usage !== undefined) return data.usage
  if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return undefined
  return lastStreamUsage(data.stream)
}

/** The route of an assembled assistant message, per the official messageRoute. */
export function messageRouteOf(message: unknown): { provider: string; model: string } | undefined {
  if (typeof message !== 'object' || message === null) return undefined
  const source = (message as { source?: unknown }).source
  if (typeof source !== 'object' || source === null) return undefined
  const { provider, model } = source as { provider?: unknown; model?: unknown }
  if (typeof provider !== 'string' || provider.length === 0) return undefined
  if (typeof model !== 'string' || model.length === 0) return undefined
  return { provider, model }
}

/** Extract validated buckets from a raw usage sample; undefined when unusable. */
function bucketsOf(sample: unknown): Buckets | undefined {
  if (typeof sample !== 'object' || sample === null) return undefined
  const raw = sample as Record<string, unknown>
  if (!isCount(raw.inputTokens) || !isCount(raw.outputTokens)) return undefined
  const cacheReadTokens = isCount(raw.cacheReadTokens) ? raw.cacheReadTokens : 0
  // Reasoning is bounded by output; an inconsistent value drops the field only.
  const reasoningTokens =
    isCount(raw.reasoningTokens) && raw.reasoningTokens <= raw.outputTokens ? raw.reasoningTokens : 0
  return { inputTokens: raw.inputTokens, cacheReadTokens, outputTokens: raw.outputTokens, reasoningTokens }
}

/** A route declaration event the tracker accepts. */
function routeOf(event: FoldEvent): { provider: string; model: string } | undefined {
  const data = event.data
  if (typeof data !== 'object' || data === null) return undefined
  if (event.type === 'model/selection' || event.type === 'request/context') {
    if (typeof data.provider === 'string' && data.provider.length > 0 && typeof data.model === 'string' && data.model.length > 0) {
      return { provider: data.provider, model: data.model }
    }
    return undefined
  }
  if (event.type === 'request/header') {
    const config = (data.header as { config?: unknown } | undefined)?.config
    if (typeof config !== 'object' || config === null) return undefined
    const { provider, model } = config as { provider?: unknown; model?: unknown }
    if (typeof provider === 'string' && provider.length > 0 && typeof model === 'string' && model.length > 0) {
      return { provider, model }
    }
  }
  return undefined
}

/** Adjust one route's totals and one of its day buckets. */
function addEntry(
  entries: Record<RouteKey, RouteUsage>,
  key: RouteKey,
  provider: string,
  model: string,
  day: string,
  buckets: Buckets,
  sign: 1 | -1,
): void {
  const current = entries[key]
  if (current === undefined) {
    if (sign === -1) return
    entries[key] = {
      provider,
      model,
      inputTokens: buckets.inputTokens,
      cacheReadTokens: buckets.cacheReadTokens,
      outputTokens: buckets.outputTokens,
      reasoningTokens: buckets.reasoningTokens,
      calls: 1,
      days: {
        [day]: {
          inputTokens: buckets.inputTokens,
          cacheReadTokens: buckets.cacheReadTokens,
          outputTokens: buckets.outputTokens,
          reasoningTokens: buckets.reasoningTokens,
          calls: 1,
        },
      },
    }
    return
  }
  current.inputTokens += sign * buckets.inputTokens
  current.cacheReadTokens += sign * buckets.cacheReadTokens
  current.outputTokens += sign * buckets.outputTokens
  current.reasoningTokens += sign * buckets.reasoningTokens
  current.calls += sign

  const dayBucket = current.days[day]
  if (dayBucket === undefined) {
    if (sign === 1) {
      current.days[day] = {
        inputTokens: buckets.inputTokens,
        cacheReadTokens: buckets.cacheReadTokens,
        outputTokens: buckets.outputTokens,
        reasoningTokens: buckets.reasoningTokens,
        calls: 1,
      }
    }
  } else {
    dayBucket.inputTokens += sign * buckets.inputTokens
    dayBucket.cacheReadTokens += sign * buckets.cacheReadTokens
    dayBucket.outputTokens += sign * buckets.outputTokens
    dayBucket.reasoningTokens += sign * buckets.reasoningTokens
    dayBucket.calls += sign
    if (dayBucket.calls <= 0) delete current.days[day]
  }

  // A replacement that took the last sample off a route removes its row, so a
  // mid-step provider switch leaves no zeroed ghost behind.
  if (current.calls <= 0) {
    delete entries[key]
  }
}

/**
 * Apply one event, returning the same reference when nothing changed.
 *
 * The registry-style same-reference contract keeps downstream observers quiet
 * on the (many) events that carry no usage.
 */
export function applyFold(state: FoldState, event: FoldEvent): FoldState {
  if (event.type === 'llm/retry-started') {
    const data = event.data
    if (
      state.slot !== null &&
      typeof data === 'object' && data !== null &&
      state.slot.turn === data.turn &&
      state.slot.step === data.step
    ) {
      return { ...state, slot: null }
    }
    return state
  }

  if (event.type === 'model/selection' || event.type === 'request/context' || event.type === 'request/header') {
    const route = routeOf(event)
    if (route === undefined) return state
    if (state.route !== null && state.route.provider === route.provider && state.route.model === route.model) return state
    return { ...state, route }
  }

  if (event.type === 'compaction/summary') {
    const data = event.data
    if (typeof data !== 'object' || data === null) return state
    if (typeof data.provider !== 'string' || data.provider.length === 0) return state
    if (typeof data.model !== 'string' || data.model.length === 0) return state
    const buckets = bucketsOf(data.usage)
    if (buckets === undefined) return state
    const key = routeKeyOf(data.provider, data.model)
    const entries = { ...state.entries }
    addEntry(entries, key, data.provider, data.model, dayKeyOf(event.time), buckets, 1)
    return { ...state, entries }
  }

  if (event.type === 'assistant/message' || event.type === 'assistant/attempt') {
    const data = event.data
    if (typeof data !== 'object' || data === null) return state
    const sample = usageOf(event)
    const buckets = bucketsOf(sample)
    if (buckets === undefined) return state

    const route =
      event.type === 'assistant/message'
        ? messageRouteOf(data.message) ?? state.route ?? undefined
        : state.route ?? undefined
    const key = route === undefined ? null : routeKeyOf(route.provider, route.model)
    const day = dayKeyOf(event.time)

    const slot = state.slot
    const previous =
      slot !== null && slot.turn === data.turn && slot.step === data.step ? slot : undefined
    if (previous !== undefined && previous.key === key && previous.day === day && bucketsEqual(previous.buckets, buckets)) {
      return state
    }

    const entries = { ...state.entries }
    if (previous !== undefined && previous.key !== null) {
      const previousEntry = entries[previous.key]
      if (previousEntry !== undefined) {
        addEntry(entries, previous.key, previousEntry.provider, previousEntry.model, previous.day, previous.buckets, -1)
      }
    }
    if (key !== null && route !== undefined) {
      addEntry(entries, key, route.provider, route.model, day, buckets, 1)
    }
    return { ...state, entries, slot: { turn: data.turn, step: data.step, key, day, buckets } }
  }

  return state
}

/** Whether two bucket samples carry identical counts. */
function bucketsEqual(a: Buckets, b: Buckets): boolean {
  return (
    a.inputTokens === b.inputTokens &&
    a.cacheReadTokens === b.cacheReadTokens &&
    a.outputTokens === b.outputTokens &&
    a.reasoningTokens === b.reasoningTokens
  )
}

/** Fresh fold state. */
export function initFold(): FoldState {
  return { entries: {}, route: null, slot: null }
}

/** Fold a whole event log. */
export function foldEvents(events: readonly FoldEvent[]): FoldState {
  let state = initFold()
  for (const event of events) state = applyFold(state, event)
  return state
}

/** The per-route rows of a folded state, deterministic order (provider, model). */
export function foldRows(state: FoldState): RouteUsage[] {
  const rows = Object.values(state.entries)
  rows.sort((a, b) => (a.provider === b.provider ? (a.model < b.model ? -1 : 1) : a.provider < b.provider ? -1 : 1))
  return rows
}

/** Zero the aggregate buckets of a row list (used by tests and the host totals). */
export function sumRows(rows: readonly RouteUsage[]): Omit<RouteUsage, 'provider' | 'model' | 'days'> {
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
  return { inputTokens, cacheReadTokens, outputTokens, reasoningTokens, calls }
}
