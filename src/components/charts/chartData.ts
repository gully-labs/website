/* When is there nothing to draw? One rule for every chart in the kit (owner rule: unknown is never
   drawn as zero; fewer than two points is "not enough for a series yet", not a flat line):
     - a value is real when it is a finite number (0 included: a known zero is data). null, undefined,
       NaN, '-' and '' are unknown, and an unknown is never counted, so a series of nulls is empty;
     - a line, or a column chart (vertical bars), needs at least 2 real points;
     - anything else (horizontal bar rankings, rings, tiles, scatter) needs at least 1.
   A chart is empty when it has series to judge and none of them qualifies. Charts fed through a
   `dataset`, and series whose data is not an array, are not judged (treated as drawn).
   Pure, with no imports, so scripts/test-chart-kit.mjs runs it in Node. */

type Loose = Record<string, unknown>

/** Series types that only decorate another series (the live pulse on the newest point). */
const DECOR = new Set(['effectScatter'])

/** Is this one value (or data item) a real reading? */
export function isReal(v: unknown): boolean {
  if (v === null || v === undefined) return false
  if (typeof v === 'number') return Number.isFinite(v)
  if (typeof v === 'string') return v.trim() !== '' && v.trim() !== '-' && Number.isFinite(Number(v))
  if (Array.isArray(v)) return v.length > 0 && isReal(v[v.length - 1])
  if (typeof v === 'object') return 'value' in (v as Loose) ? isReal((v as Loose).value) : true
  return false
}

/** How many real readings a list holds. */
export const realCount = (data: readonly unknown[]) => data.reduce<number>((n, v) => n + (isReal(v) ? 1 : 0), 0)

/** True when a plain series of values has too few real points to draw (`min` defaults to 2). */
export function tooFewPoints(data: readonly unknown[] | null | undefined, min = 2): boolean {
  return !data || realCount(data) < min
}

const first = (x: unknown): Loose | undefined => (Array.isArray(x) ? (x[0] as Loose | undefined) : (x as Loose | undefined))

/**
 * True when an ECharts option has nothing real to draw, by the rule above. EChart.tsx shows the
 * ghosted placeholder (ChartEmpty) instead of drawing such an option.
 */
export function optionIsEmpty(option: object | null | undefined): boolean {
  if (!option) return true
  const o = option as Loose
  if (o.dataset) return false
  const list = (Array.isArray(o.series) ? o.series : o.series ? [o.series] : []) as Loose[]
  const horizontal = first(o.yAxis)?.type === 'category'
  let judged = 0
  for (const s of list) {
    if (!s || DECOR.has(String(s.type)) || !Array.isArray(s.data)) continue
    judged++
    const needsTwo = s.type === 'line' || (s.type === 'bar' && !horizontal)
    if (realCount(s.data as unknown[]) >= (needsTwo ? 2 : 1)) return false
  }
  return judged > 0
}

/** The placeholder shape that matches an option: a ring for pies, a curve for lines, else columns. */
export function ghostVariantOf(option: object | null | undefined): 'line' | 'bars' | 'ring' {
  const list = ((option as Loose | null)?.series ?? []) as Loose[] | Loose
  const s = (Array.isArray(list) ? list : [list]).find((x) => x && !DECOR.has(String(x.type)))
  return s?.type === 'pie' ? 'ring' : s?.type === 'line' ? 'line' : 'bars'
}

/**
 * The y-axis of a line chart: its top and the tick values (bottom to top, 0 first). With `integer` (counts) the
 * ticks are whole numbers on a whole step and the domain is at least `count` (so a max of 1 reads 0, 1, 2, 3, never
 * "1, 1, 0, 0"); otherwise the top is the max plus 8 % headroom split evenly. Ticks never repeat.
 */
export function yTicks(max: number, { integer = false, count = 3 }: { integer?: boolean; count?: number } = {}): { top: number; ticks: number[] } {
  const hi = Number.isFinite(max) && max > 0 ? max : 0
  if (integer) {
    const step = Math.max(1, Math.ceil(Math.ceil(hi * 1.08) / count))
    return { top: step * count, ticks: Array.from({ length: count + 1 }, (_, g) => g * step) }
  }
  const top = (hi || 1) * 1.08
  return { top, ticks: [...new Set(Array.from({ length: count + 1 }, (_, g) => (top * g) / count))] }
}
