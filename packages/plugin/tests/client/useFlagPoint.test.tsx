// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ExperimentsProvider } from '../../src/client/ExperimentsProvider.js'
import { useFlagPoint } from '../../src/client/useFlagPoint.js'
import { __resetBeaconsForTests } from '../../src/client/beacon.js'
import type { ExposurePolicy } from '../../src/types/contracts.js'
import { assignments, bodyOf, transport } from './helpers.js'

afterEach(__resetBeaconsForTests)
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
beforeEach(() => { vi.stubEnv('NODE_ENV', 'development') })

test('reads server results, preserves numeric ids, and mount/re-render never expose', () => {
  const { sendBeacon, fetch } = transport()
  const value = assignments()
  const wrapper = ({ children }: { children: ReactNode }) => <ExperimentsProvider value={value}>{children}</ExperimentsProvider>
  const point = renderHook(() => useFlagPoint<{ label: string }>('signup'), { wrapper })
  expect(point.result.current).toMatchObject({ arm: 'control', params: { label: 'Sign up' }, source: 'experiment', experiment: 'signup-test', experimentId: 42 })
  point.rerender()
  const fallback = renderHook(() => useFlagPoint('defaults'), { wrapper })
  expect(fallback.result.current).toMatchObject({ arm: 'control', params: { label: 'Default' }, source: 'default' })
  expect(fallback.result.current).not.toHaveProperty('experimentId')
  expect(fallback.result.current).not.toHaveProperty('experiment')
  expect(sendBeacon).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
})

test('manual exposes the rendered arm, once per slug/phase/arm across mounts', async () => {
  const { sendBeacon } = transport()
  const value = assignments()
  const wrapper = ({ children }: { children: ReactNode }) => <ExperimentsProvider value={value}>{children}</ExperimentsProvider>
  const first = renderHook(() => useFlagPoint('signup'), { wrapper })
  first.result.current.expose('variantA')
  first.result.current.expose('variantA')
  first.unmount()
  renderHook(() => useFlagPoint('signup'), { wrapper }).result.current.expose('variantA')
  expect(sendBeacon).toHaveBeenCalledTimes(1)
  expect(sendBeacon.mock.calls[0]?.[0]).toBe('/custom-api/xp/events')
  expect(await bodyOf(sendBeacon.mock.calls[0]![1] as Blob)).toEqual({ events: [{ type: 'exposure', experiment: 'signup-test', phase: 1, arm: 'variantA', policy: 'manual' }] })
})

test.each<ExposurePolicy>(['render', 'viewport', 'pageview'])('%s policy never manually exposes', policy => {
  const { sendBeacon } = transport()
  const value = assignments()
  value.flagPoints.signup!.policy = policy
  const wrapper = ({ children }: { children: ReactNode }) => <ExperimentsProvider value={value}>{children}</ExperimentsProvider>
  renderHook(() => useFlagPoint('signup'), { wrapper }).result.current.expose('variantA')
  expect(sendBeacon).not.toHaveBeenCalled()
})

test.each(['not-exposable', 'default'])('%s entries never expose', condition => {
  const { sendBeacon } = transport()
  const value = assignments()
  if (condition === 'not-exposable') value.flagPoints.signup!.exposable = false
  else value.flagPoints.signup!.source = 'default'
  const wrapper = ({ children }: { children: ReactNode }) => <ExperimentsProvider value={value}>{children}</ExperimentsProvider>
  renderHook(() => useFlagPoint('signup'), { wrapper }).result.current.expose('control')
  expect(sendBeacon).not.toHaveBeenCalled()
})

test.each([true, false])('missing point in development throws with or without provider (%s)', provider => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const wrapper = ({ children }: { children: ReactNode }) => provider ? <ExperimentsProvider value={assignments()}>{children}</ExperimentsProvider> : <>{children}</>
  expect(() => renderHook(() => useFlagPoint('missing-point'), { wrapper })).toThrow(/missing-point.*allow-listed in toClientAssignments/)
})

test.each([true, false])('production missing point returns control and logs once per id (%s)', provider => {
  vi.stubEnv('NODE_ENV', 'production')
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const { sendBeacon } = transport()
  const wrapper = ({ children }: { children: ReactNode }) => provider ? <ExperimentsProvider value={assignments()}>{children}</ExperimentsProvider> : <>{children}</>
  const hook = renderHook(() => useFlagPoint('missing'), { wrapper })
  hook.rerender()
  expect(hook.result.current).toMatchObject({ arm: 'control', params: {}, source: 'default' })
  hook.result.current.expose('variantA')
  expect(sendBeacon).not.toHaveBeenCalled()
  expect(error).toHaveBeenCalledTimes(1)
  renderHook(() => useFlagPoint('another'), { wrapper })
  expect(error).toHaveBeenCalledTimes(2)
})

// Review regression: prototype properties are absent from the server allow-list.
test.each(['toString', 'constructor', '__proto__'])('inherited key %s follows missing-entry handling', key => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const wrapper = ({ children }: { children: ReactNode }) => <ExperimentsProvider value={assignments()}>{children}</ExperimentsProvider>
  expect(() => renderHook(() => useFlagPoint(key), { wrapper })).toThrow(/allow-listed in toClientAssignments/)
  error.mockClear()
  vi.stubEnv('NODE_ENV', 'production')
  const hook = renderHook(() => useFlagPoint(key), { wrapper })
  hook.rerender()
  expect(hook.result.current).toMatchObject({ arm: 'control', params: {} })
  expect(error).toHaveBeenCalledTimes(1)
})
