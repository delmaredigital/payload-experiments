// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { TargetingAttributeField } from '../../../src/admin/targeting/TargetingAttributeField.js'
import { TargetingOpField } from '../../../src/admin/targeting/TargetingOpField.js'
import { TargetingValueField } from '../../../src/admin/targeting/TargetingValueField.js'
import { payloadUiMock, resetPayloadUiMock, setField, setFormFields } from '../_helpers/payloadUiMock.js'

vi.mock('@payloadcms/ui', async () => (await import('../_helpers/payloadUiMock.js')).payloadUiMock())
afterEach(() => { cleanup(); resetPayloadUiMock() })
const custom = { attributeKeys: { utmSource: { type: 'string' }, age: { type: 'number' }, loggedIn: { type: 'boolean' }, device: { type: 'string', values: ['mobile', 'desktop'] } } }
const textField = { name: 'attribute', type: 'text' as const, admin: { custom } }
const valueField = { name: 'value', type: 'json' as const, admin: { custom, editorOptions: undefined, maxHeight: undefined } }
function form(attribute = 'utmSource', op = 'eq', status = 'draft') {
  setFormFields({ status: { value: status }, 'targeting.1.attribute': { value: attribute }, 'targeting.1.op': { value: op },
    'targeting.0.attribute': { value: 'loggedIn' } })
}
test('attribute labels are humanised while their registered codes are stored', () => {
  const setValue = vi.fn()
  setField({ value: 'utmSource', setValue })
  render(<TargetingAttributeField path="targeting.1.attribute" field={textField} />)
  expect(screen.getByText('Utm Source')).toBeTruthy()
  fireEvent.change(screen.getByLabelText('Attribute'), { target: { value: 'loggedIn' } })
  expect(setValue).toHaveBeenCalledWith('loggedIn')
})
test('operator uses its own row and resets to the first valid code when the type changes', () => {
  const setValue = vi.fn()
  setField({ value: 'neq', setValue })
  form()
  render(<TargetingOpField path="targeting.1.op" field={{ ...textField, name: 'op' }} />)
  expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['', 'is', 'is not', 'is one of', 'is not one of', 'contains'])
  expect(setValue).not.toHaveBeenCalled()
  act(() => form('age'))
  expect(setValue).toHaveBeenCalledWith('eq')
  expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['', '=', '≠', '>', '≥', '<', '≤'])
})
test.each([
  ['age', 'gte', '12.5', 12.5], ['loggedIn', 'eq', 'false', false], ['utmSource', 'contains', 'Email', 'Email'],
  ['utmSource', 'in', ' Email, Search ', ['Email', 'Search']], ['device', 'eq', 'desktop', 'desktop'],
])('writes coerced JSON for %s/%s', (attribute, op, raw, expected) => {
  const setValue = vi.fn()
  setField({ value: undefined, setValue })
  form(attribute, op)
  render(<TargetingValueField path="targeting.1.value" field={valueField} />)
  fireEvent.change(screen.getByLabelText('Value'), { target: { value: raw } })
  expect(setValue).toHaveBeenLastCalledWith(expected)
  expect(Boolean(screen.queryByText("Letter case doesn't matter."))).toBe(['utmSource', 'device'].includes(attribute))
})
test('registered lists support multiselect and save string arrays', () => {
  const setValue = vi.fn()
  setField({ value: [], setValue })
  form('device', 'nin')
  render(<TargetingValueField path="targeting.1.value" field={valueField} />)
  const input = screen.getByLabelText('Value') as HTMLSelectElement
  expect(input.multiple).toBe(true)
  for (const option of input.options) option.selected = true
  fireEvent.change(input)
  expect(setValue).toHaveBeenCalledWith(['mobile', 'desktop'])
})
test('changing comparison and attribute type normalizes the saved JSON without another edit', () => {
  const setValue = vi.fn()
  setField({ value: 'Email', setValue }, 'targeting.1.value')
  form('utmSource', 'eq')
  render(<TargetingValueField path="targeting.1.value" field={valueField} />)
  expect(setValue).not.toHaveBeenCalled()
  act(() => form('utmSource', 'in'))
  expect(setValue).toHaveBeenLastCalledWith(['Email'])
  act(() => {
    setField({ value: '12', setValue }, 'targeting.1.value')
    form('age', 'eq')
  })
  expect(setValue).toHaveBeenLastCalledWith(12)
})
test('changing to a list comparison while locked preserves the stored JSON', () => {
  const setValue = vi.fn()
  setField({ value: 'Email', setValue }, 'targeting.1.value')
  form('utmSource', 'eq', 'running')
  render(<TargetingValueField path="targeting.1.value" field={valueField} />)
  act(() => form('utmSource', 'in', 'running'))
  expect(setValue).not.toHaveBeenCalled()
})
test('free-text lists preserve unfinished commas while saving JSON and accept external values', () => {
  const setValue = vi.fn()
  setField({ value: ['Email'], setValue })
  form('utmSource', 'in')
  render(<TargetingValueField path="targeting.1.value" field={valueField} />)
  const input = screen.getByLabelText('Value') as HTMLInputElement
  fireEvent.change(input, { target: { value: 'Email,' } })
  act(() => setField({ value: ['Email'], setValue }))
  expect(input.value).toBe('Email,')
  fireEvent.change(input, { target: { value: 'Email, Search' } })
  expect(setValue).toHaveBeenLastCalledWith(['Email', 'Search'])
  act(() => setField({ value: ['Other'], setValue }))
  expect(input.value).toBe('Other')
})
test.each(['running', 'decided', 'archived'])('all targeting controls are locked in %s and never reset saved codes', status => {
  const setValue = vi.fn()
  setField({ value: 'contains', setValue })
  form('age', 'eq', status)
  render(<>
    <TargetingAttributeField path="targeting.1.attribute" field={textField} />
    <TargetingOpField path="targeting.1.op" field={{ ...textField, name: 'op' }} />
    <TargetingValueField path="targeting.1.value" field={valueField} />
  </>)
  for (const input of screen.getAllByRole('combobox') as HTMLSelectElement[]) expect(input.disabled).toBe(true)
  const input = screen.getByRole('spinbutton') as HTMLInputElement
  expect(input.readOnly).toBe(true)
  fireEvent.change(input, { target: { value: '20' } })
  expect(setValue).not.toHaveBeenCalled()
})
