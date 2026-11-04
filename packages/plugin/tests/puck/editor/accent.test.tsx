// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { createExperimentSlotEditor } from '../../../src/puck/editor/ExperimentSlotEditor.js'
import { resolveOptions } from '../../../src/options.js'
import { sampleOptions } from '../../collections/fixtures.js'
import { accentVariables, deriveAccent } from '../../../src/ui/accent.js'

vi.mock('@puckeditor/core', () => ({
  createUsePuck: () => (selector: (state: unknown) => unknown) => selector({ selectedItem: null, getItemById: () => undefined, appState: { data: { root: {} } } }),
  useGetPuck: () => () => ({}), registerOverlayPortal: vi.fn(),
}))
afterEach(() => { cleanup(); document.documentElement.removeAttribute('data-theme'); vi.restoreAllMocks() })

test.each(['red', '#12', 'var(--brand)', '#123456; color:red', null, 123])('factory and plugin reject %s with the same message', accent => {
  const plugin = () => resolveOptions({ ...sampleOptions(), theme: { accent: accent as string } })
  let message = ''
  try { plugin() } catch (error) { message = (error as Error).message }
  expect(message).toBe('Experiments theme.accent must be a CSS hex colour (#rgb or #rrggbb)')
  expect(() => createExperimentSlotEditor({ accent: accent as string })).toThrow(message)
})

test('valid host accent sets every derived inline variable and follows the iframe theme', async () => {
  const Editor = createExperimentSlotEditor({ accent: '#1f3a68' }).render
  const Slot = () => null
  const view = render(<Editor id="one" experiment={null} control={Slot} variantA={Slot} variantB={Slot} variantC={Slot}
    puck={{ renderDropZone: () => null, metadata: {}, isEditing: true, dragRef: null }} />)
  const root = view.container.querySelector<HTMLElement>('.xp-slot-root')!
  const sets = deriveAccent('#1f3a68')
  for (const [name, value] of Object.entries(accentVariables(sets.light))) expect(root.style.getPropertyValue(name)).toBe(value)
  document.documentElement.setAttribute('data-theme', 'dark')
  await waitFor(() => expect(root.style.getPropertyValue('--xp-accent')).toBe(sets.dark.accent))
  for (const [name, value] of Object.entries(accentVariables(sets.dark))) expect(root.style.getPropertyValue(name)).toBe(value)
  document.documentElement.removeAttribute('data-theme')
  await waitFor(() => expect(root.style.getPropertyValue('--xp-accent')).toBe(sets.light.accent))
})
