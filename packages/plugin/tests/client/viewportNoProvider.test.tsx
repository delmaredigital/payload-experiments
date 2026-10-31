// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import { ViewportExposure } from '../../src/client/ViewportExposure.js'
import { __resetBeaconsForTests } from '../../src/client/beacon.js'
import { transport } from './helpers.js'

afterEach(__resetBeaconsForTests)
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

test.each(['development', 'production'])('without provider, expose renders and warns once in %s, never sending', mode => {
  vi.stubEnv('NODE_ENV', mode)
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const { sendBeacon, fetch } = transport()
  const Observer = vi.fn()
  vi.stubGlobal('IntersectionObserver', Observer)
  const tree = <StrictMode><ViewportExposure expose={{ slug: 'test', phase: 1, arm: 'control' }}>Content</ViewportExposure></StrictMode>
  const view = render(tree)
  expect(view.container.textContent).toBe('Content')
  view.rerender(tree)
  view.unmount()
  expect(() => render(tree)).not.toThrow()
  expect(error).toHaveBeenCalledTimes(1)
  expect(error).toHaveBeenCalledWith(expect.stringContaining('ExperimentsProvider'))
  expect(sendBeacon).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
  expect(Observer).not.toHaveBeenCalled()
})

test('without expose no provider is needed and nothing is logged', () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const { sendBeacon } = transport()
  const view = render(<ViewportExposure>Content</ViewportExposure>)
  expect(view.container.querySelector('[data-xp-sentinel]')).toBeNull()
  expect(view.container.innerHTML).toBe('Content')
  expect(error).not.toHaveBeenCalled()
  expect(sendBeacon).not.toHaveBeenCalled()
})
