// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { ConfigProvider, Form, UploadHandlersProvider, ServerFunctionsProvider, useForm } from '@payloadcms/ui'
import type { ClientConfig } from 'payload'
import { XpGoalField } from '../../../src/admin/goals/XpGoalField.js'
import { CLICK_GOAL_COPY as C } from '../../../src/goals/picker/copy.js'

vi.mock('next/navigation.js', () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {}, prefetch() {} }), usePathname: () => '/admin', useSearchParams: () => new URLSearchParams() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {}, prefetch() {} }), usePathname: () => '/admin', useSearchParams: () => new URLSearchParams() }))
// Only the authorization boundary is replaced; Form, useField and all UI remain real.
vi.mock('@payloadcms/ui', async importOriginal => ({ ...await importOriginal<typeof import('@payloadcms/ui')>(), useAuth: () => ({ permissions: { collections: { 'xp-experiments': { update: true } } } }) }))
const config = { collections: [], globals: [], routes: { api: '/api', admin: '/admin' } } as unknown as ClientConfig
let form: ReturnType<typeof useForm>
function Probe() { form = useForm(); return null }
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

test('real SelectInput selects the second goal into Payload Form data', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ docs: [
    { id: 'join', name: 'Join', slug: 'join', source: 'click:join' },
    { id: 'donate', name: 'Donate', slug: 'donate', source: 'click:donate' },
  ], hasNextPage: false }))))
  render(<ConfigProvider config={config}><ServerFunctionsProvider serverFunction={async () => ({}) as any}><UploadHandlersProvider>
    <Form initialState={{ 'buttons.0.xpGoal': { value: '', initialValue: '', valid: true } }}><Probe />
      <XpGoalField {...{ path: 'buttons.0.xpGoal', field: { name: 'xpGoal', type: 'text', label: C.label } } as any} />
    </Form>
  </UploadHandlersProvider></ServerFunctionsProvider></ConfigProvider>)
  await screen.findByText(C.newGoal)
  fireEvent.keyDown(await screen.findByRole('combobox'), { key: 'ArrowDown', code: 'ArrowDown' })
  fireEvent.click(await screen.findByRole('option', { name: 'Donate' }))
  await waitFor(() => expect(form.getData()).toEqual({ buttons: [{ xpGoal: 'donate' }] }))
  expect(Object.keys(form.getFields())).toEqual(['buttons.0.xpGoal'])
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown', code: 'ArrowDown' })
  fireEvent.click(await screen.findByRole('option', { name: C.none }))
  await waitFor(() => expect(form.getData()).toEqual({ buttons: [{ xpGoal: '' }] }))
  expect(screen.getByText(C.none)).toBeTruthy()
})

test('Payload shows the missing-goal sentence once when server validation is visible', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ docs: [], hasNextPage: false }))))
  const path = 'buttons.0.xpGoal'
  render(<ConfigProvider config={config}><ServerFunctionsProvider serverFunction={async () => ({}) as any}><UploadHandlersProvider>
    <Form initialState={{ [path]: { value: 'missing', initialValue: 'missing', valid: true } }}><Probe />
      <XpGoalField {...{ path, field: { name: 'xpGoal', type: 'text', label: C.label } } as any} />
    </Form>
  </UploadHandlersProvider></ServerFunctionsProvider></ConfigProvider>)
  expect((await screen.findByText(C.undefinedKey)).getAttribute('role')).toBe('status')
  await act(async () => {
    form.dispatchFields({ type: 'UPDATE', path, valid: false, errorMessage: C.undefinedKey })
    form.setSubmitted(true)
  })
  expect(screen.getAllByText(C.undefinedKey)).toHaveLength(1)
  expect(screen.getByText(C.undefinedKey).getAttribute('role')).not.toBe('status')
  expect(document.querySelector('.xp-goal-field > [role="status"]')).toBeNull()
  await act(async () => { form.setSubmitted(false) })
  expect(screen.getAllByText(C.undefinedKey)).toHaveLength(1)
  expect(screen.getByText(C.undefinedKey).getAttribute('role')).toBe('status')
})

test('inline panel never joins real Payload Form state or serialized outer form data', async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ docs: [{ id: 'join', name: 'Join', slug: 'join', source: 'click:join' }], hasNextPage: false })))
  vi.stubGlobal('fetch', fetcher)
  render(<ConfigProvider config={config}><ServerFunctionsProvider serverFunction={async () => ({}) as any}><UploadHandlersProvider>
    <Form initialState={{ 'buttons.0.xpGoal': { value: 'join', initialValue: 'join', valid: true } }}><Probe />
      <XpGoalField {...{ path: 'buttons.0.xpGoal', field: { name: 'xpGoal', type: 'text', label: C.label } } as any} />
    </Form>
  </UploadHandlersProvider></ServerFunctionsProvider></ConfigProvider>)
  fireEvent.click(await screen.findByText(C.newGoal))
  fireEvent.change(screen.getByLabelText(C.name), { target: { value: 'Private panel draft' } })
  fireEvent.change(screen.getByLabelText(C.slug), { target: { value: 'private-panel-key' } })
  for (const label of [C.name, C.slug]) {
    const input = screen.getByLabelText(label)
    expect(input.hasAttribute('name')).toBe(false)
    expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(false)
  }
  const expected = { buttons: [{ xpGoal: 'join' }] }
  expect(form.getData()).toEqual(expected)
  expect(Object.keys(form.getFields())).toEqual(['buttons.0.xpGoal'])
  await act(async () => {
    expect(JSON.parse((await form.createFormData({}, {})).get('_payload') as string)).toEqual(expected)
  })
  fireEvent.click(screen.getByText(C.cancel))
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(form.getData()).toEqual(expected)
})
