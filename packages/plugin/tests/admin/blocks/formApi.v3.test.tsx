// @vitest-environment jsdom
import React from 'react'
import { act, render, cleanup } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { ConfigProvider, Form, UploadHandlersProvider, ServerFunctionsProvider, useForm, useFormModified, useFormInitializing, useServerFunctions, useDocumentInfo, useDocumentTitle, useConfig } from '@payloadcms/ui'
import type { ClientConfig, Field, FormState } from 'payload'
import { copyOriginalIntoVersion, wrapExperimentBlock, syncExperimentSlots, unwrapExperimentBlock } from '../../../src/blocks/formState.js'
import { BlockChangedError, replaceBlockRow } from '../../../src/admin/blocks/formApi.js'
import type { ExperimentBlock, HostBlock } from '../../../src/blocks/model.js'

vi.mock('next/navigation.js', () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {}, prefetch() {} }), usePathname: () => '/admin', useSearchParams: () => new URLSearchParams() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {}, prefetch() {} }), usePathname: () => '/admin', useSearchParams: () => new URLSearchParams() }))

// Only the server-function transport is replaced. Rows include the server-rendered
// component slots at that boundary; no Payload client hook or reducer is mocked.
function flatten(data: Record<string, unknown>): FormState {
  const state: FormState = {}
  function walk(value: unknown, path: string, schema?: Field, fields: Field[] = [field]) {
    if ((Array.isArray(value) || value === 0) && (schema?.type === 'array' || schema?.type === 'blocks')) {
      const rows = Array.isArray(value) ? value : []
      state[path] = { value: rows.length, ...(rows.length ? { disableFormData: true } : {}), rows: rows.map((row: any) => ({ id: row.id, ...(row.blockType ? { blockType: row.blockType } : {}) })) }
      rows.forEach((row, index) => walk(row, `${path}.${index}`, undefined, schema.type === 'array' ? schema.fields : schema.blocks.find(block => block.slug === row.blockType)?.fields ?? []))
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.entries(value).forEach(([key, item]) => walk(item, path ? `${path}.${key}` : key, fields.find(child => 'name' in child && child.name === key)))
      if ((value as any).blockType === 'xpExperiment') {
        state[`${path}.xpBlockStatus`] = { disableFormData: true, customComponents: { Field: <span>status</span> } }
        const slots = state[`${path}.slots`]!
        slots.rows?.forEach((row: any, index: number) => {
          row.customComponents = { RowLabel: <span>version</span> }
          state[`${path}.slots.${index}.xpCopyOriginal`] = { disableFormData: true, customComponents: { Field: <span>copy</span> } }
        })
      }
    } else state[path] = { value, initialValue: value, valid: true }
  }
  walk(data, '')
  return state
}
const field: any = { name: 'layout', type: 'blocks', blocks: [
  { slug: 'hero', fields: [{ name: 'items', type: 'array', fields: [{ name: 'text', type: 'text' }] }, { name: 'children', type: 'blocks', blocks: [{ slug: 'text', fields: [{ name: 'text', type: 'text' }] }] }] },
] }
field.blocks.push({ slug: 'xpExperiment', fields: [{ name: 'experiment', type: 'text' }, { name: 'slots', type: 'array', fields: [{ name: 'slot', type: 'text' }, { ...field, name: 'blocks', blocks: [...field.blocks] }] }] })
const carousel: HostBlock = { id: 'carousel', blockType: 'carousel', title: 'Courses', showTitle: true,
  selectionMode: 'manual', limit: 0, selectedCourses: ['course-one', 'course-two'], visibility: 'all',
  maxWidth: 'wide', verticalPadding: 'medium', autoplay: false, autoplayDelay: 0, slidesPerView: 3,
  showArrows: true, showDots: false, audiences: ['visitors', 'members'] }
