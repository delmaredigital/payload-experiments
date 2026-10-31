import type { CollectionAfterChangeHook } from 'payload'
import { afterEach, expect, test, vi } from 'vitest'
import { neverThrow } from '../../src/hooks/hostHook.js'

afterEach(() => vi.restoreAllMocks())

test.each(['throw', 'reject'])('a hook that %ss reports the failure and returns the saved doc', async mode => {
  const error = new Error('marker unavailable')
  const report = vi.spyOn(console, 'error').mockImplementation(() => {})
  const hook: CollectionAfterChangeHook = mode === 'throw' ? () => { throw error } : async () => { throw error }
  const doc = { id: 1, title: 'Saved' }
  const args = { doc } as Parameters<CollectionAfterChangeHook>[0]
  expect(await neverThrow('contentChanges', hook)(args)).toBe(doc)
  expect(report).toHaveBeenCalledExactlyOnceWith('[payload-experiments] contentChanges failed; the document was saved without it', error)
})

test('successful hooks receive the original arguments and preserve their result', async () => {
  const args = { doc: { id: 1 } } as Parameters<CollectionAfterChangeHook>[0]
  const result = { id: 1, marker: true }
  const hook = vi.fn(() => result)
  expect(await neverThrow('test', hook)(args)).toBe(result)
  expect(hook).toHaveBeenCalledExactlyOnceWith(args)
})
