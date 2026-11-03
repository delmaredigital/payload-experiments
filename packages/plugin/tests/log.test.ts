import { expect, test } from 'vitest'
import { safeError } from '../src/log.js'
import { XpAnalysisError, XpLockedFieldError, XpNoTransactionError, XpNotImplemented, XpRefusal } from '../src/errors.js'
import { ResultsBudgetError } from '../src/db/pgExecutor.js'
import { EventsBodyError } from '../src/events/body.js'

test('pg errors retain only name, SQLSTATE and frames, including multi-line messages', () => {
  const error = Object.assign(new Error('duplicate key secret-value\nmore secret-value'), {
    name: 'error', code: '23505', detail: 'Key (dedupe_key)=(secret-value) already exists.',
    where: 'secret-value', table: 'private_table', column: 'private_column', constraint: 'private_constraint',
    data: 'secret-value', cause: new Error('secret-value'),
    stack: 'error: duplicate key secret-value\nmore secret-value\n    at insert (/app/events.js:1:2)\n    at async handler (/app/api.js:3:4)',
  })
  expect(safeError(error)).toEqual({ name: 'error', code: '23505', stack: '    at insert (/app/events.js:1:2)\n    at async handler (/app/api.js:3:4)' })
  expect(JSON.stringify(safeError(error))).not.toContain('secret-value')
})

test('refusals retain their code but omit messages because construction sites interpolate stored slugs', () => {
  const error = new XpRefusal('invalid-status', 'Missing last test phase for experiment secret-value', { secret: 'secret-value' }, 409)
  expect(safeError(error)).toEqual({ name: 'XpRefusal', code: 'invalid-status', stack: expect.stringContaining('at ') })
  expect(JSON.stringify(safeError(error))).not.toContain('secret-value')
})

test('locked-field messages may contain request keys and are omitted', () => {
  const error = new XpLockedFieldError('secret-value', 'running')
  expect(safeError(error)).not.toHaveProperty('message')
  expect(JSON.stringify(safeError(error))).not.toContain('secret-value')
})

test.each([new XpNoTransactionError(), new XpNotImplemented('CORE-12'), new ResultsBudgetError()])('keeps authored message for $name', error => {
  expect(safeError(error)).toEqual({ name: error.name, message: error.message, stack: expect.stringContaining('at ') })
})

test.each(['secret-value', 42, undefined, null, {}, () => {}])('non-Error value %s has only a typeof name', value => {
  expect(safeError(value)).toEqual({ name: typeof value })
})

test.each(['23505', '22P02', 'ABCDE', 'bad-code', '23505\n', '2350', 'abcde', 23505])('accepts only SQLSTATE codes: %s', code => {
  const error = Object.assign(new Error('secret-value'), { code, stack: 'Error: secret-value\nno frames here' })
  expect(safeError(error)).toEqual({ name: 'Error', ...(typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? { code } : {}) })
})

test('unknown and body error classes never retain messages or spoof trusted names', () => {
  for (const error of [Object.assign(new Error('secret-value'), { name: 'XpNoTransactionError' }), new EventsBodyError(422, 'invalid-body', 'secret-value')]) {
    expect(safeError(error)).not.toHaveProperty('message')
    expect(JSON.stringify(safeError(error))).not.toContain('secret-value')
  }
})

test('missing string name and stack fall back without following cause', () => {
  const error = Object.assign(new Error('secret-value'), { name: 42, stack: undefined, cause: new Error('secret-value') })
  expect(safeError(error)).toEqual({ name: 'Error' })
})

test.each(['name', 'code', 'message', 'stack'] as const)('a throwing %s getter cannot escape safeError', property => {
  const error = new Error('secret-value')
  // Materialize V8's lazy stack before installing hostile header getters.
  error.stack = 'Error: secret-value\n    at insert (/app/events.js:1:2)'
  Object.defineProperty(error, property, { get() { throw new Error('host getter failed') } })
  expect(safeError(error)).toEqual({ name: 'Error' })
})

test.each(['get', 'has', 'getPrototypeOf'] as const)('a throwing Proxy %s trap cannot escape safeError', trap => {
  const error = new Proxy(new Error('secret-value'), { [trap]() { throw new Error('host trap failed') } })
  expect(safeError(error)).toEqual({ name: 'Error' })
})

test('does not read a non-Error object stack getter', () => {
  const error = { get stack() { throw new Error('host getter failed') } }
  expect(safeError(error)).toEqual({ name: 'object' })
})

test('removes a multi-line V8 header before retaining real frames', () => {
  const error = new Error('a\n    at SECRET')
  const result = safeError(error)
  expect(result.stack).toContain('at ')
  expect(JSON.stringify(result)).not.toContain('SECRET')
})

test.each(['Error: different\n    at SECRET', 'Unknown header\n    at SECRET', 'Error: secret-value suffix\n    at SECRET'])('omits an unrecognized stack header: %s', stack => {
  expect(safeError(Object.assign(new Error('secret-value'), { stack }))).toEqual({ name: 'Error' })
})

test('an empty-message header still preserves real frames', () => {
  const error = Object.assign(new Error(), { stack: 'Error\n    at insert (/app/events.js:1:2)' })
  expect(safeError(error)).toEqual({ name: 'Error', stack: '    at insert (/app/events.js:1:2)' })
})

test('analysis errors retain their fixed code, message and frames as a plain logged object', () => {
  const error = new XpAnalysisError('no-baseline')
  expect(safeError(error)).toEqual({ name: 'XpAnalysisError', code: 'no-baseline',
    message: 'Phase comparison baseline or shipped arm is missing', stack: expect.stringContaining('at ') })
  expect(safeError(error)).not.toBeInstanceOf(Error)
})
