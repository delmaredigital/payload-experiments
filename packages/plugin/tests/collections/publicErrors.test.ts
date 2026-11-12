import { expect, test } from 'vitest'
import { XpLockedFieldError, XpRefusal } from '../../src/errors.js'
import { experimentsCollection } from '../../src/collections/experiments/config.js'
import { sampleOptions } from './fixtures.js'
import { fakeReq } from '../_fakes/req.js'
import { fakePayload } from '../_fakes/payload.js'
import { refusalMessage } from '../../src/testSurface/copy/common.js'
import type { PayloadRequest, SanitizedCollectionConfig } from 'payload'

test('locked-field errors expose a public HTTP 400 and the experiment status', () => {
  const error = new XpLockedFieldError('arms', 'running')
  expect(error).toBeInstanceOf(Error)
  expect(error).toMatchObject({ status: 400, isPublic: true, field: 'arms', experimentStatus: 'running', message: 'arms is locked in running' })
})

test.each([
  ['locked-placement', '“Better hero” is running and this is the only place it appears. Stop the test, or keep its block on this page.'],
  ['stale-edit', 'Someone else changed this test. Reload to see their changes.'],
  // deleteExperiment's refusal for a test that is no longer a draft (DELETE → deleteGuard).
  ['invalid-status', 'This action is not available in the current status.'],
] as const)('Payload REST error handling returns the public %s code and HTTP 409', async (code, message) => {
  // Exercise the installed Payload formatter rather than assuming custom Error
  // properties survive its REST error handling. No Payload boot or database.
  const url = new URL('utilities/routeError.js', import.meta.resolve('payload'))
  const { routeError } = await import(url.href) as { routeError(args: {
    collection: { config: SanitizedCollectionConfig }; err: Error; req: PayloadRequest
  }): Promise<Response> }
  const collection = experimentsCollection(sampleOptions()) as SanitizedCollectionConfig
  const req = fakeReq({ payload: fakePayload({ config: { loggingLevels: {}, hooks: {} } }) })
  const response = await routeError({ collection: { config: collection }, req,
    err: new XpRefusal(code, message, { internal: true }, 409) })
  expect(response.status).toBe(409)
  // Detail stays server-side: only the code and the public message are returned.
  expect(await response.json()).toEqual({ errors: [{ code, message }] })
  if (code === 'stale-edit') expect(refusalMessage(code, 409, message)).toBe(message)
})
test.each([404, 409, 422, 500] as const)('refusals remain public and preserve HTTP %s', status => {
  const error = new XpRefusal('invalid-body', 'Invalid experiment body', { field: 'arms' }, status)
  expect(error).toBeInstanceOf(Error)
  expect(error).toMatchObject({ status, isPublic: true, code: 'invalid-body', detail: { field: 'arms' }, message: 'Invalid experiment body' })
})


test("Puck's installed save error mapper preserves a page-guard sentence for its Save Failed dialog", async () => {
  const url = new URL('utils/payloadErrors.js', import.meta.resolve('@delmaredigital/payload-puck'))
  const { payloadErrorResponse } = await import(url.href) as { payloadErrorResponse(error: unknown): Response | null }
  const message = '“Better hero” is running and this is the only place it appears. Stop the test, or keep its block on this page.'
  const response = payloadErrorResponse(new XpRefusal('locked-placement', message, { internal: true }, 409))
  expect(response?.status).toBe(409)
  expect(await response?.json()).toEqual({ error: message })
})

test('a plain host collection preserves the page-guard sentence through Payload REST', async () => {
  const url = new URL('utilities/routeError.js', import.meta.resolve('payload'))
  const { routeError } = await import(url.href) as { routeError(args: {
    collection: { config: SanitizedCollectionConfig }; err: Error; req: PayloadRequest
  }): Promise<Response> }
  const req = fakeReq({ payload: fakePayload({ config: { loggingLevels: {}, hooks: {} } }) })
  const collection = { slug: 'pages', hooks: {} } as SanitizedCollectionConfig
  const message = '“Better hero” is running and this is the only place it appears. Stop the test, or keep its block on this page.'
  const response = await routeError({ collection: { config: collection }, req,
    err: new XpRefusal('locked-placement', message, { internal: true }, 409) })
  expect(response.status).toBe(409)
  expect(await response.json()).toEqual({ errors: [{ message }] })
})
