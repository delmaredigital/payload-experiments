import { expect, test } from 'vitest'
import { XpLockedFieldError, XpRefusal } from '../../src/errors.js'
import { experimentsCollection } from '../../src/collections/experiments/config.js'
import { sampleOptions } from './fixtures.js'
import { fakeReq } from '../_fakes/req.js'
import { fakePayload } from '../_fakes/payload.js'
import { refusalMessage } from '../../src/admin/copy/common.js'
import type { PayloadRequest, SanitizedCollectionConfig } from 'payload'

test('locked-field errors expose a public HTTP 400 and the experiment status', () => {
  const error = new XpLockedFieldError('arms', 'running')
  expect(error).toBeInstanceOf(Error)
  expect(error).toMatchObject({ status: 400, isPublic: true, field: 'arms', experimentStatus: 'running', message: 'arms is locked in running' })
})

test('Payload REST error handling returns the public stale-edit code and HTTP 409', async () => {
  // Exercise the installed Payload formatter rather than assuming custom Error
  // properties survive its REST error handling. No Payload boot or database.
  const url = new URL('utilities/routeError.js', import.meta.resolve('payload'))
  const { routeError } = await import(url.href) as { routeError(args: {
    collection: { config: SanitizedCollectionConfig }; err: Error; req: PayloadRequest
  }): Promise<Response> }
  const collection = experimentsCollection(sampleOptions()) as SanitizedCollectionConfig
  const req = fakeReq({ payload: fakePayload({ config: { loggingLevels: {}, hooks: {} } }) })
  const message = 'Someone else changed this test. Reload to see their changes.'
  const response = await routeError({ collection: { config: collection }, req,
    err: new XpRefusal('stale-edit', message, undefined, 409) })
  expect(response.status).toBe(409)
  expect(await response.json()).toEqual({ errors: [{ code: 'stale-edit', message }] })
  expect(refusalMessage('stale-edit', 409, message)).toBe(message)
})
test.each([404, 409, 422, 500] as const)('refusals remain public and preserve HTTP %s', status => {
  const error = new XpRefusal('invalid-body', 'Invalid experiment body', { field: 'arms' }, status)
  expect(error).toBeInstanceOf(Error)
  expect(error).toMatchObject({ status, isPublic: true, code: 'invalid-body', detail: { field: 'arms' }, message: 'Invalid experiment body' })
})
