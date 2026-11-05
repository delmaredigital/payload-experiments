// @vitest-environment jsdom
import React, { createElement, useMemo, useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest'
import { payloadUiMock, resetPayloadUiMock, setAuth, setConfig, setField } from '../admin/_helpers/payloadUiMock.js'
import { XpGoalField } from '../../src/admin/goals/XpGoalField.js'
import { xpGoalPuckEditorField } from '../../src/puck/editor/xpGoalPuckEditorField.js'
import { CLICK_GOAL_COPY as C } from '../../src/goals/picker/copy.js'

vi.mock('@payloadcms/ui', () => ({ ...payloadUiMock(),
  FieldLabel: ({ path, label }: { path: string; label: string }) => <label htmlFor={`field-${path.replace(/\./g, '__')}`}>{label}</label>,
  FieldError: ({ showError }: { showError: boolean }) => showError ? <p role="alert">Server validation error</p> : null }))
const rows = [{ id: 1, name: 'Join us', slug: 'join', source: 'click:join' }]
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
let apiSequence = 0
let apiRoute: string
let fetcher: ReturnType<typeof vi.fn>, select: Mock<(value: string) => void>
beforeEach(() => {
  resetPayloadUiMock(); select = vi.fn()
  apiRoute = `/picker-api-${++apiSequence}`
  setConfig({ config: { routes: { api: apiRoute, admin: '/admin' } } })
  setAuth({ permissions: { collections: { 'xp-experiments': { update: true } } } })
  setField({ value: 'missing', setValue: select, showError: false }, 'buttons.0.xpGoal')
  fetcher = vi.fn(async () => json({ docs: rows, hasNextPage: false })); vi.stubGlobal('fetch', fetcher)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
function Payload({ path = 'buttons.0.xpGoal' }: { path?: string }) { return <XpGoalField {...{ path, field: { name: 'xpGoal', type: 'text', label: C.label, admin: { description: 'Host help' } } } as any} /> }
function Puck() {
  const [value, setValue] = useState('missing')
  const puckField = useMemo(() => xpGoalPuckEditorField({ routes: { api: apiRoute } }), [apiRoute])
  return createElement(puckField.render, { value, onChange: (next: string) => { select(next); setValue(next) } } as any)
}

describe.each([{ host: 'Payload', Host: Payload }, { host: 'Puck', Host: Puck }])('$host drives the shared headless picker', ({ Host }) => {
  test('warning only after ready, source contains matches filtered, picking selects slug', async () => {
    let resolve!: (value: Response) => void
    fetcher.mockImplementationOnce(() => new Promise<Response>(done => { resolve = done }))
    render(<Host />)
    expect(screen.queryByText(C.undefinedKey)).toBeNull()
    await act(async () => resolve(json({ docs: [...rows, { id: 2, name: 'Fake', slug: 'fake', source: 'events:click:fake' }], hasNextPage: false })))
    expect(await screen.findByText(C.undefinedKey)).toBeTruthy()
    expect(screen.queryByRole('option', { name: 'Fake' })).toBeNull()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'join' } })
    expect(select).toHaveBeenCalledWith('join')
    expect(String(fetcher.mock.calls[0]![0])).toContain('where%5Bsource%5D%5Blike%5D=click%3A')
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ credentials: 'include' })
  })
  test('403 silently becomes only the plain input', async () => {
    fetcher.mockResolvedValue(json({ errors: [{ message: 'secret' }] }, 403))
    render(<Host />)
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    await act(async () => {})
    expect(screen.getByLabelText(C.label)).toBeTruthy()
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByText(C.newGoal)).toBeNull()
    expect(screen.queryByText(C.undefinedKey)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })
  test('Enter never submits or creates, Cancel sends nothing, inputs have no names', async () => {
    const submit = vi.fn(event => event.preventDefault())
    render(<form onSubmit={submit}><Host /></form>)
    fireEvent.click(await screen.findByText(C.newGoal))
    fireEvent.change(screen.getByLabelText(C.name), { target: { value: 'Join now' } })
    const name = screen.getByLabelText(C.name), slug = screen.getByLabelText(C.slug)
    expect(name.hasAttribute('name')).toBe(false); expect(slug.hasAttribute('name')).toBe(false)
    for (const input of [name, slug]) expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(false)
    expect(submit).not.toHaveBeenCalled()
    expect(fetcher).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByText(C.cancel))
    expect(screen.queryByLabelText(C.name)).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  test('success creates the fixed body, selects the new slug and closes the panel', async () => {
    render(<Host />); fireEvent.click(await screen.findByText(C.newGoal))
    fireEvent.change(screen.getByLabelText(C.name), { target: { value: 'New goal' } })
    fetcher.mockResolvedValueOnce(json({ doc: { id: 2, name: 'New goal', slug: 'new-goal', source: 'click:new-goal' } }))
    fireEvent.click(screen.getByText(C.createGoal))
    await waitFor(() => expect(select).toHaveBeenCalledWith('new-goal'))
    expect(screen.queryByLabelText(C.name)).toBeNull()
    expect(screen.getByRole('option', { name: 'New goal' })).toBeTruthy()
    const init = fetcher.mock.calls[1]![1]
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ name: 'New goal', slug: 'new-goal', source: 'click:new-goal', direction: 'increase', attributionWindowHours: 168, minSampleSize: 150, capping: { type: null, value: null } })
  })
  test('empty prefill and edited invalid slug open Advanced and never request', async () => {
    render(<Host />); fireEvent.click(await screen.findByText(C.newGoal))
    fireEvent.change(screen.getByLabelText(C.name), { target: { value: '🤍' } })
    expect(screen.getByText(C.slugRule)).toBeTruthy()
    expect(screen.getByText(C.advanced).closest('details')?.open).toBe(true)
    fireEvent.click(screen.getByText(C.createGoal)); expect(fetcher).toHaveBeenCalledTimes(1)
    fireEvent.change(screen.getByLabelText(C.slug), { target: { value: 'BAD' } })
    fireEvent.click(screen.getByText(C.createGoal)); expect(fetcher).toHaveBeenCalledTimes(1)
    expect(screen.getByText(C.slugRule)).toBeTruthy()
  })
  test.each([
    [{ errors: [{ path: 'slug', message: 'Value must be unique' }] }, C.duplicateSlug],
    [{ errors: [{ data: { errors: [{ path: 'slug', message: 'raw validation' }] } }] }, C.duplicateSlug],
    [{ errors: [{ message: 'database internals' }] }, C.saveError],
  ])('create failure maps to authored copy: %j', async (body, message) => {
    render(<Host />); fireEvent.click(await screen.findByText(C.newGoal))
    fireEvent.change(screen.getByLabelText(C.name), { target: { value: 'Join now' } })
    fetcher.mockResolvedValueOnce(json(body, 400))
    fireEvent.click(screen.getByText(C.createGoal))
    expect(await screen.findByText(message)).toBeTruthy()
    if (message === C.duplicateSlug) expect(screen.getByText(C.advanced).closest('details')?.open).toBe(true)
    expect(select).not.toHaveBeenCalled()
  })
})
test('Payload respects array path, field help, server error, read-only and manager permissions', async () => {
  setAuth({ permissions: { collections: {} } })
  setField({ value: 'join', setValue: select, showError: true }, 'buttons.0.xpGoal')
  const { rerender } = render(<Payload />)
  expect(screen.getByLabelText(C.label)).toHaveProperty('value', 'join')
  expect(screen.getByText('Server validation error')).toBeTruthy()
  expect(fetcher).not.toHaveBeenCalled()
  expect(screen.queryByText(C.newGoal)).toBeNull()
  rerender(<XpGoalField {...{ path: 'buttons.0.xpGoal', readOnly: true, field: { name: 'xpGoal', type: 'text', label: C.label } } as any} />)
  expect(screen.getByLabelText(C.label)).toHaveProperty('readOnly', true)
})

