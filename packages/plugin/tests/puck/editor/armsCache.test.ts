// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { acquireArms, publishExperiment, setArms, useArms } from '../../../src/puck/editor/armsCache.js'

afterEach(cleanup)

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


test('an old panel GET cannot replace a newer chrome save', () => {
  const release = acquireArms('t-saved')
  const saved = { name: 'Latest saved name', updatedAt: '2026-11-12T10:01:00Z', status: 'draft' as const,
    arms: [{ key: 'control' as const, kind: 'control' as const, label: 'Original' }] }
  publishExperiment('t-saved', saved)
  const { result } = renderHook(() => useArms('t-saved'))
  act(() => publishExperiment('t-saved', { ...saved, name: 'Old name', updatedAt: '2026-11-12T10:00:00Z' }))
  expect(result.current?.doc).toBe(saved)
  release()
})
