import { expect, test } from 'vitest'
import { findNormalisedPathKey, normalisePath } from '../../src/runtime/normalisePath.js'

test.each([
  ['/', '/'], ['/courses/x/', '/courses/x'], ['/courses/x', '/courses/x'],
  ['/courses/x///', '/courses/x'], ['/courses/%2F/', '/courses/%2F'],
  ['/courses/%2f', '/courses/%2f'],
])('normalisePath(%s) = %s', (input, expected) => {
  expect(normalisePath(input)).toBe(expected)
})


test('normalised key lookup matches own keys only and preserves encoding', () => {
  const paths = Object.assign(Object.create({ '/inherited/': {} }), { '/old/': {}, '/%2F/': {} })
  expect(findNormalisedPathKey(paths, '/old')).toBe('/old/')
  expect(findNormalisedPathKey(paths, '/old/')).toBe('/old/')
  expect(findNormalisedPathKey(paths, '/%2F')).toBe('/%2F/')
  expect(findNormalisedPathKey(paths, '/%2f')).toBeUndefined()
  expect(findNormalisedPathKey(paths, '/inherited')).toBeUndefined()
  expect(findNormalisedPathKey(paths, '/')).toBeUndefined()
})
