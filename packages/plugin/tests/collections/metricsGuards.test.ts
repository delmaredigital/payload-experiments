import type { CollectionBeforeChangeHook, CollectionBeforeDeleteHook, PayloadRequest, SanitizedCollectionConfig } from 'payload'
import { expect, test } from 'vitest'
import { metricChangeGuard, metricDeleteGuard, XpGoalInUseError } from '../../src/collections/metricsGuards.js'
import { metricsCollection } from '../../src/collections/metrics.js'
import { XpNoTransactionError } from '../../src/errors.js'
import { createFakeExecutor } from '../_fakes/executor.js'
import { fakePayload } from '../_fakes/payload.js'
import { fakeReq } from '../_fakes/req.js'
import { sampleOptions } from './fixtures.js'

const originalDoc = { id: 17, name: 'Signups', slug: 'signups', source: 'events:signup' }
const deleteMessage = 'This goal is used by the test "Signup test". Remove it from the test first.'
const changeMessage = "This goal is used by a test, so its short name and what it measures can't change. Create a new goal instead."
function fixture(inUse = true) {
  const exec = createFakeExecutor({ results: [{ rows: inUse ? [{ name: 'Signup test' }] : [] }] })
  return { exec, req: exec.withSession() }
}
function remove(req: PayloadRequest, id: string | number = 17) {
  return metricDeleteGuard({ req, id } as Parameters<CollectionBeforeDeleteHook>[0])
}
function change(req: PayloadRequest, data: Record<string, unknown>, operation: 'update' | 'create' = 'update') {
  return metricChangeGuard({ req, data, originalDoc, operation } as Parameters<CollectionBeforeChangeHook>[0])
}

test('guards are registered on the collection', () => {
  const config = metricsCollection(sampleOptions())
  expect(config.hooks?.beforeDelete).toContain(metricDeleteGuard)
  expect(config.hooks?.beforeChange).toContain(metricChangeGuard)
})

test.each([17, '17', '48209116-0d47-46a2-9058-f46d67b665fb'])('delete refuses frozen phase usage and compares numeric/string ids as text: %s', async id => {
  const { exec, req } = fixture()
  await expect(remove(req, id)).rejects.toMatchObject({ status: 400, isPublic: true, message: deleteMessage })
  const call = exec.calls[0]!
  expect(call.text).toContain('FROM "xp_phases" p')
  expect(call.text).toContain('jsonb_array_elements(p."metric_definitions")')
  expect(call.text).toContain("definition->>'metricId' = $1::text")
  // The executor binds each occurrence separately for Drizzle.
  expect(call.params.length).toBeGreaterThan(0)
  expect(call.params.every(param => param === String(id))).toBe(true)
})

test.each(['primary', 'secondary', 'guardrails'])('delete refuses a draft selecting the goal as %s', async role => {
  const { exec, req } = fixture()
  await expect(remove(req)).rejects.toThrow(deleteMessage)
  const sql = exec.calls[0]!.text
  expect(sql).toContain('UNION ALL')
  expect(sql).toContain('FROM "xp_experiments" e')
  if (role === 'primary') expect(sql).toContain('e."metrics_primary_id"::text = $2::text')
  else {
    expect(sql).toContain('FROM "xp_experiments_rels" r')
    expect(sql).toContain('r."parent_id" = e."id"')
    expect(sql).toContain(`'metrics.${role}'`)
    expect(sql).toContain('r."xp_metrics_id"::text = $3::text')
  }
  expect(sql).not.toMatch(/status\s*=\s*'draft'/)
})

test('the query prefers a running or decided test and uses the executor schema', async () => {
  const { exec, req } = fixture()
  Object.assign(req.payload.db, { schemaName: 'custom"schema' })
  await expect(remove(req)).rejects.toThrow(deleteMessage)
  expect(exec.calls[0]!.text).toContain('"custom""schema"."xp_phases"')
  expect(exec.calls[0]!.text).toContain("ORDER BY CASE WHEN usage.status IN ('running', 'decided') THEN 0 ELSE 1 END")
})

