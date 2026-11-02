import { expect, test } from 'vitest'
import type { PreflightResult } from '../../../src/types/endpoints.js'
import { reviewView } from '../../../src/admin/review/review.model.js'

const preflight: PreflightResult = { checks: [], placements: [], baseline: { metricId: 1, value: 0.125, days: 28 }, trafficPerDay: null, estimate: null }
test.each([
  ['binomial', 0.125, '12.5%'], ['count', 1234, '1,234'], ['revenue', 0.125, '0.13'],
] as const)('formats the selected goal baseline as %s', (primaryMetricKind, value, expected) => {
  expect(reviewView({ ...preflight, baseline: { metricId: 1, value, days: 28 } }, { primaryMetricKind }).baseline)
    .toBe(`Over the last 28 days: ${expected}`)
})
test('missing baseline explains that no data is available yet', () => {
  expect(reviewView({ ...preflight, baseline: null }, {}).baseline).toBe('No data yet for this metric.')
})
