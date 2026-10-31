// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ExperimentsProvider } from '../../src/client/ExperimentsProvider.js'
import { useExperiment } from '../../src/client/useExperiment.js'
import { __resetBeaconsForTests } from '../../src/client/beacon.js'
import type { ExposurePolicy } from '../../src/types/contracts.js'
import { assignments, bodyOf, transport } from './helpers.js'

afterEach(__resetBeaconsForTests)
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
beforeEach(() => { vi.stubEnv('NODE_ENV', 'development') })

test('reads only the server entry and never exposes on mount or re-render', () => {
  const { sendBeacon, fetch } = transport()
  const wrapper = ({ children }: { children: ReactNode }) => <ExperimentsProvider value={assignments()}>{children}</ExperimentsProvider>
  const hook = renderHook(() => useExperiment<{ label: string }>('signup-test'), { wrapper })
  expect(hook.result.current).toMatchObject({ arm: 'control', params: { label: 'Sign up' } })
  hook.rerender()
  expect(sendBeacon).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
})

test('sends the rendered arm once, with new arms and phases getting their own keys', async () => {
  const { sendBeacon } = transport()
  const value = assignments()
  const wrapper = ({ children }: { children: ReactNode }) => <ExperimentsProvider value={value}>{children}</ExperimentsProvider>
  const hook = renderHook(() => useExperiment('signup-test'), { wrapper })
  hook.result.current.expose('variantA')
  hook.result.current.expose('variantA')
  expect(await bodyOf(sendBeacon.mock.calls[0]![1] as Blob)).toEqual({ events: [{ type: 'exposure', experiment: 'signup-test', phase: 1, arm: 'variantA', policy: 'manual' }] })
  hook.result.current.expose('control')
  value.experiments['signup-test']!.phase = 2
  hook.rerender()
  hook.result.current.expose('variantA')
  hook.unmount()
  renderHook(() => useExperiment('signup-test'), { wrapper }).result.current.expose('variantA')
  expect(sendBeacon).toHaveBeenCalledTimes(3)
})

test.each<ExposurePolicy>(['render', 'viewport', 'pageview'])('%s policy never exposes manually', policy => {
  const { sendBeacon } = transport()
  const value = assignments()
  value.experiments['signup-test']!.policy = policy
  const wrapper = ({ children }: { children: ReactNode }) => <ExperimentsProvider value={value}>{children}</ExperimentsProvider>
  renderHook(() => useExperiment('signup-test'), { wrapper }).result.current.expose('variantA')
  expect(sendBeacon).not.toHaveBeenCalled()
})

test('non-exposable manual entries never expose', () => {
  const { sendBeacon } = transport()
  const value = assignments()
  value.experiments['signup-test']!.exposable = false
  const wrapper = ({ children }: { children: ReactNode }) => <ExperimentsProvider value={value}>{children}</ExperimentsProvider>
  renderHook(() => useExperiment('signup-test'), { wrapper }).result.current.expose('control')
  expect(sendBeacon).not.toHaveBeenCalled()
})

test.each([true, false])('missing experiment in development throws (%s)', provider => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const wrapper = ({ children }: { children: ReactNode }) => provider ? <ExperimentsProvider value={assignments()}>{children}</ExperimentsProvider> : <>{children}</>
  expect(() => renderHook(() => useExperiment('missing-test'), { wrapper })).toThrow(/missing-test.*allow-listed in toClientAssignments/)
})

test.each([true, false])('missing experiment in production defaults and warns once (%s)', provider => {
  vi.stubEnv('NODE_ENV', 'production')
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const { sendBeacon } = transport()
  const wrapper = ({ children }: { children: ReactNode }) => provider ? <ExperimentsProvider value={assignments()}>{children}</ExperimentsProvider> : <>{children}</>
  const hook = renderHook(() => useExperiment('missing'), { wrapper })
  hook.rerender()
  expect(hook.result.current).toMatchObject({ arm: 'control', params: {} })
  hook.result.current.expose('variantA')
  expect(sendBeacon).not.toHaveBeenCalled()
  expect(error).toHaveBeenCalledTimes(1)
  renderHook(() => useExperiment('another'), { wrapper })
  expect(error).toHaveBeenCalledTimes(2)
})

// Review regression: prototype properties are absent from the server allow-list.
test.each(['toString', 'constructor', '__proto__'])('inherited key %s follows missing-entry handling', key => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const wrapper = ({ children }: { children: ReactNode }) => <ExperimentsProvider value={assignments()}>{children}</ExperimentsProvider>
  expect(() => renderHook(() => useExperiment(key), { wrapper })).toThrow(/allow-listed in toClientAssignments/)
  error.mockClear()
  vi.stubEnv('NODE_ENV', 'production')
  const hook = renderHook(() => useExperiment(key), { wrapper })
  hook.rerender()
  expect(hook.result.current).toMatchObject({ arm: 'control', params: {} })
  expect(error).toHaveBeenCalledTimes(1)
})