test('delete allows an unused goal', async () => {
  const { req } = fixture(false)
  await expect(remove(req)).resolves.toBeUndefined()
})

test.each([{ slug: 'renamed' }, { source: 'count' }])('a used goal refuses an identity change: %j', async data => {
  const { exec, req } = fixture()
  await expect(change(req, data)).rejects.toMatchObject({ status: 400, isPublic: true, message: changeMessage })
  expect(exec.calls).toHaveLength(1)
})

test.each([{ slug: 'renamed' }, { source: 'count' }])('an unused goal allows an identity change: %j', async data => {
  await expect(change(fixture(false).req, data)).resolves.toEqual(data)
})

test.each([
  { name: 'New name' }, { direction: 'decrease' }, { attributionWindowHours: 24 },
  { capping: { type: 'absolute', value: 20 } }, { minSampleSize: 250 }, { guardrailThreshold: 0.1 },
  { ...originalDoc, name: 'Renamed with unchanged identity' },
])('other changes and unchanged identity need no usage check: %j', async data => {
  const { exec, req } = fixture()
  await expect(change(req, data)).resolves.toEqual(data)
  expect(exec.calls).toEqual([])
})

test('create needs no usage check', async () => {
  const { exec, req } = fixture()
  await expect(change(req, originalDoc, 'create')).resolves.toEqual(originalDoc)
  expect(exec.calls).toEqual([])
})

test.each(['delete', 'update'])('%s queries only the request session when a transaction exists', async operation => {
  const { exec, req } = fixture()
  const pool = createFakeExecutor({ throwOn: 1 })
  req.payload.db.drizzle = { execute: pool.execute } as typeof req.payload.db.drizzle
  req.transactionID = Promise.resolve(req.transactionID!)
  await expect(operation === 'delete' ? remove(req) : change(req, { source: 'count' })).rejects.toBeInstanceOf(XpGoalInUseError)
  expect(exec.calls).toHaveLength(1)
  expect(pool.calls).toEqual([])
})

test.each(['delete', 'update'])('%s without a transaction uses the pooled executor', async operation => {
  const exec = createFakeExecutor({ results: [{ rows: [{ name: 'Signup test' }] }] })
  const payload = fakePayload({ executor: exec })
  const req = fakeReq({ payload })
  await expect(operation === 'delete' ? remove(req) : change(req, { slug: 'changed' })).rejects.toBeInstanceOf(XpGoalInUseError)
  expect(exec.calls).toHaveLength(1)
  expect(payload.calls).toEqual([])
})

test('a missing transaction session fails closed instead of reading the pool', async () => {
  const req = fakeReq({ transactionID: 'missing' })
  await expect(remove(req)).rejects.toBeInstanceOf(XpNoTransactionError)
})

test.each(['delete', 'update'])('%s propagates SQL errors unchanged', async operation => {
  const error = new Error('SQL failure')
  const exec = createFakeExecutor({ throwOn: { at: 1, error } })
  const req = exec.withSession()
  await expect(operation === 'delete' ? remove(req) : change(req, { source: 'count' })).rejects.toBe(error)
})

test.each([deleteMessage, changeMessage])('Payload REST returns the public goal refusal: %s', async message => {
  const url = new URL('utilities/routeError.js', import.meta.resolve('payload'))
  const { routeError } = await import(url.href) as { routeError(args: {
    collection: { config: SanitizedCollectionConfig }; err: Error; req: PayloadRequest
  }): Promise<Response> }
  const req = fakeReq({ payload: fakePayload({ config: { loggingLevels: {}, hooks: {} } }) })
  const response = await routeError({ collection: { config: metricsCollection(sampleOptions()) as SanitizedCollectionConfig },
    req, err: new XpGoalInUseError(message) })
  expect(response.status).toBe(400)
  expect(await response.json()).toEqual({ errors: [{ message }] })
})
