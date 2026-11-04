import { expect, test, vi } from 'vitest'
import { replaceBlockRow } from '../../../src/admin/blocks/formApi.js'
import { original } from './fixtures.js'
function setup(rows = [original]) {
  let data = { layout: rows }
  const form = { getData: () => data, getDataByPath: () => data.layout, getFields: () => ({ layout: { rows: rows.map(row => ({ id: row.id })) } }),
    replaceFieldRow: vi.fn(), addFieldRow: vi.fn(), removeFieldRow: vi.fn(), dispatchFields: vi.fn() }
  const args = { form: form as any, getFormState: vi.fn(async () => ({ state: {
    layout: { rows: [{ id: original.id, blockType: original.blockType }], value: 1 },
    'layout.0.id': { value: original.id }, 'layout.0.custom': { customComponents: { Field: 'from server' } },
    'layout.1.id': { value: 'second' }, 'layout.1.text': { value: 'second row' },
  } })) as any, collectionSlug: 'pages', id: '1', field: 'layout', index: 0, rows: [original], expectedBlock: original }
  return { args, form, edit: (rows: typeof data.layout) => { data = { layout: rows } } }
}
test('requests rendered server state, strips row prefix, retains metadata identity and adds N>=2 rows', async () => {
  const { args, form } = setup()
  args.rows = [original, { ...original, id: 'second' }]
  await replaceBlockRow(args)
  expect(args.getFormState).toHaveBeenCalledWith(expect.objectContaining({ collectionSlug: 'pages', schemaPath: 'pages', renderAllFields: true, skipValidation: true,
    data: { layout: args.rows } }))
  expect(form.replaceFieldRow).toHaveBeenCalledWith(expect.objectContaining({ subFieldState: { id: { value: original.id }, custom: { customComponents: { Field: 'from server' } } } }))
  expect(form.addFieldRow).toHaveBeenCalledWith(expect.objectContaining({ rowIndex: 1, subFieldState: { id: { value: 'second' }, text: { value: 'second row' } } }))
  expect(form.dispatchFields).toHaveBeenCalledWith({ type: 'UPDATE', path: 'layout', rows: [{ id: original.id, blockType: original.blockType }] })
})
test('N=0 removes row and normalizes only an empty whole field to []', async () => {
  const { args, form } = setup(); args.rows = []
  await replaceBlockRow(args)
  expect(form.removeFieldRow).toHaveBeenCalledWith({ path: 'layout', rowIndex: 0 })
  expect(form.dispatchFields).toHaveBeenCalledWith({ type: 'UPDATE', path: 'layout', value: [], disableFormData: false })
  const populated = setup([original, { ...original, id: 'sibling' }]); populated.args.rows = []
  await replaceBlockRow(populated.args)
  expect(populated.form.dispatchFields).not.toHaveBeenCalled()
})
test('rejects source edits while creating the draft or loading preferences, before any state request', async () => {
  const { args, edit, form } = setup(); edit([{ ...original, items: [] }])
  await expect(replaceBlockRow(args)).rejects.toThrow()
  expect(args.getFormState).not.toHaveBeenCalled(); expect(form.replaceFieldRow).not.toHaveBeenCalled()
})
test('rejects any blocks-field edit while getFormState is pending and performs no mutation', async () => {
  const { args, edit, form } = setup()
  args.getFormState.mockImplementation(async () => { edit([original, { ...original, id: 'added' }]); return { state: {} } })
  await expect(replaceBlockRow(args)).rejects.toThrow()
  expect(form.replaceFieldRow).not.toHaveBeenCalled(); expect(form.dispatchFields).not.toHaveBeenCalled()
})
test('missing server state is a failure with no mutation', async () => {
  const { args, form } = setup(); args.getFormState.mockResolvedValue({ state: null })
  await expect(replaceBlockRow(args)).rejects.toThrow(); expect(form.replaceFieldRow).not.toHaveBeenCalled()
})
