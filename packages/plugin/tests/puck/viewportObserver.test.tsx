// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { ExperimentsProvider } from '../../src/client/ExperimentsProvider.js'
import { __resetBeaconsForTests } from '../../src/client/beacon.js'
import { ExperimentSlot } from '../../src/puck/ExperimentSlot.js'
import type { ClientAssignments } from '../../src/types/assignments.js'

afterEach(() => { cleanup(); __resetBeaconsForTests(); vi.unstubAllGlobals() })

test('the server slot attaches an observer only when xpExpose is present', () => {
  const observe = vi.fn(), disconnect = vi.fn()
  const Observer = vi.fn(function () { return { observe, disconnect } })
  vi.stubGlobal('IntersectionObserver', Observer)
  const value: ClientAssignments = { v: 1, revision: 1, apiRoute: '/api', experiments: {}, flagPoints: {}, pageviews: [] }
  const props: Parameters<typeof ExperimentSlot.render>[0] = {
    id: 'slot-1', experiment: { id: 1, slug: 'example' }, xpSlot: 'variantA',
    control: () => <p>Original</p>, variantA: () => <p>Variant A</p>, variantB: () => null, variantC: () => null,
    puck: { renderDropZone: () => null, metadata: {}, isEditing: false, dragRef: null },
  }
  const tree = (xpExpose?: { slug: string; arm: string; phase: number }) =>
    <ExperimentsProvider value={value}>{ExperimentSlot.render({ ...props, xpExpose })}</ExperimentsProvider>
  const view = render(tree())
  expect(Observer).not.toHaveBeenCalled()
  expect(observe).not.toHaveBeenCalled()
  expect(view.container.querySelector('[data-xp-sentinel]')).toBeNull()

  view.rerender(tree({ slug: 'example', arm: 'variantA', phase: 1 }))
  expect(Observer).toHaveBeenCalledExactlyOnceWith(expect.any(Function), { threshold: 0.5 })
  const sentinel = view.container.querySelector<HTMLDivElement>('[data-xp-sentinel]')!
  expect(observe).toHaveBeenCalledExactlyOnceWith(sentinel)
  expect(sentinel.style.height).toBe('100px')

  view.rerender(tree())
  expect(disconnect).toHaveBeenCalledOnce()
  expect(Observer).toHaveBeenCalledOnce()
})
