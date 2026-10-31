import { expect, test } from 'vitest'
import { XpLockedFieldError, XpRefusal } from '../../src/errors.js'

test('locked-field errors expose a public HTTP 400 and the experiment status', () => {
  const error = new XpLockedFieldError('arms', 'running')
  expect(error).toBeInstanceOf(Error)
  expect(error).toMatchObject({ status: 400, isPublic: true, field: 'arms', experimentStatus: 'running', message: 'arms is locked in running' })
})
test.each([404, 409, 422, 500] as const)('refusals remain public and preserve HTTP %s', status => {
  const error = new XpRefusal('invalid-body', 'Invalid experiment body', { field: 'arms' }, status)
  expect(error).toBeInstanceOf(Error)
  expect(error).toMatchObject({ status, isPublic: true, code: 'invalid-body', detail: { field: 'arms' }, message: 'Invalid experiment body' })
})