const carouselFields: Field[] = [
  { name: 'title', type: 'text' }, { name: 'showTitle', type: 'checkbox' },
  { name: 'selectionMode', type: 'select', options: ['manual', 'latest'] },
  { name: 'limit', type: 'number', admin: { condition: (_, sibling) => sibling.selectionMode === 'latest' } },
  { name: 'selectedCourses', type: 'relationship', hasMany: true, relationTo: 'courses', admin: { condition: (_, sibling) => sibling.selectionMode === 'manual' } },
  { name: 'visibility', type: 'select', options: ['all', 'signed-in'], defaultValue: 'all' },
  { name: 'maxWidth', type: 'select', options: ['wide', 'full'], defaultValue: 'wide' },
  { name: 'verticalPadding', type: 'select', options: ['medium', 'none'], defaultValue: 'medium' },
  { name: 'autoplay', type: 'checkbox' },
  { name: 'autoplayDelay', type: 'number', admin: { condition: (_, sibling) => sibling.autoplay } },
  { name: 'slidesPerView', type: 'number' }, { name: 'showArrows', type: 'checkbox' }, { name: 'showDots', type: 'checkbox' },
  { name: 'audiences', type: 'select', hasMany: true, options: ['visitors', 'members'] },
]
field.blocks.push({ slug: 'carousel', fields: carouselFields })
// The wrapper's blocks list is a snapshot: register the host config there too.
field.blocks.find((block: any) => block.slug === 'xpExperiment').fields[1].fields[1].blocks.push({ slug: 'carousel', fields: carouselFields })
const original: HostBlock = { id: 'original', blockType: 'hero', items: [{ id: 'item', text: 'hello' }], children: [{ id: 'child', blockType: 'text', text: 'nested' }] }
const config = { collections: [{ slug: 'pages', fields: [field] }], globals: [], routes: { api: '/api', admin: '/admin' } } as unknown as ClientConfig
let probe: ReturnType<typeof useForm>
let modified = false
let getState: ReturnType<typeof useServerFunctions>['getFormState']
function Probe() {
  probe = useForm(); modified = useFormModified(); getState = useServerFunctions().getFormState
  useFormInitializing(); useDocumentInfo(); useDocumentTitle()
  for (const method of ['getData', 'getDataByPath', 'createFormData', 'replaceFieldRow', 'addFieldRow', 'removeFieldRow', 'moveFieldRow', 'dispatchFields', 'setModified'] as const) expect(typeof probe[method]).toBe('function')
  expect(useConfig().getEntityConfig({ collectionSlug: 'pages' }).fields).toHaveLength(1)
  return null
}
afterEach(cleanup)
async function assertData(rows: HostBlock[]) {
  expect(probe.getData()).toEqual({ layout: rows })
  expect(JSON.parse((await probe.createFormData({}, {})).get('_payload') as string)).toEqual({ layout: rows })
}
async function replace(rows: HostBlock[]) {
  await act(async () => { await replaceBlockRow({ form: probe, getFormState: getState, collectionSlug: 'pages', field: 'layout', index: 0, rows }) })
}
test('real public Form: wrap, sync (whole-row replacement), unwrap N=1/0/2; data, POST body, dirty state and server component slots', async () => {
  const initialState = flatten({ layout: [original] })
  const serverFunction: any = async ({ args }: any) => ({ state: flatten(args.data) })
  render(<ConfigProvider config={config}><ServerFunctionsProvider serverFunction={serverFunction}><UploadHandlersProvider><Form initialState={initialState}><Probe /></Form></UploadHandlersProvider></ServerFunctionsProvider></ConfigProvider>)
  await assertData([original])
  const wrapped = wrapExperimentBlock(original, 'test-returned', field)
  await replace([wrapped]); await assertData([wrapped]); expect(modified).toBe(true)
  expect(probe.getFields().layout?.rows?.[0]?.id).toBe(wrapped.id)
  const variant = wrapped.slots[1]!.blocks[0]!
  expect(variant.id).not.toBe(original.id)
  expect((variant.items as any)[0].id).not.toBe('item')
  expect((variant.children as any)[0].id).not.toBe('child')
  expect(probe.getFields()['layout.0.xpBlockStatus']?.customComponents?.Field).toBeTruthy()
  expect(probe.getFields()['layout.0.slots']?.rows?.[0]?.customComponents?.RowLabel).toBeTruthy()
  expect(probe.getFields()['layout.0.slots.1.xpCopyOriginal']?.customComponents?.Field).toBeTruthy()
  const synced = syncExperimentSlots(wrapped, [{ key: 'variantB' }, { key: 'control' }, { key: 'holdout' }], field)
  await act(async () => probe.setModified(false))
  await replace([synced]); await assertData([synced]); expect(modified).toBe(true)
  expect(probe.getFields().layout?.rows?.[0]?.id).toBe(wrapped.id)
  expect(synced.slots.map(row => row.slot)).toEqual(['variantB', 'control'])
  for (const count of [1, 0, 2]) {
    const block: ExperimentBlock = { ...wrapped, slots: [{ id: 'slot', slot: 'control', blocks: Array.from({ length: count }, () => original) }] }
    await replace([block])
    const rows = unwrapExperimentBlock(block, field)
    await act(async () => probe.setModified(false))
    await replace(rows); await assertData(rows); expect(modified).toBe(true)
    expect(new Set(rows.map(row => row.id)).size).toBe(count)
    rows.forEach(row => expect(row.id).not.toBe(original.id))
  }
})

