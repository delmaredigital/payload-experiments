// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { ArrayFieldClientProps } from 'payload'
import type { Arm, Status } from '../../../src/types/contracts.js'
import type { SerializedFlagPoint } from '../../../src/types/admin.js'
import { payloadUiMock, resetPayloadUiMock, setField, setForm, setFormFields } from '../_helpers/payloadUiMock.js'
import { ArmsField } from '../../../src/admin/arms/ArmsField.js'
import { ARMS_COPY, ISSUE_COPY } from '../../../src/admin/copy/arms.js'
import { LOCKED_MESSAGES } from '../../../src/admin/copy/common.js'
import { defaultArms, withSlotsFor } from '../../../src/admin/arms/arms.model.js'

const local = vi.hoisted(() => ({ rows: [] as { id: string; collapsed: boolean }[], selections: [] as unknown[] }))
vi.mock('@payloadcms/ui', () => {
  const base = payloadUiMock()
  return { ...base, useFormFields: <T,>(selector: Parameters<typeof base.useFormFields<T>>[0]) =>
    base.useFormFields(([fields, dispatch]) => {
      const result = selector([{ ...fields, arms: { ...fields.arms, rows: local.rows } }, dispatch])
      local.selections.push(result)
      return result
    }),
  }
})
afterEach(() => { cleanup(); resetPayloadUiMock(); local.rows = []; local.selections = []; vi.unstubAllGlobals() })
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
function setup(rows = groups, status: Status = 'draft', kind: 'block' | 'page' | 'flag' | 'code' | undefined = 'block', live = false) {
  const form = { addFieldRow: vi.fn(), removeFieldRow: vi.fn(), dispatchFields: vi.fn(), setModified: vi.fn() }
  setForm(form)
  local.rows = rows.map((row, index) => ({ id: (row as Arm & { id?: string }).id ?? `row-${index}`, collapsed: false }))
  let fields: Record<string, { value?: unknown }> = { kind: { value: kind }, status: { value: status }, flagPoint: { value: 'hero' }, arms: { value: rows.length },
    ...Object.fromEntries(withSlotsFor(rows, kind).flatMap((arm, i) => [...Object.entries(arm), ['id', local.rows[i]!.id]].map(([key, value]) => [`arms.${i}.${key}`, { value }]))) }
  setFormFields(fields)
  if (live) {
    // The shared mock intentionally has no reducer. For seeding and kind-change
    // tests, reflect the public form actions back into its flat field state.
    form.addFieldRow.mockImplementation(({ rowIndex, subFieldState }) => {
      fields = { ...fields, ...Object.fromEntries(Object.entries(subFieldState).map(([key, state]) => [`arms.${rowIndex}.${key}`, state])) } as typeof fields
      setFormFields(fields)
    })
    form.dispatchFields.mockImplementation(({ path, value, rows }) => {
      if (!rows) fields = { ...fields, [path]: { value } }
      setFormFields(fields)
    })
  }
  render(<ArmsField {...{ path: 'arms', field: { name: 'arms', type: 'array', fields: [], admin: { custom: { flagPoints: [point] } } } } as unknown as ArrayFieldClientProps} />)
  return Object.assign(form, { changeKind: (value: string) => { fields = { ...fields, kind: { value } }; setFormFields(fields) },
    unrelatedChange: () => setFormFields({ ...fields, name: { value: 'An unrelated change' } }) })
}
test('Add a holdout adds every subfield once and updates other weights to 45/45', () => {
  const form = setup()
  fireEvent.click(screen.getByRole('button', { name: 'Add a holdout' }))
  expect(form.addFieldRow).toHaveBeenCalledTimes(1)
  const call = form.addFieldRow.mock.calls[0]![0]
  expect(call).toMatchObject({ path: 'arms', rowIndex: 2, schemaPath: 'arms' })
  expect(Object.keys(call.subFieldState).sort()).toEqual(['key', 'label', 'weight', 'kind', 'slot', 'pageTarget', 'id'].sort())
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
  const rows = [...groups.map((group, index) => ({ ...group, id: `persisted-${index}`, ...(index ? { params: { title: 'Variant only' } } : {}) })),
    { key: 'holdout' as const, kind: 'holdout' as const, label: 'Holdout', weight: 0, id: 'persisted-holdout' }]
  const form = setup(rows, 'stopped')
  fireEvent.click(screen.getByRole('button', { name: 'Remove variant' }))
  expect(form.dispatchFields).toHaveBeenCalledWith({ type: 'UPDATE', path: 'arms.1.id', value: 'persisted-holdout' })
  expect(form.dispatchFields).toHaveBeenCalledWith({ type: 'UPDATE', path: 'arms.1.key', value: 'holdout' })
  expect(form.dispatchFields).toHaveBeenCalledWith({ type: 'UPDATE', path: 'arms.1.params', value: undefined })
  expect(form.dispatchFields).toHaveBeenCalledWith({ type: 'UPDATE', path: 'arms', rows: [
    local.rows[0], local.rows[2],
  ] })
  const metadata = form.dispatchFields.mock.calls.find(([action]) => action.path === 'arms')![0].rows
  expect(metadata[0]).toBe(local.rows[0])
  expect(metadata[1]).toBe(local.rows[2])
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
  const metadata = form.dispatchFields.mock.calls.find(([action]) => action.path === 'arms')![0].rows
  expect(metadata[0]).toBe(local.rows[0])
  expect(metadata[1]).toBe(local.rows[1])
  expect(metadata[2]).toEqual({ id: update.value, isLoading: true })
  expect(metadata[3]).toBe(local.rows[2])
})

