import { expect, test, vi } from 'vitest'
import { deleteGuard, deleteGuardAfter } from '../../src/collections/experiments/deleteGuard.js'
import * as transitions from '../../src/transitions/deleteExperiment.js'
import { fakeReq } from '../_fakes/req.js'
import { experimentsCollection } from '../../src/collections/experiments/config.js'
import { sampleOptions } from './fixtures.js'

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
