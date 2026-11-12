import { expect, test } from 'vitest'
import type { ResultsResponse } from '../../../src/types/endpoints.js'
import { chartModel } from '../../../src/testSurface/results/chart.model.js'
import { fixture, phaseFor } from './fixtures.js'

const phase = phaseFor(fixture('T7'))
const point = (computedAt: string, ci: [number | null, number | null], arm = 'variantA') =>
  ({ computedAt, ci, arm, metricId: 'registrations', lift: 0.1 })
const first = '2026-10-29T00:00:00Z', last = '2026-10-30T00:00:00Z'

test('domain contains zero and every finite bound; primary comparisons sorted in group order', () => {
  const series = [point(last, [0.2, 0.8]), point(first, [-0.6, 0.4]), point(last, [-0.3, 1.2], 'variantB'),
    { ...point(first, [-100, 100]), metricId: 'other' }]
  const model = chartModel({ series, metricId: 'registrations', phase })
  expect(model.empty).toBe(false)
  if (model.empty) return
  expect(model.yDomain).toEqual([-0.6, 1.2])
  expect(model.xDomain).toEqual([Date.parse(first), Date.parse(last)])
  expect(model.variants.map(variant => variant.label)).toEqual(['Shorter form', 'One page form'])
  expect(model.variants[0]!.points.map(point => point.t)).toEqual(model.xDomain)
  const positive = chartModel({ series: [point(first, [0.2, 0.4]), point(last, [0.2, 0.8])], metricId: 'registrations', phase })
  expect(!positive.empty && positive.yDomain[0]).toBe(0)
})
test('one-sided null intervals stay open and non-finite bounds never enter the domain', () => {
  const series: ResultsResponse['series'] = [point(first, [null, 0.8]), point(last, [-0.4, null]), point(last, [NaN, Infinity], 'variantB')]
  const model = chartModel({ series, metricId: 'registrations', phase })
  expect(model.empty).toBe(false)
  if (model.empty) return
  expect(model.yDomain).toEqual([-0.4, 0.8])
  expect(model.variants[0]!.points.map(({ lo, hi }) => [lo, hi])).toEqual([[null, 0.8], [-0.4, null]])
  expect(model.variants[1]!.points[0]).toMatchObject({ lo: null, hi: null })
})
test('only markers within the inclusive x domain survive and opaque ids are dropped', () => {
  const model = chartModel({ series: [point(first, [-1, 1]), point(last, [-1, 1])], metricId: 'registrations', phase,
    contentChanges: ['2026-10-28', first, '2026-10-29T12:00:00Z', last, '2026-10-31', 'invalid']
      .map(at => ({ at, doc: { collection: 'pages', id: 'page' }, by: 'opaque-editor-id' })) })
  expect(model.empty).toBe(false)
  if (model.empty) return
  expect(model.markers.map(marker => marker.at)).toEqual([first, '2026-10-29T12:00:00Z', last])
  expect(JSON.stringify(model.markers)).not.toContain('opaque-editor-id')
})
test('fewer than two points, invalid timestamps and a single timestamp are empty', () => {
  for (const series of [[], [point(first, [0, 1])], [point('bad', [0, 1]), point(last, [0, 1])],
    [point(first, [0, 1]), point(first, [0, 1], 'variantB')]]) {
    expect(chartModel({ series, metricId: 'registrations', phase })).toEqual({ empty: true })
  }
})
test('holdout and original are never variant series or domain inputs', () => {
  const series = [point(first, [-0.2, 0.3]), point(last, [-0.1, 0.4]),
    point(first, [-100, 100], 'holdout'), point(last, [-200, 200], 'control')]
  const model = chartModel({ series, metricId: 'registrations', phase })
  expect(!model.empty && model.variants.map(variant => variant.arm)).toEqual(['variantA'])
  expect(!model.empty && model.yDomain).toEqual([-0.2, 0.4])
})
