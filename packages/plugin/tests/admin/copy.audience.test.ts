import { expect, test } from 'vitest'
import * as audience from '../../src/testSurface/copy/audience.js'
import * as metrics from '../../src/testSurface/copy/metrics.js'
import { allocationSentence } from '../../src/testSurface/allocation.model.js'
import { metricSourceHint, metricSourceOptions } from '../../src/testSurface/metricSource.model.js'
import { opLabel, opsFor } from '../../src/testSurface/targeting/targeting.model.js'

function check(value: unknown) {
  if (typeof value === 'string') expect(value).not.toMatch(/\b(arms?|phases?)\b/i)
  else if (value && typeof value === 'object') Object.values(value).forEach(check)
}
test('Audience and goal copy and model output use user vocabulary', () => {
  check(audience)
  check(metrics)
  for (const type of ['string', 'number', 'boolean'] as const) check(opsFor(type).map(op => opLabel(type, op)))
  for (const status of ['draft', 'stopped', 'running', 'decided', 'archived'] as const) for (const unitType of ['visitor', 'user'] as const) {
    check(allocationSentence({ status, unitType, allocation: 30, layer: { name: 'Home', used: 30, free: 70 }, arms: [
      { key: 'control', kind: 'control', weight: 40 }, { key: 'variantA', kind: 'variant', weight: 50 }, { key: 'holdout', kind: 'holdout', weight: 10 },
    ] }))
  }
  const source = { id: 'gifts', label: 'Gifts', kind: 'revenue' as const, keyedBy: 'user' as const, clientWritable: false }
  check(metricSourceOptions([source]))
  check(metricSourceHint(source))
})
