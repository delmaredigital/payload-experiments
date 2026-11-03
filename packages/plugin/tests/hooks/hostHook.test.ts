import { safeError } from '../../src/log.js'
import type { CollectionAfterChangeHook } from 'payload'
import { afterEach, expect, test, vi } from 'vitest'
import { neverThrow, neverThrowBefore } from '../../src/hooks/hostHook.js'

afterEach(() => vi.restoreAllMocks())

test.each(['throw', 'reject'])('a hook that %ss reports the failure and returns the saved doc', async mode => {
  const error = new Error('marker unavailable')
  const report = vi.spyOn(console, 'error').mockImplementation(() => {})
  const hook: CollectionAfterChangeHook = mode === 'throw' ? () => { throw error } : async () => { throw error }
  const doc = { id: 1, title: 'Saved' }
  const args = { doc } as Parameters<CollectionAfterChangeHook>[0]
  expect(await neverThrow('contentChanges', hook)(args)).toBe(doc)
  expect(report).toHaveBeenCalledExactlyOnceWith('[payload-experiments] contentChanges failed; the document was saved without it', safeError(error))
})

test('successful hooks receive the original arguments and preserve their result', async () => {
  const args = { doc: { id: 1 } } as Parameters<CollectionAfterChangeHook>[0]
  const result = { id: 1, marker: true }
  const hook = vi.fn(() => result)
  expect(await neverThrow('test', hook)(args)).toBe(result)
  expect(hook).toHaveBeenCalledExactlyOnceWith(args)
})

test('a throwing error getter cannot prevent a host save in either hook', async () => {
  const error = new Error('marker unavailable')
  error.stack = 'Error: marker unavailable'
  Object.defineProperty(error, 'name', { get() { throw new Error('host getter failed') } })
  const report = vi.spyOn(console, 'error').mockImplementation(() => {})
  const doc = { id: 1, title: 'Saved' }
  const afterArgs = { doc } as Parameters<CollectionAfterChangeHook>[0]
  const beforeArgs = { data: doc } as unknown as Parameters<ReturnType<typeof neverThrowBefore>>[0]
  expect(await neverThrowBefore('contentChanges', () => { throw error })(beforeArgs)).toBe(doc)
  expect(await neverThrow('contentChanges', () => { throw error })(afterArgs)).toBe(doc)
  expect(report).toHaveBeenCalledTimes(2)
  expect(report.mock.calls.every(call => JSON.stringify(call[1]) === '{"name":"Error"}')).toBe(true)
})