test('a deferred create uses the current array-row setter after a reorder', async () => {
  let complete!: (value: Response) => void
  const { rerender } = render(<Payload />)
  fireEvent.click(await screen.findByText(C.newGoal))
  fireEvent.change(screen.getByLabelText(C.name), { target: { value: 'New goal' } })
  fetcher.mockImplementationOnce(() => new Promise<Response>(resolve => { complete = resolve }))
  fireEvent.click(screen.getByText(C.createGoal))
  const movedSelect = vi.fn()
  act(() => setField({ value: 'missing', setValue: movedSelect, showError: false }, 'buttons.1.xpGoal'))
  rerender(<Payload path="buttons.1.xpGoal" />)
  await act(async () => complete(json({ doc: { id: 2, name: 'New goal', slug: 'new-goal', source: 'click:new-goal' } })))
  expect(movedSelect).toHaveBeenCalledWith('new-goal')
  expect(select).not.toHaveBeenCalled()
})

test('three array rows share an in-flight read, a created goal, and the loaded list on remount', async () => {
  let finish!: (response: Response) => void
  fetcher.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve }))
  const rowsView = render(<><Payload /><Payload path="buttons.1.xpGoal" /><Payload path="buttons.2.xpGoal" /></>)
  expect(fetcher).toHaveBeenCalledTimes(1)
  await act(async () => { finish(json({ docs: rows, hasNextPage: false })) })
  expect(await screen.findAllByRole('option', { name: 'Join us' })).toHaveLength(3)
  fireEvent.click(screen.getAllByText(C.newGoal)[0]!)
  fireEvent.change(screen.getByLabelText(C.name), { target: { value: 'Shared goal' } })
  fetcher.mockResolvedValueOnce(json({ doc: { id: 2, name: 'Shared goal', slug: 'shared-goal', source: 'click:shared-goal' } }))
  fireEvent.click(screen.getByText(C.createGoal))
  await waitFor(() => expect(screen.getAllByRole('option', { name: 'Shared goal' })).toHaveLength(3))
  expect(select).toHaveBeenCalledWith('shared-goal')
  expect(fetcher).toHaveBeenCalledTimes(2)
  rowsView.unmount()
  render(<Payload />)
  expect(await screen.findByRole('option', { name: 'Shared goal' })).toBeTruthy()
  expect(fetcher).toHaveBeenCalledTimes(2)
})

test.each([403, 500, 'offline'] as const)('a failed shared load is retried by the next mount (%s)', async failure => {
  if (failure === 'offline') fetcher.mockRejectedValueOnce(new Error('offline'))
  else fetcher.mockResolvedValueOnce(json({}, failure))
  render(<Payload />)
  await act(async () => {})
  expect(screen.queryByRole('combobox')).toBeNull()
  render(<Payload path="buttons.1.xpGoal" />)
  await waitFor(() => expect(screen.getAllByRole('option', { name: 'Join us' })).toHaveLength(2))
  expect(fetcher).toHaveBeenCalledTimes(2)
})

test('different API bases have separate shared lists', async () => {
  render(<><Payload />{createElement(xpGoalPuckEditorField({ routes: { api: '/other-api' } }).render, { value: '', onChange: select } as any)}</>)
  await waitFor(() => expect(screen.getAllByRole('option', { name: 'Join us' })).toHaveLength(2))
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(fetcher.mock.calls.map(([url]) => new URL(url, 'https://host').pathname)).toEqual([`${apiRoute}/xp-metrics`, '/other-api/xp-metrics'])
})
