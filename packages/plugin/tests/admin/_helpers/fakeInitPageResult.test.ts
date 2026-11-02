import type { InitPageResult } from 'payload'
import { expect, expectTypeOf, test } from 'vitest'
import { fakeInitPageResult } from './fakeInitPageResult.js'

test('the page result fake is assignable to Payload InitPageResult', () => {
  expectTypeOf<ReturnType<typeof fakeInitPageResult>>().toExtend<InitPageResult>()
  expect(fakeInitPageResult().docID).toBeUndefined()
  expect(fakeInitPageResult({ docID: '123' }).docID).toBe('123')
})