function mountRows(rows: HostBlock[], server = async ({ args }: any) => ({ state: flatten(args.data) })) {
  render(<ConfigProvider config={config}><ServerFunctionsProvider serverFunction={server as any}><UploadHandlersProvider><Form initialState={flatten({ layout: rows })}><Probe /></Form></UploadHandlersProvider></ServerFunctionsProvider></ConfigProvider>)
}
const emptyRow: HostBlock = { id: 'empty', blockType: 'hero', items: [], children: [] }

test('a: Copy Original into an empty Variant A using the real getDataByPath expectedBlock', async () => {
  const wrapped = wrapExperimentBlock(carousel, 'carousel-test', field)
  wrapped.slots[1]!.blocks = []
  mountRows([wrapped])
  expect(probe.getFields()['layout.0.slots.1.blocks']).toMatchObject({ value: 0, rows: [] })
  expect(probe.getFields()['layout.0.slots.1.blocks']).not.toHaveProperty('disableFormData')
  expect(probe.getFields()['layout.0.slots.0.blocks.0.selectedCourses']).toMatchObject({ value: carousel.selectedCourses })
  expect(probe.getFields()['layout.0.slots.0.blocks.0.audiences']).not.toHaveProperty('rows')
  const expectedBlock = probe.getDataByPath<ExperimentBlock>('layout.0')
  const next = copyOriginalIntoVersion(expectedBlock, 'variantA', field)
  await act(async () => replaceBlockRow({ form: probe, getFormState: getState, collectionSlug: 'pages', field: 'layout', index: 0, rows: [next], expectedBlock }))
  await assertData([next])
  expect((next.slots[1]!.blocks[0]!).limit).toBe(0)
})
test('b: replace a host row when another row has empty lists', async () => {
  mountRows([carousel, emptyRow])
  const next = { ...carousel, title: 'Updated courses' }
  await replace([next])
  await assertData([next, { ...emptyRow, items: 0, children: 0 }])
})
test('c: sync versions when another row has empty lists', async () => {
  const wrapped = wrapExperimentBlock(carousel, 'carousel-test', field)
  mountRows([wrapped, emptyRow])
  const expectedBlock = probe.getDataByPath<ExperimentBlock>('layout.0')
  const next = syncExperimentSlots(expectedBlock, [{ key: 'control' }, { key: 'variantA' }, { key: 'variantB' }], field)
  await act(async () => replaceBlockRow({ form: probe, getFormState: getState, collectionSlug: 'pages', field: 'layout', index: 0, rows: [next], expectedBlock }))
  await assertData([next, { ...emptyRow, items: 0, children: 0 }])
})

