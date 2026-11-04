import { expect, test, vi } from 'vitest'
import { deleteOperation } from 'payload'
import { deleteGuard, deleteGuardAfter } from '../../src/collections/experiments/deleteGuard.js'
import * as transitions from '../../src/transitions/deleteExperiment.js'
import { fakeReq } from '../_fakes/req.js'
import { experimentsCollection } from '../../src/collections/experiments/config.js'
import { sampleOptions } from './fixtures.js'
import { fakePayload } from '../_fakes/payload.js'
import { createFakeExecutor } from '../_fakes/executor.js'

test('hooks delegate cascade-before and compile-after with the original request', async () => {
  const req = fakeReq()
  const before = vi.spyOn(transitions, 'deleteExperiment').mockResolvedValue()
  const after = vi.spyOn(transitions, 'deleteExperimentAfter').mockResolvedValue()
  const doc = { id: 3 }
  await Reflect.apply(deleteGuard, undefined, [{ req, id: 3 }])
  expect(before).toHaveBeenCalledWith(req, 3)
  expect(after).not.toHaveBeenCalled()
  expect(await Reflect.apply(deleteGuardAfter, undefined, [{ req, id: 3, doc }])).toBe(doc)
  expect(after).toHaveBeenCalledWith(req, 3)
  vi.restoreAllMocks()
})
test('access.delete filters bulk requests to draft/archived, denies truthy non-booleans', async () => {
  const options = sampleOptions()
  const req = fakeReq()
  for (const allowed of [true, false, 'yes', {}]) {
    options.access.manage = () => allowed as boolean
    const access = experimentsCollection(options).access!.delete!
    expect(await access({ req })).toEqual(allowed === true ? { status: { in: ['draft', 'archived'] } } : false)
  }
})

test('Payload refuses a non-manager REST-shaped bulk delete without discovery or advisory locks', async () => {
  const options = sampleOptions()
  options.access.manage = vi.fn(async () => false)
  const executor = createFakeExecutor()
  const payload = fakePayload({ executor, config: { custom: { xp: options } },
    collections: { 'xp-experiments': [{ id: 2 }, { id: 1 }] } })
  const req = executor.withSession({ payload })
  req.user = { id: 42 } as typeof req.user
  Object.assign(req, { i18n: { t: vi.fn(), language: 'en' } })
  const collection = experimentsCollection(options)
  // REST calls the operation without overrideAccess; Local API defaults it to true.
  await expect(deleteOperation({ collection: { config: collection }, req,
    where: { id: { in: [2, 1] } } } as never)).rejects.toMatchObject({ status: 403 })
  expect(options.access.manage).toHaveBeenCalledWith({ req })
  expect(payload.calls.filter(call => call.method === 'find' && call.args.collection === 'xp-experiments')).toEqual([])
  expect(executor.calls.filter(call => call.text.includes('pg_advisory_xact_lock'))).toEqual([])
})
