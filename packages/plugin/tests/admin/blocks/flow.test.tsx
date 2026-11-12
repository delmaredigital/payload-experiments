// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { payloadUiMock, resetPayloadUiMock, setDocumentInfo, setFormModified, setPayloadUiState, setEntityConfig } from '../_helpers/payloadUiMock.js'
import { collection, configure, original } from './fixtures.js'
import { TestBlockField } from '../../../src/admin/blocks/TestBlockField.js'
import { API_MESSAGES } from '../../../src/testSurface/copy/common.js'
import { wrapExperimentBlock } from '../../../src/blocks/formState.js'
import { field } from './fixtures.js'
import { BLOCK_COPY } from '../../../src/admin/copy/blocks.js'
import { CreateRefused } from '../../../src/puck/editor/createTest.js'
const mocks = vi.hoisted(() => ({ mode: 'form-api', adapt: vi.fn(), replace: vi.fn(), create: vi.fn() }))
vi.mock('@payloadcms/ui', () => payloadUiMock())
vi.mock('../../../src/puck/editor/createTest.js', async importOriginal => ({ ...await importOriginal<typeof import('../../../src/puck/editor/createTest.js')>(), createTest: mocks.create }))
vi.mock('../../../src/admin/blocks/formApi.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../src/admin/blocks/formApi.js')>()
  mocks.adapt.mockImplementation(actual.adaptClientBlocksField)
  return { ...actual, adaptClientBlocksField: mocks.adapt, get wrapMode() { return mocks.mode }, replaceBlockRow: mocks.replace }
})
const props = { path: 'xpTestBlock', blocksField: 'layout' } as any
beforeEach(() => { resetPayloadUiMock(); mocks.adapt.mockClear(); mocks.mode = 'form-api'; mocks.replace.mockReset(); mocks.create.mockReset().mockResolvedValue({ id: 4, slug: 'server-suffix-2' }) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
async function pickAndCreate() {
  fireEvent.change(screen.getByRole('combobox'), { target: { value: '0' } })
  fireEvent.click(screen.getByRole('button', { name: BLOCK_COPY.testBlock }))
  await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce())
}
test('manage gate returns null and makes no request', () => {
  configure({ layout: [original] }); setPayloadUiState({ auth: { permissions: { collections: {} } } })
  expect(render(<TestBlockField {...props} />).container.textContent).toBe('')
  expect(mocks.create).not.toHaveBeenCalled()
})
test('empty picker uses authored copy', () => {
  configure({ layout: [] }); render(<TestBlockField {...props} />)
  expect(screen.getByText(BLOCK_COPY.empty)).toBeTruthy()
})
test('create then wrap uses returned slug and only enables setup from saved doc data and unmodified form', async () => {
  const data = { title: 'About us', layout: [original] }
  configure(data)
  mocks.replace.mockImplementation(async ({ rows }) => { data.layout = rows; setFormModified(true) })
  render(<TestBlockField {...props} />)
  await pickAndCreate()
  await waitFor(() => expect(mocks.replace).toHaveBeenCalledOnce())
  expect(mocks.create).toHaveBeenCalledWith('/api', { kind: 'block', name: 'About us: Hero', unitType: 'visitor' })
  expect(mocks.create.mock.invocationCallOrder[0]).toBeLessThan(mocks.replace.mock.invocationCallOrder[0]!)
  expect(mocks.replace.mock.calls[0]![0].rows[0].experiment).toBe('server-suffix-2')
  expect(screen.getByText('Save a draft of this page to add the test.')).toBeTruthy()
  let setup = screen.getByText(BLOCK_COPY.setup)
  expect(setup.getAttribute('href')).toBeNull()
  act(() => setFormModified(false))
  expect(setup.getAttribute('href')).toBeNull()
  act(() => setDocumentInfo({ id: '1', collectionSlug: 'pages', data: { layout: data.layout } }))
  setup = screen.getByText(BLOCK_COPY.setup)
  expect(setup.getAttribute('href')).toBe('/cms/experiments/by-slug/server-suffix-2')
  expect(setup.getAttribute('href')).not.toContain('collections/xp-')
  cleanup()
  render(<TestBlockField {...props} />)
  expect(screen.getByText(BLOCK_COPY.setup).getAttribute('href')).toBe('/cms/experiments/by-slug/server-suffix-2')
})
test('blank title uses collection singular and no-drafts notice uses Save', async () => {
  const data = { title: '', layout: [original] }
  configure(data); setEntityConfig({ ...collection, versions: false })
  mocks.replace.mockImplementation(async ({ rows }) => { data.layout = rows; setFormModified(true) })
  render(<TestBlockField {...props} />); await pickAndCreate()
  expect(mocks.create.mock.calls[0]![1].name).toBe('Page: Hero')
  expect(await screen.findByText('Save this page to add the test.')).toBeTruthy()
})
test('fallback checks modified before creating any draft', async () => {
  mocks.mode = 'fallback'; configure({ layout: [original] }); setFormModified(true)
  render(<TestBlockField {...props} />)
  fireEvent.change(screen.getByRole('combobox'), { target: { value: '0' } })
  fireEvent.click(screen.getByRole('button', { name: BLOCK_COPY.testBlock }))
  expect(await screen.findByText(BLOCK_COPY.saveFirst)).toBeTruthy()
  expect(mocks.create).not.toHaveBeenCalled()
})
test.each(Object.entries(BLOCK_COPY.wrapRefusals))('fallback wraps returned slug; %s refusal leaves draft with no rollback', async (code, sentence) => {
  mocks.mode = 'fallback'; configure({ title: 'About us', layout: [original] })
  const fetch = vi.fn().mockResolvedValue({ ok: false, status: 422, json: async () => ({ errors: [{ code, message: sentence }] }) }); vi.stubGlobal('fetch', fetch)
  render(<TestBlockField {...props} />); await pickAndCreate()
  expect(await screen.findByText(sentence)).toBeTruthy()
  expect(fetch).toHaveBeenCalledOnce()
  expect(JSON.parse(fetch.mock.calls[0]![1].body)).toEqual({ collection: 'pages', id: '1', field: 'layout', blockId: 'hero-id', experiment: 'server-suffix-2' })
  expect(mocks.replace).not.toHaveBeenCalled()
  expect(mocks.create).toHaveBeenCalledOnce()
})
test('form-api wrap failure retains the created draft and shows generic failure', async () => {
  configure({ layout: [original] }); mocks.replace.mockRejectedValue(new Error('Wrap refused.'))
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
  render(<TestBlockField {...props} />); await pickAndCreate()
  expect(await screen.findByText(API_MESSAGES.failed)).toBeTruthy()
  expect(mocks.create).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled()
})
test('CreateRefused message is preserved', async () => {
  configure({ layout: [original] }); mocks.create.mockRejectedValue(new CreateRefused('Choose another name.'))
  render(<TestBlockField {...props} />); await pickAndCreate()
  expect(await screen.findByText('Choose another name.')).toBeTruthy(); expect(mocks.replace).not.toHaveBeenCalled()
})
test('real createTest posts full block body before form wrap and uses server suffix', async () => {
  configure({ title: 'About us', layout: [original] })
  const actual = await vi.importActual<typeof import('../../../src/puck/editor/createTest.js')>('../../../src/puck/editor/createTest.js')
  mocks.create.mockImplementation(actual.createTest)
  const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ docs: [] }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ doc: { id: '4', slug: 'server-suffix-2' } }) })
  vi.stubGlobal('fetch', fetch)
  render(<TestBlockField {...props} />); await pickAndCreate()
  await waitFor(() => expect(mocks.replace).toHaveBeenCalledOnce())
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(JSON.parse(fetch.mock.calls[1]![1].body)).toEqual({
    name: 'About us: Hero', slug: 'about-us-hero', kind: 'block', unitType: 'visitor', exposurePolicy: 'render', allocation: 100,
    arms: [{ key: 'control', label: 'Original', kind: 'control', weight: 50, slot: 'control' }, { key: 'variantA', label: 'Variant A', kind: 'variant', weight: 50, slot: 'variantA' }], analysis: { plannedDurationDays: 28 },
  })
  expect(mocks.replace.mock.calls[0]![0].rows[0].experiment).toBe('server-suffix-2')
})

