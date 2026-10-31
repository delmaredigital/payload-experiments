import { expect, test } from 'vitest'
import type { PreflightResult, RefusalCode } from '../../../src/types/endpoints.js'
import { REVIEW_HINTS } from '../../../src/admin/copy/review.js'
import { reviewView } from '../../../src/admin/review/review.model.js'

const preflight: PreflightResult = {
  checks: [{ code: 'no-primary-metric', ok: true }],
  placements: [{ collection: 'pages', id: 1, title: 'Home', url: '/home', ok: true },
    { collection: 'settings', id: 2, title: 'Ask', ok: false, detail: 'Add a variant.' }],
  baseline: { metricId: 1, value: 0.125, days: 28 }, trafficPerDay: 1200,
  estimate: { weeks: 8, plannedDurationDays: 56, sequentialTuningParameter: 500, feasible: true },
}
test('all refusal codes have hints, including every start check', () => {
  expect(Object.keys(REVIEW_HINTS)).toHaveLength(38)
  const codes: RefusalCode[] = ['weights-total', 'control-count', 'control-first', 'holdout-last', 'holdout-count',
    'variant-count', 'duplicate-key', 'duplicate-slot', 'slot-required', 'invalid-key', 'no-planned-duration',
    'no-primary-metric', 'no-placements', 'empty-slot', 'page-no-targets', 'page-user-unit', 'flag-no-point',
    'flag-params-invalid', 'flag-point-busy', 'flag-placement-missing', 'layer-full', 'layer-unit-mismatch',
    'unit-source-mismatch', 'no-reach-per-day', 'invalid-status']
  const view = reviewView({ ...preflight, checks: codes.map(code => ({ code, ok: false })) }, { status: 'draft' })
  for (const [index, code] of codes.entries()) {
    expect(view.checks[index]?.hint).toBe(REVIEW_HINTS[code])
    expect(view.checks[index]?.hint).not.toContain(code)
  }
})
test('formats baseline by kind and traffic; retains placements and preview availability', () => {
  expect(reviewView(preflight, { status: 'draft', primaryMetricKind: 'binomial' }).baseline).toBe('Over the last 28 days: 12.5%')
  expect(reviewView({ ...preflight, baseline: { metricId: 1, value: 1234, days: 28 } }, { status: 'draft', primaryMetricKind: 'count' }).baseline).toBe('Over the last 28 days: 1,234')
  const view = reviewView(preflight, { status: 'draft', primaryMetricKind: 'revenue' })
  expect(view.baseline).toBe('Over the last 28 days: 0.13')
  expect(view.traffic).toBe('About 1,200 people a day')
  expect(view.placements.map(item => item.previewAvailable)).toEqual([true, false])
  expect(view.placements[1]).toMatchObject({ title: 'Ask', ok: false, detail: 'Add a variant.' })
})
test('warns strictly above 8 weeks and for infeasibility', () => {
  expect(reviewView(preflight, { status: 'draft' })).toMatchObject({ estimate: '≈ 8 weeks', estimateWarning: false })
  expect(reviewView({ ...preflight, estimate: { ...preflight.estimate!, weeks: 8.1 } }, { status: 'draft' }).estimateWarning).toBe(true)
  expect(reviewView({ ...preflight, estimate: { ...preflight.estimate!, feasible: false } }, { status: 'draft' }))
    .toMatchObject({ estimate: 'A clear answer would take more than 90 days at this traffic.', estimateWarning: true })
})
test('null data has useful copy and no apply values', () => {
  expect(reviewView({ ...preflight, baseline: null, trafficPerDay: null, estimate: null }, { status: 'draft' })).toMatchObject({
    baseline: 'No data yet for this metric.', traffic: 'Traffic unknown until the test starts.',
    estimate: "We can't estimate the duration yet: enter how many people reach this per day.", applyValues: null,
  })
})
test('only draft/stopped with every check passing can start; applyValues come from estimate', () => {
  for (const status of ['draft', 'stopped'] as const) expect(reviewView(preflight, { status }).canStart).toBe(true)
  for (const status of ['running', 'decided', 'archived'] as const) expect(reviewView(preflight, { status }).canStart).toBe(false)
  expect(reviewView({ ...preflight, checks: [{ code: 'empty-slot', ok: false }] }, { status: 'draft' }).canStart).toBe(false)
  expect(reviewView(preflight, { status: 'draft' }).applyValues).toEqual({ plannedDurationDays: 56, sequentialTuningParameter: 500 })
})
test('retains server detail and uses server message for a future check without showing its code', () => {
  const view = reviewView({ ...preflight, checks: [{ code: 'future-check' as RefusalCode, ok: false, detail: { message: 'Fix the page.' } }] }, { status: 'draft' })
  expect(view.checks[0]).toMatchObject({ hint: 'Fix the page.', detail: 'Fix the page.' })
})