test('a real target edit still refuses Copy Original before the server call', async () => {
  const wrapped = wrapExperimentBlock(carousel, 'carousel-test', field)
  wrapped.slots[1]!.blocks = []
  const server = vi.fn(async ({ args }: any) => ({ state: flatten(args.data) }))
  mountRows([wrapped], server)
  const expectedBlock = probe.getDataByPath<ExperimentBlock>('layout.0')
  await act(async () => probe.dispatchFields({ type: 'UPDATE', path: 'layout.0.slots.0.blocks.0.title', value: 'Another edit' }))
  await expect(replaceBlockRow({ form: probe, getFormState: getState, collectionSlug: 'pages', field: 'layout', index: 0,
    rows: [copyOriginalIntoVersion(expectedBlock, 'variantA', field)], expectedBlock })).rejects.toBeInstanceOf(BlockChangedError)
  expect(server).not.toHaveBeenCalled()
  expect(probe.getDataByPath('layout.0.slots.0.blocks.0.title')).toBe('Another edit')
})
test('a row added during the server round trip still refuses replacement', async () => {
  let finish!: (result: any) => void
  const server = vi.fn(({ args }: any) => new Promise<any>(resolve => { finish = () => resolve({ state: flatten(args.data) }) }))
  mountRows([carousel], server)
  let outcome!: Promise<unknown>
  await act(async () => {
    outcome = replaceBlockRow({ form: probe, getFormState: getState, collectionSlug: 'pages', field: 'layout', index: 0,
      rows: [{ ...carousel, title: 'Replacement' }] }).catch(error => error)
  })
  expect(server).toHaveBeenCalledOnce()
  await act(async () => probe.addFieldRow({ path: 'layout', rowIndex: 1, blockType: 'hero', schemaPath: 'pages.layout', subFieldState: flatten({ ...emptyRow }) }))
  await act(async () => { finish(undefined); expect(await outcome).toBeInstanceOf(BlockChangedError) })
  expect(probe.getDataByPath<HostBlock[]>('layout')).toHaveLength(2)
  expect(probe.getDataByPath('layout.0.title')).toBe(carousel.title)
})
test('object key order alone is accepted by both guards and getData input is unchanged', async () => {
  const server = vi.fn(async ({ args }: any) => {
    // Reinsert fields in a different order while the transport is pending.
    const current = probe.getFields()
    await act(async () => probe.dispatchFields({ type: 'REPLACE_STATE', state: Object.fromEntries(Object.entries(current).reverse()) }))
    return { state: flatten(args.data) }
  })
  mountRows([carousel, emptyRow], server)
  const expectedBlock = Object.fromEntries(Object.entries(probe.getDataByPath<HostBlock>('layout.0')).reverse()) as HostBlock
  await act(async () => replaceBlockRow({ form: probe, getFormState: getState, collectionSlug: 'pages', field: 'layout', index: 0,
    rows: [carousel], expectedBlock }))
  expect(server.mock.calls[0]![0].args.data.layout[1]).toEqual({ ...emptyRow, items: 0, children: 0 })
  await assertData([carousel, { ...emptyRow, items: 0, children: 0 }])
})
test('draft unwrap restores the carousel Original in real Form data and createFormData', async () => {
  const wrapped = wrapExperimentBlock(carousel, 'draft-carousel', field)
  wrapped.slots[1]!.blocks = []
  mountRows([wrapped])
  const expectedBlock = probe.getDataByPath<ExperimentBlock>('layout.0')
  const rows = unwrapExperimentBlock(expectedBlock, field)
  await act(async () => replaceBlockRow({ form: probe, getFormState: getState, collectionSlug: 'pages', field: 'layout', index: 0, rows, expectedBlock }))
  expect(rows[0]).toEqual({ ...carousel, id: expect.any(String) })
  expect(rows[0]!.id).not.toBe(carousel.id)
  await assertData(rows)
})
