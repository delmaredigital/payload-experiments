import { expect, test } from 'vitest'
import { txExecutor } from '../../src/db/executor.js'
import { lockMetricRow, lockMetricsForFreeze } from '../../src/db/metricUsage.js'
import { XpNoTransactionError } from '../../src/errors.js'
import { createFakeExecutor } from '../_fakes/executor.js'
import { fakeReq } from '../_fakes/req.js'

test.each(['delete', 'change'] as const)('%s lock uses the quoted request schema and correct row-lock mode', async mode => {
  const exec = Object.assign(createFakeExecutor(), { schemaName: 'custom"schema' })
  await lockMetricRow(exec, 'goal-id', mode)
  expect(exec.calls).toEqual([{ text: `SELECT 1 FROM "custom""schema"."xp_metrics" WHERE "id" = $1 ${mode === 'delete' ? 'FOR UPDATE' : 'FOR NO KEY UPDATE'}`, params: ['goal-id'] }])
})

test.each([[12, 2, 12], ['b', 'a', 'b']])('freeze locks unique ids in native SQL order: %j', async (...ids) => {
  const sorted = typeof ids[0] === 'number' ? [2, 12] : ['a', 'b']
  const rows = sorted.map(id => ({ id, slug: `goal-${id}`, source: 'events:signup' }))
  const exec = createFakeExecutor({ results: [{ rows }] })
  expect(await lockMetricsForFreeze(exec, ids)).toEqual(rows)
  expect(exec.calls).toEqual([{ text: 'SELECT "id", "slug", "source" FROM "xp_metrics" WHERE "id" = ANY($1) ORDER BY "id" FOR SHARE', params: [sorted] }])
})

test('a deleted goal is reported missing after locking surviving rows', async () => {
  const exec = createFakeExecutor({ results: [{ rows: [{ id: 2 }] }] })
  expect(await lockMetricsForFreeze(exec, [2, 4])).toBeNull()
})

test('freeze fails closed without a request transaction session', async () => {
  await expect(lockMetricsForFreeze(txExecutor(fakeReq()), [2])).rejects.toBeInstanceOf(XpNoTransactionError)
})
