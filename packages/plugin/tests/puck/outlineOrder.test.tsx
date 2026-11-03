// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.hoisted(() => {
  // Puck's drag library creates a ResizeObserver during module evaluation; jsdom has no layout.
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})

import { Puck } from '@puckeditor/core'
import { ExperimentSlotEditor } from '../../src/puck/editor/ExperimentSlotEditor.js'

beforeEach(() => {
  // Puck checks responsive breakpoints on mount; jsdom does not implement media queries.
  vi.stubGlobal('matchMedia', (media: string) => ({
    matches: false, media, addEventListener() {}, removeEventListener() {},
  }))
  // Puck persists sidebar widths; this Node/jsdom runtime does not expose localStorage.
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} })
})

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

test('the real Puck outline names versions and lists the Original first', async () => {
  render(<Puck
    config={{ components: { ExperimentSlot: ExperimentSlotEditor } }}
    data={{ root: { props: {} }, content: [{ type: 'ExperimentSlot', props: {
      id: 'experiment-slot', experiment: null, control: [], variantA: [], variantB: [], variantC: [],
    } }] }}
    ui={{ itemExpanded: { 'experiment-slot': true } }}
  >
    {/* Public compound API renders the real outline without unrelated editor panels or an iframe. */}
    <Puck.Outline />
  </Puck>)

  const item = (await screen.findByRole('button', { name: 'Experiment' })).closest('li')!
  // Puck renders zone titles as plain divs, so query their visible text within this outline item.
  expect(within(item).getAllByText(/^(Original|Variant [ABC])$/).map(title => title.textContent)).toEqual([
    'Original', 'Variant A', 'Variant B', 'Variant C',
  ])
})
