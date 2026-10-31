// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { TextFieldClientProps } from 'payload'
import type { SerializedFlagPoint } from '../../../src/types/admin.js'
import type { Status } from '../../../src/types/contracts.js'
import { payloadUiMock, resetPayloadUiMock, setField, setForm, setFormFields } from '../_helpers/payloadUiMock.js'
import { FlagPointSelect } from '../../../src/admin/FlagPointSelect.js'
import { LOCKED_MESSAGES } from '../../../src/admin/copy/common.js'

vi.mock('@payloadcms/ui', () => payloadUiMock())
afterEach(() => { cleanup(); resetPayloadUiMock() })
const points: SerializedFlagPoint[] = [
  { id: 'hero', label: 'Hero heading', params: {}, defaultParams: { title: 'old' }, effectiveDefaults: { title: 'Current title' } },
  { id: 'footer', label: 'Footer', params: {}, defaultParams: {}, effectiveDefaults: { title: 'Footer title' } },
]
function setup(status: Status = 'draft') {
  const setValue = vi.fn(), dispatchFields = vi.fn(), setModified = vi.fn()
  setField({ value: 'hero', setValue }, 'flagPoint')
  setForm({ dispatchFields, setModified })
  setFormFields({ status: { value: status }, 'arms.0.key': { value: 'control' }, 'arms.0.kind': { value: 'control' } })
  render(<FlagPointSelect {...{ path: 'flagPoint', field: { name: 'flagPoint', type: 'text', admin: { custom: { flagPoints: points } } } } as unknown as TextFieldClientProps} />)
  return { setValue, dispatchFields, setModified }
}
test('uses serialised point labels and prefills control with effective defaults on selection', () => {
  const form = setup()
  expect(screen.getByRole('option', { name: 'Hero heading' }).getAttribute('value')).toBe('hero')
  expect(screen.getByRole('option', { name: 'Footer' }).getAttribute('value')).toBe('footer')
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'footer' } })
  expect(form.setValue).toHaveBeenCalledWith('footer')
  expect(form.dispatchFields).toHaveBeenCalledWith({ type: 'UPDATE', path: 'arms.0.params', value: { title: 'Footer title' } })
  expect(form.setModified).toHaveBeenCalledWith(true)
})
test.each(['stopped', 'running', 'decided', 'archived'] as const)('disabled after draft: %s', status => {
  const form = setup(status)
  expect((screen.getByRole('combobox') as HTMLSelectElement).disabled).toBe(true)
  expect(screen.getByText(status === 'stopped' ? LOCKED_MESSAGES.other : LOCKED_MESSAGES[status])).toBeTruthy()
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'footer' } })
  expect(form.setValue).not.toHaveBeenCalled()
  expect(form.dispatchFields).not.toHaveBeenCalled()
})
test('clearing the point clears its read-only defaults', () => {
  const form = setup()
  fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } })
  expect(form.setValue).toHaveBeenCalledWith('')
  expect(form.dispatchFields).toHaveBeenCalledWith({ type: 'UPDATE', path: 'arms.0.params', value: {} })
})
