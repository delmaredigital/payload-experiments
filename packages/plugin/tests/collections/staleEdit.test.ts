import type { CollectionBeforeChangeHook, PayloadRequest } from 'payload'
import { expect, test } from 'vitest'
import { lockHook } from '../../src/collections/experiments/lockHook.js'
import { XP_IF_UPDATED_AT_HEADER } from '../../src/constants.js'
import { XpNoTransactionError, XpRefusal } from '../../src/errors.js'
import { createFakeExecutor, withSession } from '../_fakes/executor.js'
import { fakeReq } from '../_fakes/req.js'

const stored = '2026-11-03T12:00:00.123Z'
const originalDoc = { id: 17, status: 'draft', name: 'Before', updatedAt: '2026-11-01T00:00:00Z' }
function run(req: PayloadRequest, operation: 'create' | 'update' = 'update') {
  const data: Record<string, unknown> = { name: 'After', ...(operation === 'create' ? { kind: 'block' } : {}) }
  return lockHook({ req, operation, originalDoc, data } as Parameters<CollectionBeforeChangeHook>[0])
}
function fixture(header?: string, row: Date | string | null = stored) {
  const f = withSession({ results: [{ rows: [{ updatedAt: row }] }] })
  if (header !== undefined) f.req.headers.set(XP_IF_UPDATED_AT_HEADER, header)
  return f
}

test('without the header an update needs no transaction or SQL', async () => {
  const req = fakeReq()
  await expect(run(req)).resolves.toMatchObject({ name: 'After' })
})
test.each([stored, '2026-11-03T07:00:00.123-05:00'])('compares instants and locks on the request session: %s', async header => {
  const f = fixture(header, new Date(stored))
  const pool = createFakeExecutor({ throwOn: 1 })
  f.req.payload.db.drizzle = { execute: pool.execute } as typeof f.req.payload.db.drizzle
  await expect(run(f.req)).resolves.toMatchObject({ name: 'After' })
  expect(f.executor.calls).toEqual([{
    text: 'SELECT "updated_at" AS "updatedAt" FROM "xp_experiments" WHERE "id" = $1 FOR NO KEY UPDATE', params: [17],
  }])
  expect(pool.calls).toEqual([])
})
test.each(['2026-11-03T12:00:00.122Z', '2026-11-03T12:00:00.124Z', 'invalid', ''])('refuses a stale or invalid baseline: %j', async header => {
  const f = fixture(header)
  await expect(run(f.req)).rejects.toBeInstanceOf(XpRefusal)
  // A separate invocation has its own row response; the refusal must be public.
  await expect(run(fixture(header).req)).rejects.toMatchObject({
    code: 'stale-edit', status: 409, isPublic: true,
    message: 'Someone else changed this test. Reload to see their changes.',
  })
  expect(f.executor.calls[0]!.text).toContain('FOR NO KEY UPDATE')
})
test('a missing row is refused instead of matching an absent timestamp', async () => {
  await expect(run(fixture(stored, null).req)).rejects.toMatchObject({ code: 'stale-edit', status: 409 })
})
test('a transition ignores a stale header without a transaction', async () => {
  const req = fakeReq({ context: { xpTransition: true }, headers: { [XP_IF_UPDATED_AT_HEADER]: 'invalid' } })
  await expect(run(req)).resolves.toMatchObject({ name: 'After' })
})
test('create ignores the header without a transaction', async () => {
  const req = fakeReq({ headers: { [XP_IF_UPDATED_AT_HEADER]: 'invalid' } })
  await expect(run(req, 'create')).resolves.toMatchObject({ name: 'After', status: 'draft', phase: 0 })
})
test('an opted-in update without a request transaction fails closed', async () => {
  const req = fakeReq({ headers: { [XP_IF_UPDATED_AT_HEADER]: stored } })
  await expect(run(req)).rejects.toBeInstanceOf(XpNoTransactionError)
  await expect(run(req)).rejects.toThrow('An active transaction is required')
})
