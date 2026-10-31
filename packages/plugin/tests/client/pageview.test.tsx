// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { StrictMode, useEffect } from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import { ExperimentsProvider } from '../../src/client/ExperimentsProvider.js'
import { ExperimentPageview } from '../../src/client/ExperimentPageview.js'
import { trackConversionBeacon } from '../../src/client/trackConversionBeacon.js'
import { __resetBeaconsForTests } from '../../src/client/beacon.js'
import { assignments, bodyOf, transport } from './helpers.js'

afterEach(__resetBeaconsForTests)
afterEach(() => { cleanup(); window.history.replaceState({}, '', '/'); vi.unstubAllGlobals(); vi.restoreAllMocks() })

test('each pageview sends one event and StrictMode/re-render/remount do not duplicate', async () => {
  const { sendBeacon } = transport()
  const value = assignments({ pageviews: [{ slug: 'page-a', phase: 1, arm: 'control' }, { slug: 'page-b', phase: 2, arm: 'variantA' }] })
  const tree = () => <StrictMode><ExperimentsProvider value={{ ...value }}><ExperimentPageview /></ExperimentsProvider></StrictMode>
  const view = render(tree())
  expect(view.container.innerHTML).toBe('')
  view.rerender(tree())
  view.unmount()
  render(tree())
  expect(sendBeacon).toHaveBeenCalledTimes(2)
  expect(await bodyOf(sendBeacon.mock.calls[0]![1])).toEqual({ events: [{ type: 'exposure', experiment: 'page-a', phase: 1, arm: 'control', policy: 'pageview' }] })
  expect(await bodyOf(sendBeacon.mock.calls[1]![1])).toEqual({ events: [{ type: 'exposure', experiment: 'page-b', phase: 2, arm: 'variantA', policy: 'pageview' }] })
})

test('soft navigation keys include pathname, slug, phase and arm', () => {
  const { sendBeacon } = transport()
  const value = assignments({ pageviews: [{ slug: 'page', phase: 1, arm: 'control' }] })
  const tree = () => <ExperimentsProvider value={{ ...value, pageviews: [...value.pageviews] }}><ExperimentPageview /></ExperimentsProvider>
  const view = render(tree())
  window.history.pushState({}, '', '/next')
  view.rerender(tree())
  value.pageviews = [{ slug: 'page', phase: 2, arm: 'control' }]
  view.rerender(tree())
  value.pageviews = [{ slug: 'page', phase: 2, arm: 'variantA' }]
  view.rerender(tree())
  value.pageviews = [{ slug: 'other', phase: 2, arm: 'variantA' }]
  view.rerender(tree())
  view.rerender(tree())
  expect(sendBeacon).toHaveBeenCalledTimes(5)
})

test('empty or missing provider sends nothing', () => {
  const { sendBeacon } = transport()
  render(<ExperimentPageview />)
  render(<ExperimentsProvider value={assignments()}><ExperimentPageview /></ExperimentsProvider>)
  expect(sendBeacon).not.toHaveBeenCalled()
})

test('nearest page provider wins for entries and apiRoute', async () => {
  const { sendBeacon } = transport()
  render(<ExperimentsProvider value={assignments({ apiRoute: '/outer', pageviews: [{ slug: 'outer', phase: 1, arm: 'control' }] })}>
    <ExperimentsProvider value={assignments({ apiRoute: '/inner', pageviews: [{ slug: 'inner', phase: 2, arm: 'variantA' }] })}><ExperimentPageview /></ExperimentsProvider>
  </ExperimentsProvider>)
  expect(sendBeacon).toHaveBeenCalledTimes(1)
  expect(sendBeacon.mock.calls[0]![0]).toBe('/inner/xp/events')
  expect(await bodyOf(sendBeacon.mock.calls[0]![1])).toEqual({ events: [{ type: 'exposure', experiment: 'inner', phase: 2, arm: 'variantA', policy: 'pageview' }] })
})

test('conversion route follows the latest mounted provider and restores on unmount', () => {
  const { sendBeacon } = transport()
  trackConversionBeacon('registration')
  const first = render(<ExperimentsProvider value={assignments({ apiRoute: '/first' })}>First</ExperimentsProvider>)
  trackConversionBeacon('registration')
  const second = render(<ExperimentsProvider value={assignments({ apiRoute: '/second' })}>Second</ExperimentsProvider>)
  trackConversionBeacon('registration')
  second.unmount()
  trackConversionBeacon('registration')
  first.unmount()
  trackConversionBeacon('registration')
  // Calls with no mounted provider send nothing (spec §13).
  expect(sendBeacon.mock.calls.map(call => call[0])).toEqual(['/first/xp/events', '/second/xp/events', '/first/xp/events'])
})

// Review regression: provider registration must precede child passive effects.
test('conversion from a descendant mount effect uses the committed provider route', () => {
  const { sendBeacon } = transport()
  function ConvertOnMount() {
    useEffect(() => { trackConversionBeacon('registration') }, [])
    return null
  }
  render(<ExperimentsProvider value={assignments({ apiRoute: '/mount-api' })}><ConvertOnMount /></ExperimentsProvider>)
  expect(sendBeacon).toHaveBeenCalledWith('/mount-api/xp/events', expect.any(Blob))
})

// Review regression: route updates must preserve most-recently-mounted precedence.
test('updating an older provider preserves mount order and its updated route after newer unmounts', () => {
  const { sendBeacon } = transport()
  const first = render(<ExperimentsProvider value={assignments({ apiRoute: '/first' })}>First</ExperimentsProvider>)
  const second = render(<ExperimentsProvider value={assignments({ apiRoute: '/second' })}>Second</ExperimentsProvider>)
  first.rerender(<ExperimentsProvider value={assignments({ apiRoute: '/first-updated' })}>First</ExperimentsProvider>)
  trackConversionBeacon('registration')
  second.unmount()
  trackConversionBeacon('registration')
  first.unmount()
  trackConversionBeacon('registration')
  expect(sendBeacon.mock.calls.map(call => call[0])).toEqual(['/second/xp/events', '/first-updated/xp/events'])
})
