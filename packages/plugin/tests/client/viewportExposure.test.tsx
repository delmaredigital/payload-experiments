// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { StrictMode } from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import { ExperimentGroup } from '../../src/client/ExperimentGroup.js'
import { ViewportExposure } from '../../src/client/ViewportExposure.js'
import { ExperimentsProvider } from '../../src/client/ExperimentsProvider.js'
import { __resetBeaconsForTests } from '../../src/client/beacon.js'
import { assignments, bodyOf, transport } from './helpers.js'

afterEach(__resetBeaconsForTests)
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
const expose = { slug: 'viewport-test', phase: 1, arm: 'variantA' }

function observerMock() {
  const observers: Array<{ callback: IntersectionObserverCallback; observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = []
  const Observer = vi.fn(function (callback: IntersectionObserverCallback) {
    const instance = { callback, observe: vi.fn(), disconnect: vi.fn() }
    observers.push(instance)
    return instance
  })
  vi.stubGlobal('IntersectionObserver', Observer)
  const intersect = (index: number, ratio: number) => {
    const instance = observers[index]!
    act(() => instance.callback([{ target: instance.observe.mock.calls[0]![0] as Element, intersectionRatio: ratio } as IntersectionObserverEntry], {} as IntersectionObserver))
  }
  return { Observer, observers, intersect }
}

test('without expose the children render bare: no wrapper and no sentinel', () => {
  expect(renderToStaticMarkup(<ViewportExposure><p>Content</p></ViewportExposure>)).toBe(renderToStaticMarkup(<p>Content</p>))
  const view = render(<ViewportExposure><p>Content</p></ViewportExposure>)
  expect(view.container.querySelector('[data-xp-viewport]')).toBeNull()
  expect(view.container.querySelector('[data-xp-sentinel]')).toBeNull()
})

test('with expose the wrapper and sentinel styles are fixed and do not depend on children', () => {
  const view = render(<ViewportExposure expose={expose}><p>Short</p></ViewportExposure>)
  const wrapper = view.container.querySelector<HTMLDivElement>('[data-xp-viewport]')!
  const sentinel = view.container.querySelector<HTMLDivElement>('[data-xp-sentinel]')!
  expect(wrapper.style.cssText).toBe('position: relative; display: block;')
  expect(sentinel.style.cssText).toBe('position: absolute; top: 0px; left: 0px; width: 100%; height: 100px; pointer-events: none; visibility: hidden;')
  expect(sentinel.getAttribute('aria-hidden')).toBe('true')
  const style = sentinel.getAttribute('style')
  view.rerender(<ViewportExposure expose={expose}><div style={{ height: 2000 }}>Tall</div></ViewportExposure>)
  expect(view.container.querySelector('[data-xp-sentinel]')!.getAttribute('style')).toBe(style)
})

test('only observes the fixed sentinel with expose; threshold 0.5 sends once and disconnects', async () => {
  const { sendBeacon } = transport()
  const { Observer, observers, intersect } = observerMock()
  const tree = (enabled: boolean) => <ExperimentsProvider value={assignments()}><ViewportExposure expose={enabled ? expose : undefined}><p>Content</p></ViewportExposure></ExperimentsProvider>
  const view = render(tree(false))
  expect(Observer).not.toHaveBeenCalled()
  expect(view.container.querySelector('[data-xp-sentinel]')).toBeNull()
  view.rerender(tree(true))
  expect(Observer).toHaveBeenCalledWith(expect.any(Function), { threshold: 0.5 })
  expect(observers[0]!.observe).toHaveBeenCalledWith(view.container.querySelector('[data-xp-sentinel]'))
  expect(sendBeacon).not.toHaveBeenCalled()
  intersect(0, 0.49)
  expect(sendBeacon).not.toHaveBeenCalled()
  intersect(0, 0.5)
  intersect(0, 1)
  expect(sendBeacon).toHaveBeenCalledTimes(1)
  expect(observers[0]!.disconnect).toHaveBeenCalled()
  expect(await bodyOf(sendBeacon.mock.calls[0]![1])).toEqual({ events: [{ type: 'exposure', experiment: 'viewport-test', phase: 1, arm: 'variantA', policy: 'viewport' }] })
  view.unmount()
  expect(observers[0]!.disconnect).toHaveBeenCalledTimes(3)
})

test('StrictMode/remount dedupe and observer cleanup; nearest provider supplies route', () => {
  const { sendBeacon } = transport()
  const { observers, intersect } = observerMock()
  const tree = <StrictMode><ExperimentsProvider value={assignments({ apiRoute: '/outer' })}>
    <ExperimentsProvider value={assignments({ apiRoute: '/inner' })}><ViewportExposure expose={expose}>Content</ViewportExposure></ExperimentsProvider>
  </ExperimentsProvider></StrictMode>
  const view = render(tree)
  expect(observers[0]!.disconnect).toHaveBeenCalledOnce()
  intersect(1, 0.5)
  view.unmount()
  render(tree)
  intersect(3, 0.5)
  expect(sendBeacon).toHaveBeenCalledTimes(1)
  expect(sendBeacon.mock.calls[0]![0]).toBe('/inner/xp/events')
})

test('missing IntersectionObserver is harmless and sends nothing', () => {
  const { sendBeacon } = transport()
  vi.stubGlobal('IntersectionObserver', undefined)
  expect(() => render(<ExperimentsProvider value={assignments()}><ViewportExposure expose={expose}>Content</ViewportExposure></ExperimentsProvider>)).not.toThrow()
  expect(sendBeacon).not.toHaveBeenCalled()
})

// Measured below 100 ms locally; cap leaves CI headroom.
test('ExperimentGroup renders bare without expose and exposes its fixed group sentinel when provided', async () => {
  expect(renderToStaticMarkup(<ExperimentGroup><p>Content</p></ExperimentGroup>)).toBe('<p>Content</p>')
  const { sendBeacon } = transport(), { intersect } = observerMock()
  const view = render(<ExperimentsProvider value={assignments()}><ExperimentGroup expose={expose}><p>Content</p></ExperimentGroup></ExperimentsProvider>)
  expect(view.container.querySelector('[data-xp-viewport]')?.textContent).toBe('Content')
  expect(view.container.querySelector('[data-xp-sentinel]')).not.toBeNull()
  intersect(0, 0.5)
  expect(await bodyOf(sendBeacon.mock.calls[0]![1])).toEqual({ events: [{ type: 'exposure', experiment: 'viewport-test', phase: 1, arm: 'variantA', policy: 'viewport' }] })
}, 5000)