test.each(['draft creation', 'server form state'])('stale edit during %s shows block copy and preserves current form data', async stage => {
  const data = { title: 'About us', layout: [original] }
  const form = configure(data)
  const actual = await vi.importActual<typeof import('../../../src/admin/blocks/formApi.js')>('../../../src/admin/blocks/formApi.js')
  mocks.replace.mockImplementation(actual.replaceBlockRow)
  const edited = { ...original, items: [{ id: 'editor-row', text: 'keep this edit' }] }
  const getFormState = vi.fn(async () => { data.layout = [edited]; return { state: {} } })
  setPayloadUiState({ serverFunctions: { getFormState } })
  if (stage === 'draft creation') mocks.create.mockImplementation(async () => { data.layout = [edited]; return { id: 4, slug: 'created-test' } })
  render(<TestBlockField {...props} />); await pickAndCreate()
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', BLOCK_COPY.blockChanged)
  expect(form.getData()).toEqual({ title: 'About us', layout: [edited] })
  for (const method of [form.replaceFieldRow, form.addFieldRow, form.removeFieldRow, form.dispatchFields]) expect(method).not.toHaveBeenCalled()
  expect(getFormState).toHaveBeenCalledTimes(stage === 'draft creation' ? 0 : 1)
})
test.each(['create', 'form', 'fallback'])('%s transport errors never display raw text', async stage => {
  configure({ layout: [original] })
  const transport = new Error('private transport details')
  if (stage === 'create') mocks.create.mockRejectedValue(transport)
  else if (stage === 'form') {
    const actual = await vi.importActual<typeof import('../../../src/admin/blocks/formApi.js')>('../../../src/admin/blocks/formApi.js')
    mocks.replace.mockImplementation(actual.replaceBlockRow)
    setPayloadUiState({ serverFunctions: { getFormState: vi.fn().mockRejectedValue(transport) } })
  } else { mocks.mode = 'fallback'; vi.stubGlobal('fetch', vi.fn().mockRejectedValue(transport)) }
  render(<TestBlockField {...props} />); await pickAndCreate()
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', API_MESSAGES.failed)
  expect(screen.queryByText(transport.message)).toBeNull()
})
test('unknown wrap refusal text is not displayed', async () => {
  mocks.mode = 'fallback'; configure({ layout: [original] })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 422, json: async () => ({ errors: [{ code: 'unknown', message: 'private server details' }] }) }))
  render(<TestBlockField {...props} />); await pickAndCreate()
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', API_MESSAGES.failed)
})
test.each([true, false])('save prompt depends on saved slug with unrelated unsaved edits (saved=%s)', saved => {
  const wrapped = wrapExperimentBlock(original, 'existing-test', field)
  configure({ layout: [wrapped], title: 'An unsaved title' }); setFormModified(true)
  setDocumentInfo({ id: '1', collectionSlug: 'pages', data: { layout: saved ? [wrapped] : [] } })
  render(<TestBlockField {...props} />)
  expect(Boolean(screen.queryByText('Save a draft of this page to add the test.'))).toBe(!saved)
  expect(screen.getByText(BLOCK_COPY.setup).getAttribute('aria-disabled')).toBe('true')
})
test('two clicks in the same tick create and wrap exactly one test', async () => {
  configure({ layout: [original] })
  render(<TestBlockField {...props} />)
  fireEvent.change(screen.getByRole('combobox'), { target: { value: '0' } })
  const button = screen.getByRole('button', { name: BLOCK_COPY.testBlock })
  act(() => { button.click(); button.click() })
  await waitFor(() => expect(mocks.replace).toHaveBeenCalledOnce())
  expect(mocks.create).toHaveBeenCalledOnce()
})

test('typing in another field does not re-adapt the picker config', () => {
  configure({ layout: [original] }); render(<TestBlockField {...props} />)
  expect(mocks.adapt).toHaveBeenCalledOnce()
  act(() => setPayloadUiState({ formFields: { title: { value: 'New title' } } }))
  expect(mocks.adapt).toHaveBeenCalledOnce()
})
