// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { ArrayFieldClientProps } from 'payload'
import type { Arm, Status } from '../../../src/types/contracts.js'
import type { SerializedFlagPoint } from '../../../src/types/admin.js'
import { payloadUiMock, resetPayloadUiMock, setForm, setFormFields } from '../_helpers/payloadUiMock.js'
import { ArmsField } from '../../../src/admin/arms/ArmsField.js'
import { ARMS_COPY, ISSUE_COPY } from '../../../src/admin/copy/arms.js'
import { LOCKED_MESSAGES } from '../../../src/admin/copy/common.js'

vi.mock('@payloadcms/ui', () => payloadUiMock())
afterEach(() => { cleanup(); resetPayloadUiMock() })
const groups: Arm[] = [
  { key: 'control', label: 'Original', kind: 'control', weight: 50, slot: 'control' },
  { key: 'variantA', label: 'Variant A', kind: 'variant', weight: 50, slot: 'variantA' },
]
const point: SerializedFlagPoint = {
  id: 'hero', label: 'Hero', defaultParams: {}, effectiveDefaults: { title: 'Current title' },
  params: { title: { type: 'text', label: 'Title', required: true }, body: { type: 'textarea', label: 'Body' },
    size: { type: 'number', label: 'Size', min: 1, max: 5 }, enabled: { type: 'checkbox', label: 'Enabled' },
    colour: { type: 'select', label: 'Colour', options: [{ label: 'Red', value: 'red' }] } },
}
function setup(rows = groups, status: Status = 'draft', kind = 'block') {
  const form = { addFieldRow: vi.fn(), removeFieldRow: vi.fn(), dispatchFields: vi.fn(), setModified: vi.fn() }
  setForm(form)
  setFormFields({ kind: { value: kind }, status: { value: status }, flagPoint: { value: 'hero' }, arms: { value: rows.length },
    ...Object.fromEntries(rows.flatMap((arm, i) => Object.entries(arm).map(([key, value]) => [`arms.${i}.${key}`, { value }]))) })
  render(<ArmsField {...{ path: 'arms', field: { name: 'arms', type: 'array', fields: [], admin: { custom: { flagPoints: [point] } } } } as unknown as ArrayFieldClientProps} />)
  return form
}
test('Add a holdout adds every subfield once and updates other weights to 45/45', () => {
  const form = setup()
  fireEvent.click(screen.getByRole('button', { name: 'Add a holdout' }))
  expect(form.addFieldRow).toHaveBeenCalledTimes(1)
  const call = form.addFieldRow.mock.calls[0]![0]
  expect(call).toMatchObject({ path: 'arms', rowIndex: 2, schemaPath: 'arms' })
  expect(Object.keys(call.subFieldState).sort()).toEqual(['key', 'label', 'weight', 'kind', 'slot', 'params', 'pageTarget', 'id'].sort())
  expect(call.subFieldState.key).toEqual({ value: 'holdout', initialValue: undefined, valid: true })
  expect(call.subFieldState.weight.value).toBe(10)
  expect(call.subFieldState.slot.value).toBeUndefined()
  for (const index of [0, 1]) expect(form.dispatchFields).toHaveBeenCalledWith({ type: 'UPDATE', path: `arms.${index}.weight`, value: 45 })
  expect(form.setModified).toHaveBeenCalledWith(true)
  expect(form.removeFieldRow).not.toHaveBeenCalled()
})
test.each(['running', 'decided', 'archived'] as const)('%s disables every input and explains why', status => {
  const form = setup(groups, status)
  expect(screen.getByText(LOCKED_MESSAGES[status])).toBeTruthy()
  for (const input of document.querySelectorAll('input, button')) expect(input.matches(':disabled')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Add a holdout' }))
  expect(form.addFieldRow).not.toHaveBeenCalled()
})
test('stopped can add or remove rows for the next round', () => {
  const form = setup(groups, 'stopped')
  fireEvent.click(screen.getByRole('button', { name: 'Remove variant' }))
  expect(form.removeFieldRow).toHaveBeenCalledWith({ path: 'arms', rowIndex: 1 })
})
test('checker issues appear on their row or form with user copy, never raw codes', () => {
  setup([groups[0]!, { ...groups[1]!, key: 'bad' as Arm['key'], weight: 40 }])
  const variant = screen.getByRole('heading', { name: 'Variant A' }).closest('section')!
  expect(within(variant).getByText(ISSUE_COPY['invalid-key'])).toBeTruthy()
  expect(screen.getByText('Weights must add up to 100%. They add up to 90% now.')).toBeTruthy()
  expect(document.body.textContent).not.toContain('invalid-key')
  expect(document.body.textContent).not.toContain('weights-total')
})
test('page paths update their field and holdout shows Original copy instead of an input', () => {
  const form = setup([...groups, { key: 'holdout', kind: 'holdout', label: 'Holdout', weight: 0 }], 'draft', 'page')
  const paths = screen.getAllByLabelText('Page path')
  expect(paths).toHaveLength(2)
  expect(screen.getByText(ARMS_COPY.holdoutPage)).toBeTruthy()
  fireEvent.change(paths[1]!, { target: { value: '/new-page' } })
  expect(form.dispatchFields).toHaveBeenCalledWith({ type: 'UPDATE', path: 'arms.1.pageTarget', value: '/new-page' })
})
test('flag params show read-only effective Original defaults and write typed variant values', () => {
  const form = setup(groups, 'draft', 'flag')
  const original = screen.getByRole('heading', { name: 'Original' }).closest('section')!
  const variant = screen.getByRole('heading', { name: 'Variant A' }).closest('section')!
  const title = within(original).getByLabelText('Title') as HTMLInputElement
  expect(title.value).toBe('Current title')
  expect(title.readOnly).toBe(true)
  fireEvent.change(title, { target: { value: 'ignored' } })
  expect(form.dispatchFields).not.toHaveBeenCalled()
  fireEvent.change(within(variant).getByLabelText('Title'), { target: { value: 'New title' } })
  expect(form.dispatchFields).toHaveBeenLastCalledWith({ type: 'UPDATE', path: 'arms.1.params', value: { title: 'New title' } })
  fireEvent.change(within(variant).getByLabelText('Body'), { target: { value: 'New body' } })
  expect(form.dispatchFields).toHaveBeenLastCalledWith({ type: 'UPDATE', path: 'arms.1.params', value: { body: 'New body' } })
  fireEvent.change(within(variant).getByLabelText('Size'), { target: { value: '2.5' } })
  expect(form.dispatchFields).toHaveBeenLastCalledWith({ type: 'UPDATE', path: 'arms.1.params', value: { size: 2.5 } })
  fireEvent.click(within(variant).getByLabelText('Enabled'))
  expect(form.dispatchFields).toHaveBeenLastCalledWith({ type: 'UPDATE', path: 'arms.1.params', value: { enabled: true } })
  fireEvent.change(within(variant).getByLabelText('Colour'), { target: { value: 'red' } })
  expect(form.dispatchFields).toHaveBeenLastCalledWith({ type: 'UPDATE', path: 'arms.1.params', value: { colour: 'red' } })
})
test('weight changes update only that group without rebalancing', () => {
  const form = setup()
  fireEvent.change(screen.getAllByLabelText('Weight (%)')[0]!, { target: { value: '60' } })
  expect(form.dispatchFields).toHaveBeenCalledTimes(1)
  expect(form.dispatchFields).toHaveBeenCalledWith({ type: 'UPDATE', path: 'arms.0.weight', value: 60 })
})

test('stopped removal before a holdout preserves its persisted ID and key', () => {
  const rows = [...groups.map((group, index) => ({ ...group, id: `persisted-${index}` })),
    { key: 'holdout' as const, kind: 'holdout' as const, label: 'Holdout', weight: 0, id: 'persisted-holdout' }]
  const form = setup(rows, 'stopped')
  fireEvent.click(screen.getByRole('button', { name: 'Remove variant' }))
  expect(form.dispatchFields).toHaveBeenCalledWith({ type: 'UPDATE', path: 'arms.1.id', value: 'persisted-holdout' })
  expect(form.dispatchFields).toHaveBeenCalledWith({ type: 'UPDATE', path: 'arms.1.key', value: 'holdout' })
  expect(form.dispatchFields).toHaveBeenCalledWith({ type: 'UPDATE', path: 'arms', rows: [
    { id: 'persisted-0', isLoading: true }, { id: 'persisted-holdout', isLoading: true },
  ] })
})
test('stopped insertion before a holdout moves its persisted ID and gives the new variant a new ID', () => {
  const rows = [...groups.map((group, index) => ({ ...group, id: `persisted-${index}` })),
    { key: 'holdout' as const, kind: 'holdout' as const, label: 'Holdout', weight: 0, id: 'persisted-holdout' }]
  const form = setup(rows, 'stopped')
  fireEvent.click(screen.getByRole('button', { name: 'Add a variant' }))
  expect(form.addFieldRow).toHaveBeenCalledTimes(1)
  expect(form.addFieldRow.mock.calls[0]![0].subFieldState.id.value).toBe('persisted-holdout')
  const update = form.dispatchFields.mock.calls.find(([action]) => action.path === 'arms.2.id')![0]
  expect(update.value).toEqual(expect.any(String))
  expect(update.value).not.toBe('persisted-holdout')
  expect(form.dispatchFields).toHaveBeenCalledWith({ type: 'UPDATE', path: 'arms.3.id', value: 'persisted-holdout' })
})
