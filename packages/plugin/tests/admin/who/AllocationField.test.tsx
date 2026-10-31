// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { AllocationField } from '../../../src/admin/AllocationField.js'
import { resetPayloadUiMock, setField, setFormFields } from '../_helpers/payloadUiMock.js'

vi.mock('@payloadcms/ui', async () => {
  const ui = (await import('../_helpers/payloadUiMock.js')).payloadUiMock()
  return { ...ui, FieldError: ({ path }: { path: string }) => {
    const field = ui.useFormFields(([fields]) => fields[path])
    return field?.valid === false ? <p role="alert">{String(field.errorMessage)}</p> : null
  } }
})
afterEach(() => { cleanup(); resetPayloadUiMock() })
const field = { name: 'allocation', type: 'number' as const, required: true }
const rows = { 'arms.0.key': { value: 'control' }, 'arms.0.kind': { value: 'control' }, 'arms.0.weight': { value: 50 },
  'arms.1.key': { value: 'variantA' }, 'arms.1.kind': { value: 'variant' }, 'arms.1.weight': { value: 50 } }
test('renders participation from flattened live form state and binds numeric input', () => {
  const setValue = vi.fn()
  setField({ value: 50, setValue })
  setFormFields({ ...rows, status: { value: 'draft' }, unitType: { value: 'visitor' }, layer: { value: 'id' } })
  render(<AllocationField path="allocation" field={field} />)
  expect(screen.getByText('50% of visitors take part: about 25% see each version; the rest see the Original and are not counted')).toBeTruthy()
  const input = screen.getByLabelText('Who takes part (%)') as HTMLInputElement
  expect([input.min, input.max, input.step]).toEqual(['1', '100', '1'])
  fireEvent.change(input, { target: { value: '30' } })
  expect(setValue).toHaveBeenCalledWith(30)
  act(() => {
    setField({ value: 30, setValue })
    setFormFields({ ...rows, status: { value: 'stopped' }, unitType: { value: 'user' }, layer: { value: { name: 'Home', used: 30, free: 60 } } })
  })
  expect(screen.getByText('30% of signed-in users take part: about 15% see each version; the rest see the Original and are not counted. Uses 30 of the 100 slices in layer Home; 60 are free.')).toBeTruthy()
})
test.each(['running', 'decided', 'archived'])('%s is read-only', status => {
  const setValue = vi.fn()
  setField({ value: 50, setValue })
  setFormFields({ ...rows, status: { value: status } })
  render(<AllocationField path="allocation" field={field} />)
  const input = screen.getByRole('spinbutton') as HTMLInputElement
  expect(input.readOnly).toBe(true)
  fireEvent.change(input, { target: { value: '60' } })
  expect(setValue).not.toHaveBeenCalled()
  if (status === 'running') expect(screen.getByText('50% of visitors take part: about 25% see each version; the rest see the Original and are not counted. Raise it from the actions panel; lowering takes effect in the next round.')).toBeTruthy()
})
test('shows the allocation validation error from field state', () => {
  setField({ value: 0, setValue: vi.fn() })
  setFormFields({ allocation: { value: 0, valid: false, errorMessage: 'Enter a whole percentage from 1 to 100.' } })
  render(<AllocationField path="allocation" field={field} />)
  expect(screen.getByRole('alert').textContent).toBe('Enter a whole percentage from 1 to 100.')
})
