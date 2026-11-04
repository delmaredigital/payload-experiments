// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { Textarea, Checkbox, CheckboxList, Range } from '../../src/ui/Inputs.js'

afterEach(cleanup)
test.each([Textarea, Checkbox, Range])('%s wires label, help, error and external description', Component => {
  render(<Component id="field" label="People" help="Helpful sentence." error="Check this value." aria-describedby="external" />)
  const field = screen.getByLabelText('People')
  expect(field.getAttribute('aria-invalid')).toBe('true')
  expect(field.getAttribute('aria-describedby')).toBe('external field-help field-error')
  expect(screen.getByRole('alert').id).toBe('field-error')
})
test('textarea supports typing and native read-only and disabled states', () => {
  const change = vi.fn()
  const { rerender } = render(<Textarea id="why" label="Why" onChange={change} />)
  fireEvent.change(screen.getByLabelText('Why'), { target: { value: 'A shorter ask' } })
  expect(change).toHaveBeenCalledOnce()
  rerender(<Textarea id="why" label="Why" value="Saved" readOnly />)
  expect(screen.getByRole<HTMLTextAreaElement>('textbox').readOnly).toBe(true)
  rerender(<Textarea id="why" label="Why" disabled />)
  expect(screen.getByRole<HTMLTextAreaElement>('textbox').disabled).toBe(true)
})
test('checkbox list labels each option, toggles a controlled selection and respects disabled options', () => {
  function Example() {
    const [value, setValue] = useState(['one'])
    return <CheckboxList id="goals" label="Goals" aria-describedby="external" help="Pick goals." error="Check goals." value={value} onChange={setValue}
      options={[{ value: 'one', label: 'First' }, { value: 'two', label: 'Second' }, { value: 'three', label: 'Unavailable', disabled: true }]} />
  }
  render(<Example />)
  const group = screen.getByRole('group', { name: 'Goals' })
  expect(group.getAttribute('aria-describedby')).toBe('external goals-help goals-error')
  expect(group.getAttribute('aria-invalid')).toBe('true')
  const [first, second, disabled] = within(group).getAllByRole<HTMLInputElement>('checkbox')
  for (const checkbox of [first!, second!, disabled!]) {
    expect(checkbox.hasAttribute('aria-describedby')).toBe(false)
    expect(checkbox.hasAttribute('aria-invalid')).toBe(false)
  }
  expect(first!.checked).toBe(true)
  fireEvent.click(first!); expect(first!.checked).toBe(false)
  fireEvent.click(second!); expect(second!.checked).toBe(true)
  expect(disabled!.disabled).toBe(true)
})
test('range preserves native bounds, step and controlled values', () => {
  function Example() { const [value, set] = useState(20); return <Range id="share" label="Share" min={10} max={100} step={10} value={value} onChange={e => set(Number(e.target.value))} /> }
  const { rerender } = render(<Example />)
  const slider = screen.getByRole<HTMLInputElement>('slider', { name: 'Share' })
  expect([slider.min, slider.max, slider.step, slider.value]).toEqual(['10', '100', '10', '20'])
  fireEvent.change(slider, { target: { value: '40' } }); expect(slider.value).toBe('40')
  rerender(<Range id="share" label="Share" disabled />)
  expect(screen.getByRole<HTMLInputElement>('slider').disabled).toBe(true)
})
