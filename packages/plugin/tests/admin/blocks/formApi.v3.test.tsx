// @vitest-environment jsdom
import React from 'react'
import { act, render, cleanup } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { ConfigProvider, Form, UploadHandlersProvider, ServerFunctionsProvider, useForm, useFormModified, useFormInitializing, useServerFunctions, useDocumentInfo, useDocumentTitle, useConfig } from '@payloadcms/ui'
import type { ClientConfig, FormState } from 'payload'
import { wrapExperimentBlock, syncExperimentSlots, unwrapExperimentBlock } from '../../../src/blocks/formState.js'
import { replaceBlockRow } from '../../../src/admin/blocks/formApi.js'
import type { ExperimentBlock, HostBlock } from '../../../src/blocks/model.js'

vi.mock('next/navigation.js', () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {}, prefetch() {} }), usePathname: () => '/admin', useSearchParams: () => new URLSearchParams() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {}, prefetch() {} }), usePathname: () => '/admin', useSearchParams: () => new URLSearchParams() }))

// Only the server-function transport is replaced. Rows include the server-rendered
// component slots at that boundary; no Payload client hook or reducer is mocked.
function flatten(data: Record<string, unknown>): FormState {
  const state: FormState = {}
  function walk(value: unknown, path: string) {
    if (Array.isArray(value)) {
      state[path] = { value: value.length, disableFormData: true, rows: value.map((row: any) => ({ id: row.id, ...(row.blockType ? { blockType: row.blockType } : {}) })) }
      value.forEach((row, index) => walk(row, `${path}.${index}`))
    } else if (value && typeof value === 'object') {
      Object.entries(value).forEach(([key, item]) => walk(item, path ? `${path}.${key}` : key))
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