test('empty create form seeds Original and Variant A once and shows no issues', () => {
  const form = setup([], 'draft', 'block', true)
  expect(screen.getAllByRole('heading').map(heading => heading.textContent)).toEqual(['Original', 'Variant A'])
  expect(screen.queryAllByRole('alert')).toHaveLength(0)
  expect(screen.getAllByLabelText('Weight (%)').map(input => (input as HTMLInputElement).value)).toEqual(['50', '50'])
  expect(form.addFieldRow).toHaveBeenCalledTimes(2)
  act(() => form.unrelatedChange())
  expect(form.addFieldRow).toHaveBeenCalledTimes(2)
})
test('empty list hides form issues and disables adding groups until there is an Original', () => {
  setup([])
  expect(screen.queryAllByRole('alert')).toHaveLength(0)
  for (const name of ['Add a variant', 'Add a holdout']) expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true)
})
test('a kind switch normalises existing slots through the form API', () => {
  const form = setup(defaultArms('page'), 'draft', 'page', true)
  form.dispatchFields.mockClear()
  act(() => form.changeKind('block'))
  for (const [index, value] of ['control', 'variantA'].entries()) expect(form.dispatchFields).toHaveBeenCalledWith({ type: 'UPDATE', path: `arms.${index}.slot`, value })
  form.dispatchFields.mockClear()
  act(() => form.changeKind('flag'))
  for (const index of [0, 1]) expect(form.dispatchFields).toHaveBeenCalledWith({ type: 'UPDATE', path: `arms.${index}.slot`, value: undefined })
})
test('holdout has no params editor and no params are written for it', () => {
  const form = setup([...defaultArms('flag'), { key: 'holdout', kind: 'holdout', label: 'Holdout', weight: 0 }], 'draft', 'flag')
  const holdout = screen.getByRole('heading', { name: 'Holdout' }).closest('section')!
  expect(within(holdout).queryByLabelText('Title')).toBeNull()
  expect(within(holdout).queryAllByRole('alert')).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: 'Split evenly' }))
  expect(form.dispatchFields.mock.calls.some(([action]) => action.path === 'arms.2.params')).toBe(false)
})
test.each([true, false])('new row ids are 24 hex characters without randomUUID (getRandomValues: %s)', randomValues => {
  vi.stubGlobal('crypto', randomValues ? { getRandomValues: (bytes: Uint8Array) => bytes.fill(42) } : undefined)
  const form = setup()
  fireEvent.click(screen.getByRole('button', { name: 'Add a variant' }))
  expect(form.addFieldRow.mock.calls[0]![0].subFieldState.id.value).toMatch(/^[0-9a-f]{24}$/)
})
test('cleared weight totals show zero instead of NaN', () => {
  setup([{ ...groups[0]!, weight: NaN }, groups[1]!])
  expect(screen.getByText('Weights must add up to 100%. They add up to 50% now.')).toBeTruthy()
  expect(document.body.textContent).not.toContain('NaN')
})
test.each([
  ['duplicate-key', ISSUE_COPY['duplicate-key']],
  ['Please choose different labels.', 'Please choose different labels.'],
])('server error %s appears inline with known codes translated and server text as fallback', (message, expected) => {
  setField({ showError: true, errorMessage: message }, 'arms')
  setup()
  expect(screen.getByRole('alert').textContent).toBe(expected)
})
test('known checker server messages recover their code and use group vocabulary', () => {
  setField({ showError: true, errorMessage: 'Arm keys must be unique.' }, 'arms')
  setup([groups[0]!, { ...groups[1]!, key: 'control' }])
  expect(screen.getAllByText(ISSUE_COPY['duplicate-key'])).toHaveLength(2)
  expect(screen.queryByText('Arm keys must be unique.')).toBeNull()
})
test('arm selector retains the same result across unrelated form changes', () => {
  const form = setup()
  const before = [...local.selections].reverse().find(value => value && typeof value === 'object' && 'arms' in value)
  act(() => form.unrelatedChange())
  const after = [...local.selections].reverse().find(value => value && typeof value === 'object' && 'arms' in value)
  expect(before).toBeDefined()
  expect(after).toBe(before)
})
