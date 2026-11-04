// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { expect, test } from 'vitest'
import { acquireArms, setArms, useArms } from '../../../src/puck/editor/armsCache.js'

test('releasing the same mount twice does not release another block that still uses the test', () => {
  const first = acquireArms('t-release')
  setArms('t-release', ['control', 'variantA'])
  const second = acquireArms('t-release')
  first()
  first()
  const third = acquireArms('t-release')
  const { result } = renderHook(() => useArms('t-release'))
  expect(result.current?.arms).toEqual(['control', 'variantA'])
  second(); third()
})
