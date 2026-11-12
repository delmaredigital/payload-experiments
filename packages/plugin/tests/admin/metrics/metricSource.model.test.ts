import { expect, test } from 'vitest'
import type { SerializedMetricSource } from '../../../src/types/admin.js'
import { metricSourceHint, metricSourceOptions, sourceFor } from '../../../src/testSurface/metricSource.model.js'
import { METRICS_COPY } from '../../../src/testSurface/copy/metrics.js'

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
  expect(METRICS_COPY.revenueHint).toBe('Very large amounts are counted only up to the level that the top 1% of amounts reached in the 90 days before the test starts; totals are always shown in full.')
})

test('sourceFor resolves click keys, exact event and declared ids, and leaves unknown ids absent', () => {
  const click: SerializedMetricSource = { id: 'click:', label: 'A click on the page', kind: 'binomial', keyedBy: 'visitor', clientWritable: true }
  expect(sourceFor('click:x', [...sources, click])).toBe(click)
  expect(sourceFor('events:signup', sources)).toBe(sources[1])
  expect(sourceFor('gifts', sources)).toBe(sources[0])
  expect(sourceFor('events:x', sources)).toBeUndefined()
  expect(sourceFor('missing', sources)).toBeUndefined()
})
