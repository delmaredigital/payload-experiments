import { expect, test } from 'vitest'
import { deleteExperimentSnapshots, serializeDelete } from '../../src/db/delete.js'
import { createFakeExecutor } from '../_fakes/executor.js'

// Full snapshot JSON never crosses the adapter boundary during a delete.
test('snapshot cascade selects ids and deletes them in one parameterised statement', async () => {
  const exec = Object.assign(createFakeExecutor(), { schemaName: 'xp_test' })
  await deleteExperimentSnapshots(exec, 'opaque-id')
  expect(exec.calls).toEqual([{ text: 'DELETE FROM "xp_test"."xp_results_snapshots" WHERE "id" IN (SELECT "id" FROM "xp_test"."xp_results_snapshots" WHERE "experiment_id" = $1)', params: ['opaque-id'] }])
})
test('delete queues are isolated by session and recover from a rejected body', async () => {
  const exec = createFakeExecutor()
  const first = exec.withSession()
  const second = exec.withSession()
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  const running = serializeDelete(first, async () => { await held; return 1 })
  expect(await serializeDelete(second, async () => 2)).toBe(2)
  release()
  expect(await running).toBe(1)
  await expect(serializeDelete(first, async () => { throw new Error('failure') })).rejects.toThrow('failure')
  expect(await serializeDelete(first, async () => 3)).toBe(3)
  await expect(serializeDelete(exec.noSession(), async () => 4)).rejects.toMatchObject({ name: 'XpNoTransactionError' })
})
