import { expect, test } from 'vitest'
import * as audience from '../../src/admin/copy/audience.js'
import * as metrics from '../../src/admin/copy/metrics.js'
import { allocationSentence } from '../../src/admin/allocation.model.js'
import { metricSourceHint, metricSourceOptions } from '../../src/admin/metricSource.model.js'
import { opLabel, opsFor } from '../../src/admin/targeting/targeting.model.js'

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
