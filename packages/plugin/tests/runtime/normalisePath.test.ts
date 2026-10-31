import { expect, test } from 'vitest'
import { normalisePath } from '../../src/runtime/normalisePath.js'

test.each([
  ['/', '/'], ['/courses/x/', '/courses/x'], ['/courses/x', '/courses/x'],
  ['/courses/x///', '/courses/x'], ['/courses/%2F/', '/courses/%2F'],
  ['/courses/%2f', '/courses/%2f'],
])('normalisePath(%s) = %s', (input, expected) => {
  expect(normalisePath(input)).toBe(expected)
})
