import { expect, test, vi } from 'vitest'
import { resolveCaps } from '../../src/transitions/resolveCaps.js'
import type { MetricDefinition } from '../../src/transitions/resolveCaps.js'
import type { MetricSource } from '../../src/types/contracts.js'

const start = new Date('2026-10-31T12:00:00Z')
const metric: MetricDefinition = { id: 1, source: 'gifts', attributionWindowHours: 24, capping: { type: 'percentile', value: 0.5 } }
const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ unitId: `u${i}`, value: i + 1, ts: new Date('2026-10-20') }))
function source(query = vi.fn(async () => rows(20))): MetricSource {
  return { id: 'gifts', label: 'Gifts', kind: 'revenue', keyedBy: 'user', query }
}
test('uses source query over exactly 90 days, greedy per-unit windows, and percentile of sums', async () => {
  const data = [...rows(20), { unitId: 'u0', value: 99, ts: new Date('2026-10-20T01:00Z') }, { unitId: 'u0', value: 200, ts: new Date('2026-10-21') },
    { unitId: 'too-old', value: 1e9, ts: new Date('2026-07-01') }, { unitId: 'at-start', value: 1e9, ts: start }]
  const query = vi.fn(async () => data)
  const result = await resolveCaps([metric], [source(query)], start)
  expect(query).toHaveBeenCalledWith({ from: new Date(start.getTime() - 90 * 86400000), to: start })
  // 2..20, 100 and 200; the median window is 12, with 20 distinct units.
  expect(result.definitions[0]).toMatchObject({ resolvedCap: 12, historyUnits: 20 })
  expect(result.detail).toEqual([])
})
test.each([0, 19])('fewer than 20 units (%s) disables cap even with many windows', async n => {
  const data = rows(n).flatMap(row => [row, { ...row, ts: new Date('2026-10-22') }])
  const result = await resolveCaps([metric], [source(vi.fn(async () => data))], start)
  expect(result.definitions[0]).toMatchObject({ resolvedCap: null, historyUnits: n, capNotice: 'no-history' })
  expect(result.detail).toEqual([{ metricId: 1, message: expect.any(String) }])
})
test('missing or throwing source yields no cap and a detail notice', async () => {
  for (const sources of [[], [source(vi.fn(async () => { throw new Error('offline') }))]]) {
    const result = await resolveCaps([metric], sources, start)
    expect(result.definitions[0]).toMatchObject({ resolvedCap: null, historyUnits: 0, capNotice: 'no-history' })
    expect(result.detail).toEqual([{ metricId: 1, message: expect.stringContaining('unavailable') }])
  }
})
test('absolute cap needs no history; revenue defaults to percentile .99', async () => {
  const s = source()
  const absolute = await resolveCaps([{ ...metric, capping: { type: 'absolute', value: 50 } }], [s], start)
  expect(absolute.definitions[0]!.resolvedCap).toBe(50)
  expect(s.query).not.toHaveBeenCalled()
  const defaults = await resolveCaps([{ ...metric, capping: null }], [s], start)
  expect(defaults.definitions[0]).toMatchObject({ capping: { type: 'percentile', value: 0.99 }, resolvedCap: 19.81 })
})
test.each(['count', 'binomial'] as const)('%s and events are never capped', async kind => {
  const s = { ...source(), kind }
  const result = await resolveCaps([metric, { ...metric, source: 'events:gifts' }], [s], start)
  expect(result.definitions.every(def => def.resolvedCap === null)).toBe(true)
  expect(s.query).not.toHaveBeenCalled()
})
test('percentile 1 resolves to the largest historical window', async () => {
  const result = await resolveCaps([{ ...metric, capping: { type: 'percentile', value: 1 } }], [source()], start)
  expect(result.definitions[0]!.resolvedCap).toBe(20)
})
test('nonfinite history disables cap and preserves the frozen definition', async () => {
  const original = structuredClone(metric)
  const result = await resolveCaps([metric], [source(vi.fn(async () => [...rows(20), { unitId: 'bad', value: Infinity, ts: new Date('2026-10-20') }]))], start)
  expect(result.definitions[0]!.resolvedCap).toBeNull()
  expect(result.detail).toHaveLength(1)
  expect(metric).toEqual(original)
})
