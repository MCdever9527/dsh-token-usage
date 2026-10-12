/**
 * Date-window arithmetic for the Token-usage page.
 *
 * Pure and browser-safe: the whole feature is client-side arithmetic over the
 * per-day buckets the host publishes, so switching windows costs nothing and
 * never triggers a rescan.
 *
 * Window semantics are CALENDAR days in local time, inclusive of today:
 *
 * | Range   | Window                          |
 * | ------- | ------------------------------- |
 * | today   | today only                      |
 * | 3d      | today and the two days before   |
 * | 7d      | today and the six days before   |
 * | 30d     | today and the 29 days before    |
 * | all     | every day, including `unknown` |
 *
 * Day keys are `YYYY-MM-DD` strings, so lexicographic comparison is date
 * comparison and a window is a simple prefix-bounded filter.
 *
 * @module dsh-token-usage/range
 */

/** The offered windows, in menu order. */
export const USAGE_RANGES = ['today', '3d', '7d', '30d', 'all'] as const

/** One selectable window. */
export type UsageRange = (typeof USAGE_RANGES)[number]

/**
 * The bucket shape a day carries. Mutable on purpose: this type doubles as the
 * accumulator every window sum writes into.
 */
export interface DayBuckets {
  inputTokens: number
  cacheReadTokens: number
  outputTokens: number
  reasoningTokens: number
  calls: number
}

/** Zeroed day buckets. */
export function emptyBuckets(): DayBuckets {
  return { inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, reasoningTokens: 0, calls: 0 }
}

/** The local calendar day of one Date, as `YYYY-MM-DD`. */
export function dayKeyOf(date: Date): string {
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const day = date.getDate()
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** The day key of a date shifted by whole days. */
export function shiftDay(date: Date, days: number): Date {
  const shifted = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  shifted.setDate(shifted.getDate() + days)
  return shifted
}

/**
 * The first day key a window includes; undefined for `all`.
 * @param range - the selected window.
 * @param now - the reference instant (defaults to now).
 */
export function startDayOf(range: UsageRange, now: Date = new Date()): string | undefined {
  if (range === 'all') return undefined
  const span = range === 'today' ? 1 : range === '3d' ? 3 : range === '7d' ? 7 : 30
  return dayKeyOf(shiftDay(now, -(span - 1)))
}

/** Whether one day key falls inside the window. */
export function dayInRange(day: string, range: UsageRange, now: Date = new Date()): boolean {
  if (range === 'all') return true
  if (day === 'unknown') return false
  const start = startDayOf(range, now)
  const today = dayKeyOf(now)
  return start !== undefined && day >= start && day <= today
}

/**
 * Sum the day buckets a window includes.
 * @param days - the per-day map of one model row.
 * @param range - the selected window.
 * @param now - the reference instant (defaults to now).
 */
export function sumDays(
  days: Readonly<Record<string, DayBuckets>> | undefined,
  range: UsageRange,
  now: Date = new Date(),
): DayBuckets {
  const total = emptyBuckets()
  if (days === undefined) return total
  for (const [day, buckets] of Object.entries(days)) {
    if (!dayInRange(day, range, now)) continue
    total.inputTokens += buckets.inputTokens
    total.cacheReadTokens += buckets.cacheReadTokens
    total.outputTokens += buckets.outputTokens
    total.reasoningTokens += buckets.reasoningTokens
    total.calls += buckets.calls
  }
  return total
}

/** Add day buckets into an accumulator. */
export function addBuckets(into: DayBuckets, from: DayBuckets): DayBuckets {
  into.inputTokens += from.inputTokens
  into.cacheReadTokens += from.cacheReadTokens
  into.outputTokens += from.outputTokens
  into.reasoningTokens += from.reasoningTokens
  into.calls += from.calls
  return into
}

/** The billed total of one bucket slice: every counted token. */
export function billedOf(buckets: Pick<DayBuckets, 'inputTokens' | 'cacheReadTokens' | 'outputTokens'>): number {
  return buckets.inputTokens + buckets.cacheReadTokens + buckets.outputTokens
}
