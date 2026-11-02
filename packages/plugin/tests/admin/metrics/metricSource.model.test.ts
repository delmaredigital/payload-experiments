import { expect, test } from 'vitest'
import type { SerializedMetricSource } from '../../../src/types/admin.js'
import { metricSourceHint, metricSourceOptions } from '../../../src/admin/metricSource.model.js'
import { METRICS_COPY } from '../../../src/admin/copy/metrics.js'

const sources: SerializedMetricSource[] = [
  { id: 'gifts', label: 'Gifts', kind: 'revenue', keyedBy: 'user', clientWritable: false },
  { id: 'events:signup', label: 'Sign ups', kind: 'binomial', keyedBy: 'visitor', clientWritable: true },
  { id: 'views', label: 'Views', kind: 'count', keyedBy: 'visitor', clientWritable: false },
]
test('server order is kept and source labels include kind badges', () => {
  expect(metricSourceOptions(sources)).toEqual([
    { value: 'gifts', label: 'Gifts · amount', badge: 'amount' },
    { value: 'events:signup', label: 'Sign ups · yes/no', badge: 'yes/no' },
    { value: 'views', label: 'Views · count', badge: 'count' },
  ])
})
test('only revenue has a hint, with no unit warning for event or code sources', () => {
  expect(metricSourceHint(sources[0])).toBe(METRICS_COPY.revenueHint)
  expect(metricSourceHint(sources[1])).toBeNull()
  expect(metricSourceHint(sources[2])).toBeNull()
  expect(metricSourceHint()).toBeNull()
  expect(METRICS_COPY.revenueHint).toBe('Very large amounts are limited to the top 1% of the 90 days before the test starts when deciding; totals are always shown in full.')
})
