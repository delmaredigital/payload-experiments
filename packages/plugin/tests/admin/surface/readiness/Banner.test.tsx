// @vitest-environment jsdom
import { ACTIONS_COPY } from '../../../../src/admin/copy/actions.js'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useTestDocument } from '../../../../src/admin/surface/useTestDocument.js'
import { Banner } from '../../../../src/admin/surface/readiness/Banner.js'
import * as adminApi from '../../../../src/admin/api.js'
import { SaveStatus } from '../../../../src/admin/surface/readiness/SaveStatus.js'
import { readinessParts } from '../../../../src/admin/surface/readiness/parts.js'
import { expectedConfirm } from '../../../../src/transitions/confirmPhrases.js'
import { resetPayloadUiMock } from '../../_helpers/payloadUiMock.js'
import { props, preflight, doc } from './fixtures.js'

vi.mock('@payloadcms/ui', async () => (await import('../../_helpers/payloadUiMock.js')).payloadUiMock())
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
})
afterEach(() => { cleanup(); resetPayloadUiMock(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks() })
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement
const dialogButton = (name: string) => within(screen.getByRole('dialog')).getByRole('button', { name }) as HTMLButtonElement
const success = () => response({ doc: {}, revision: 2 })

test.each([
  ['Add a goal', 'Metric not found', 'That goal no longer exists. Choose another goal.'],
  ['Add a goal', 'The phase record was not found.', 'That goal no longer exists. Choose another goal.'],
  ['Let more people in', 'The phase record was not found.', 'This round has changed. Reload the page.'],
  ['Stop', 'Experiment not found', 'This test no longer exists.'],
])('%s names what is missing for a 404: %s', async (action, message, expected) => {
  const p = props({ status: 'running' })
  const fetcher = vi.fn()
  if (action === 'Add a goal') fetcher.mockResolvedValueOnce(response({ docs: [{ id: 4, name: 'New outcome' }] }))
  fetcher.mockResolvedValueOnce(response({ errors: [{ code: 'not-found', message }] }, 404))
  vi.stubGlobal('fetch', fetcher)
  render(<Banner {...p} />)
  fireEvent.click(button(action))
  if (action === 'Add a goal') {
    await screen.findByRole('option', { name: 'New outcome' })
    fireEvent.change(screen.getByLabelText('Metric'), { target: { value: '4' } })
  }
  fireEvent.click(dialogButton(action))
  expect((await screen.findByRole('alert')).textContent).toBe(expected)
  expect(p.test.reload).not.toHaveBeenCalled()
})

test('exports the complete parts and a ready primary Start for a draft', () => {
  expect(readinessParts.Banner).toBe(Banner)
  expect(readinessParts.SaveStatus).toBe(SaveStatus)
  render(<Banner {...props()} />)
  expect(screen.getByRole('status').textContent).toBe('Ready to start.')
  expect(button('Start').disabled).toBe(false)
  expect(button('Start').closest('.xp-readiness--ready')).toBeTruthy()
})
test('only the first missing item is shown, linked in section order, and disables Start with its tooltip', () => {
  render(<Banner {...props({}, { preflight: preflight([{ code: 'no-planned-duration', ok: false }, { code: 'no-primary-metric', ok: false }]) })} />)
  expect(screen.getByRole('link').getAttribute('href')).toBe('#section-win')
  expect(screen.getByRole('status').textContent).toBe('Next: Choose a goal.')
  expect(button('Start').disabled).toBe(true)
  expect(button('Start').closest('[title]')?.getAttribute('title')).toBe('Choose a goal.')
  expect(screen.queryByText('Choose how long to run it.')).toBeNull()
})
test('block path refusal shows its message and removal line in Who takes part and disables Start', () => {
  render(<Banner {...props({}, { preflight: preflight([{ code: 'block-path-rule', ok: false, detail: { rules: [1] } }]) })} />)
  const message = 'Remove the page-path rule in Who takes part; page block tests run on their page.'
  expect(screen.getByRole('status').textContent).toContain(message)
  expect(screen.getByText('Remove rule').closest('a')?.getAttribute('href')).toBe('#section-who')
  expect(button('Start').disabled).toBe(true)
  expect(button('Start').closest('[title]')?.getAttribute('title')).toBe(message)
})
test.each([{ hasUnsaved: true }, { saving: 'saving' as const }])('Start disabled when changes are pending: %j', patch => {
  render(<Banner {...props({}, patch)} />)
  expect(button('Start').disabled).toBe(true)
  expect(button('Start').closest('[title]')?.getAttribute('title')).toBe('Save your changes first.')
})
test('absent preflight never permits a start; a header refusal has no section link', () => {
  const view = render(<Banner {...props({}, { preflight: null })} />)
  expect(button('Start').disabled).toBe(true)
  expect(screen.getByRole('status').textContent).toBe('Checking readiness…')
  view.rerender(<Banner {...props({}, { preflight: preflight([{ code: 'page-user-unit', ok: false }]) })} />)
  expect(screen.queryByRole('link')).toBeNull()
  expect(screen.getByRole('status').textContent).toBe('Next: Whole-page tests count visitors. Create the test again counting visitors.')
})
test('draft start is direct, locks synchronously, posts once with credentials and reloads on success', async () => {
  let resolve!: (value: Response) => void
  const fetcher = vi.fn().mockReturnValue(new Promise<Response>(done => { resolve = done }))
  vi.stubGlobal('fetch', fetcher)
  const p = props()
  render(<Banner {...p} />)
  act(() => { button('Start').click(); button('Start').click() })
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(fetcher.mock.calls[0]?.[0]).toBe('/custom-api/xp/experiments/xp1/start')
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', credentials: 'include' })
  expect(screen.queryByRole('dialog')).toBeNull()
  resolve(success())
  await waitFor(() => expect(p.test.reload).toHaveBeenCalledTimes(1))
  fireEvent.click(button('Start'))
  expect(fetcher).toHaveBeenCalledTimes(1)
})
test('a server refusal appears inline and allows a later attempt', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(response({ errors: [{ code: 'future-refusal', message: 'Someone else started this test.' }] }, 409)).mockResolvedValueOnce(success())
  vi.stubGlobal('fetch', fetcher)
  const p = props()
  render(<Banner {...p} />)
  fireEvent.click(button('Start'))
  expect((await screen.findByRole('alert')).textContent).toBe('Someone else started this test.')
  expect(p.test.reload).not.toHaveBeenCalled()
  fireEvent.click(button('Start'))
  await waitFor(() => expect(p.test.reload).toHaveBeenCalledTimes(1))
})
test('stopped test shows the date and restart copy, confirms before posting, then reloads', async () => {
  const p = props({ status: 'stopped', stoppedAt: '2026-11-01T12:00:00Z' })
  const fetcher = vi.fn().mockResolvedValue(success())
  vi.stubGlobal('fetch', fetcher)
  render(<Banner {...p} />)
  expect(screen.getByText('Stopped 1 Nov 2026. Edit the versions, goal, audience or length below, then start again (results restart).')).toBeTruthy()
  fireEvent.click(button('Start a new round'))
  expect(fetcher).not.toHaveBeenCalled()
  expect(screen.getByText('Starting again begins a new round; results restart.')).toBeTruthy()
  act(() => { dialogButton('Start a new round').click(); dialogButton('Start a new round').click() })
  await waitFor(() => expect(p.test.reload).toHaveBeenCalledTimes(1))
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('dialog')).toBeNull()
})
test('running sentence omits unknown parts and offers only the three status actions', () => {
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  render(<Banner {...props({ status: 'running', analysis: null })} />)
  expect(screen.getByRole('status').textContent).toBe('Running')
  expect(screen.getAllByRole('button').map(item => item.textContent)).toEqual(['Stop', 'Add a goal', 'Let more people in'])
  expect(fetcher).not.toHaveBeenCalled()
})
test('running people count comes from the summary with results access, once per mount and status', async () => {
  const fetcher = vi.fn().mockImplementation(async () => response({ xp1: { exposures: 1200, days: 1, verdict: null } }))
  vi.stubGlobal('fetch', fetcher)
  const p = props({ status: 'running', startedAt: '2026-11-01T12:00:00Z' })
  p.surface.canReadResults = true
  const view = render(<Banner {...p} />)
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('1,200 people so far'))
  expect(screen.getByRole('status').textContent).toMatch(/^Running since 1 Nov 2026 · 1,200 people so far · about \d+ days to go$/)
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(fetcher).toHaveBeenCalledWith('/custom-api/xp/experiments/summary?ids=xp1', { method: 'GET', credentials: 'include' })
  view.rerender(<Banner {...p} test={{ ...p.test, doc: { ...p.test.doc!, name: 'New name' } }} />)
  expect(fetcher).toHaveBeenCalledTimes(1)
  view.rerender(<Banner {...p} test={{ ...p.test, doc: { ...p.test.doc!, status: 'stopped' } }} />)
  view.rerender(<Banner {...p} />)
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('1,200 people so far'))
  expect(fetcher).toHaveBeenCalledTimes(2)
})
test.each(['forbidden', 'missing', 'missing count', 'no body'])('running omits unavailable summary people count: %s', async kind => {
  const fetcher = vi.fn().mockResolvedValue(kind === 'forbidden' ? response({}, 403)
    : kind === 'missing' ? response({}) : kind === 'missing count' ? response({ xp1: { days: 1, verdict: null } }) : new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetcher)
  const p = props({ status: 'running', analysis: null })
  p.surface.canReadResults = true
  await act(async () => { render(<Banner {...p} />) })
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('status').textContent).toBe('Running')
  expect(screen.queryByRole('alert')).toBeNull()
})
test.each(['failed response', 'rejection'])('running keeps the successful count after a summary refresh %s', async failure => {
  const p = props({ status: 'running', analysis: null })
  p.surface.canReadResults = true
  const api = adminApi.createApi(p.surface.apiRoute)
  const summary = vi.fn<typeof api.summary>().mockResolvedValueOnce({ ok: true, data: { xp1: { exposures: 1200, days: 1, verdict: null } } })
  if (failure === 'rejection') summary.mockRejectedValueOnce(new Error('Offline'))
  else summary.mockResolvedValueOnce({ ok: false, status: 503, message: 'Unavailable', retryable: true })
  vi.spyOn(adminApi, 'createApi').mockReturnValue({ ...api, summary })
  const view = render(<Banner {...p} resultsVersion={1} />)
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Running · 1,200 people so far'))
  await act(async () => { view.rerender(<Banner {...p} resultsVersion={2} />) })
  expect(summary).toHaveBeenCalledTimes(2)
  expect(screen.getByRole('status').textContent).toBe('Running · 1,200 people so far')
})
test('a rejected summary on first load leaves the count unknown', async () => {
  const p = props({ status: 'running', analysis: null })
  p.surface.canReadResults = true
  const api = adminApi.createApi(p.surface.apiRoute)
  const summary = vi.fn<typeof api.summary>().mockRejectedValue(new Error('Offline'))
  vi.spyOn(adminApi, 'createApi').mockReturnValue({ ...api, summary })
  await act(async () => { render(<Banner {...p} />) })
  expect(summary).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('status').textContent).toBe('Running')
})
test('running allocation at 100% is disabled with an explanation', () => {
  render(<Banner {...props({ status: 'running', allocation: 100 })} />)
  expect(button('Let more people in').disabled).toBe(true)
  expect(button('Let more people in').closest('[title]')?.getAttribute('title')).toBe('Everyone already takes part.')
})
test('Stop uses the established confirmation and displays a refusal inside the dialog', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ errors: [{ message: 'This test was already stopped.' }] }, 409)))
  const p = props({ status: 'running' })
  render(<Banner {...p} />)
  fireEvent.click(button('Stop'))
  expect(document.activeElement).toBe(dialogButton('Cancel'))
  expect(screen.getByText('Everyone will see the Original. Starting again begins a new round; results restart.')).toBeTruthy()
  fireEvent.click(dialogButton('Stop'))
  expect((await screen.findByRole('alert')).textContent).toBe('This test was already stopped.')
  expect(p.test.reload).not.toHaveBeenCalled()
})
test('decided uses saved winner label and model actions, including typed discard and Archive after content', async () => {
  const p = props({ status: 'decided', decidedAt: '2026-11-01T12:00:00Z',
    arms: [...doc.arms, { key: 'holdout', kind: 'holdout', label: 'Holdout', weight: 0 }],
    decision: { winnerArm: 'variantA', contentReport: { docs: [{ collection: 'pages', id: 1, ok: true }] } } })
  const fetcher = vi.fn().mockResolvedValue(success())
  vi.stubGlobal('fetch', fetcher)
  render(<Banner {...p} />)
  expect(screen.getByRole('status').textContent).toBe('Decided 1 Nov 2026: Short headline.')
  for (const name of ['Make it the content', 'Release holdout', 'Discard winner', 'Finish archiving']) expect(button(name)).toBeTruthy()
  fireEvent.click(button('Discard winner'))
  expect(dialogButton('Discard winner').disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('Confirmation'), { target: { value: expectedConfirm('discard', 'Short headline') } })
  fireEvent.click(dialogButton('Discard winner'))
  await waitFor(() => expect(p.test.reload).toHaveBeenCalledTimes(1))
  expect(JSON.parse(fetcher.mock.calls[0]?.[1].body)).toEqual({ mode: 'discard', confirmation: 'discard winner' })
})
test.each(['Release holdout', 'Finish archiving'])('%s routes to the corresponding transition and reloads', async name => {
  const p = props({ status: 'decided', arms: [...doc.arms, { key: 'holdout', kind: 'holdout', label: 'Holdout', weight: 0 }],
    decision: { winnerArm: 'variantA', contentReport: { docs: [{ collection: 'pages', id: 1, ok: true }] } } })
  const fetcher = vi.fn().mockResolvedValue(response({ doc: {}, revision: 2, docs: [{ collection: 'pages', id: 1, ok: true }] }))
  vi.stubGlobal('fetch', fetcher)
  render(<Banner {...p} />)
  fireEvent.click(button(name))
  fireEvent.click(dialogButton(name))
  await waitFor(() => expect(p.test.reload).toHaveBeenCalledTimes(1))
  const endpoint = name === 'Release holdout' ? 'release-holdout' : 'archive'
  expect(fetcher.mock.calls[0]?.[0]).toBe(`/custom-api/xp/experiments/xp1/${endpoint}`)
})
test.each([true, false])('make-content shows its per-document report until Done, including full success: %s', async ok => {
  const p = props({ status: 'decided', decision: { winnerArm: 'variantA' } })
  const fetcher = vi.fn().mockResolvedValue(response({ docs: [
    { collection: 'pages', id: 1, ok: true }, { collection: 'pages', id: 2, ok, ...(ok ? {} : { error: 'Locked by another editor.' }) },
  ] }))
  vi.stubGlobal('fetch', fetcher)
  render(<Banner {...p} />)
  fireEvent.click(button('Make it the content'))
  act(() => { dialogButton('Make it the content').click(); dialogButton('Make it the content').click() })
  expect(await screen.findByText('pages/1: Updated')).toBeTruthy()
  expect(screen.getByText(ok ? 'pages/2: Updated' : `pages/2: Failed — ${ACTIONS_COPY.contentReasons['update-failed']}`)).toBeTruthy()
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(fetcher.mock.calls[0]?.[0]).toBe('/custom-api/xp/experiments/xp1/make-content')
  expect(p.test.reload).not.toHaveBeenCalled()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(dialogButton('Done').disabled).toBe(false)
  fireEvent.click(dialogButton('Done'))
  await waitFor(() => expect(p.test.reload).toHaveBeenCalledTimes(1))
  expect(screen.queryByRole('dialog')).toBeNull()
})
test('archived has no actions; read-only users get status without mutation controls', () => {
  const view = render(<Banner {...props({ status: 'archived' })} />)
  expect(screen.getByRole('status').textContent).toBe('Archived.')
  expect(screen.queryByRole('button')).toBeNull()
  const p = props({ status: 'running' })
  view.rerender(<Banner {...p} surface={{ ...p.surface, canManage: false }} />)
  expect(screen.queryByRole('button')).toBeNull()
})
test('allocate validates strictly upwards, posts once, and reloads', async () => {
  const p = props({ status: 'running' })
  let resolve!: (value: Response) => void
  const fetcher = vi.fn().mockReturnValue(new Promise<Response>(done => { resolve = done }))
  vi.stubGlobal('fetch', fetcher)
  render(<Banner {...p} />)
  fireEvent.click(button('Let more people in'))
  const field = screen.getByLabelText('How many people take part (%)')
  fireEvent.change(field, { target: { value: '40' } })
  expect(dialogButton('Let more people in').disabled).toBe(true)
  fireEvent.change(field, { target: { value: '60' } })
  act(() => { dialogButton('Let more people in').click(); dialogButton('Let more people in').click() })
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(JSON.parse(fetcher.mock.calls[0]?.[1].body)).toEqual({ allocation: 60 })
  expect(fetcher.mock.calls[0]?.[0]).toBe('/custom-api/xp/experiments/xp1/allocate')
  resolve(success())
  await waitFor(() => expect(p.test.reload).toHaveBeenCalledTimes(1))
})
test.each(['secondary', 'guardrail'])('metric adapter excludes attached goals and allows only a %s addition', async role => {
  const p = props({ status: 'running' })
  const fetcher = vi.fn().mockResolvedValueOnce(response({ docs: [{ id: 1, name: 'Main' }, { id: 2, name: 'Attached' }, { id: 3, name: 'Guardrail' }, { id: 4, name: 'New outcome' }] })).mockResolvedValueOnce(success())
  vi.stubGlobal('fetch', fetcher)
  render(<Banner {...p} />)
  fireEvent.click(button('Add a goal'))
  expect(screen.getByRole('dialog', { name: 'Add a goal' })).toBeTruthy()
  expect(screen.getByText('Add a guardrail or something to watch')).toBeTruthy()
  await screen.findByRole('option', { name: 'New outcome' })
  expect(screen.queryByRole('option', { name: 'Main' })).toBeNull()
  expect(screen.queryByRole('option', { name: 'Attached' })).toBeNull()
  expect(within(screen.getByLabelText('Metric')).queryByRole('option', { name: 'Guardrail' })).toBeNull()
  expect(within(screen.getByLabelText('Metric')).queryAllByRole('option').map(option => (option as HTMLOptionElement).value)).not.toContain('3')
  expect(screen.queryByRole('option', { name: 'Primary' })).toBeNull()
  fireEvent.change(screen.getByLabelText('Metric'), { target: { value: '4' } })
  fireEvent.change(screen.getByLabelText('Role'), { target: { value: role } })
  act(() => { dialogButton('Add a goal').click(); dialogButton('Add a goal').click() })
  await waitFor(() => expect(p.test.reload).toHaveBeenCalledTimes(1))
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(fetcher.mock.calls[1]?.[0]).toBe('/custom-api/xp/experiments/xp1/add-metric')
  expect(JSON.parse(fetcher.mock.calls[1]?.[1].body)).toEqual({ metric: 4, role })
})
test.each([['idle', 'Saved'], ['saving', 'Saving…'], ['saved', 'Saved'], ['error', "Couldn't save — see the highlighted field"]] as const)('SaveStatus %s', (saving, sentence) => {
  render(<SaveStatus test={props({}, { saving }).test} />)
  if (sentence) expect(screen.getByText(sentence)).toBeTruthy()
  else expect(screen.queryByRole('status')).toBeNull()
})
test('preflight error has a guarded retry that refreshes only the readiness check', async () => {
  const p = props({}, { preflightError: 'network error' })
  render(<SaveStatus test={p.test} />)
  expect(screen.getByRole('alert').textContent).toBe('network error')
  act(() => { button('Try again').click(); button('Try again').click() })
  await waitFor(() => expect(p.test.refreshPreflight).toHaveBeenCalledTimes(1))
  expect(p.test.reload).not.toHaveBeenCalled()
})
test('retry cannot discard staged changes', () => {
  const p = props({}, { preflightError: 'network error', hasUnsaved: true })
  render(<SaveStatus test={p.test} />)
  expect(button('Try again').disabled).toBe(true)
  expect(button('Try again').closest('[title]')?.getAttribute('title')).toBe('Save your changes first.')
})


test('retained passing preflight never enables Start after a failed readiness refresh', () => {
  render(<Banner {...props({}, { preflight: preflight([{ code: 'no-primary-metric', ok: true }]), preflightError: 'network error' })} />)
  expect(screen.getByRole('status').textContent).toBe("Couldn't check readiness. Try again.")
  expect(button('Start').disabled).toBe(true)
  expect(button('Start').closest('[title]')?.getAttribute('title')).toBe("Couldn't check readiness. Try again.")
  expect(button('Start').closest('.xp-readiness--ready')).toBeNull()
})
test('an open restart confirmation follows a later readiness refusal or refresh failure', () => {
  const p = props({ status: 'stopped' })
  const view = render(<Banner {...p} />)
  fireEvent.click(button('Start a new round'))
  expect(dialogButton('Start a new round').disabled).toBe(false)
  view.rerender(<Banner {...p} test={{ ...p.test, preflightError: 'network error' }} />)
  expect(dialogButton('Start a new round').disabled).toBe(true)
  view.rerender(<Banner {...p} test={{ ...p.test, preflight: preflight([{ code: 'no-primary-metric', ok: false }]) }} />)
  expect(dialogButton('Start a new round').disabled).toBe(true)
})
test('Start stays disabled while the readiness check after a save is still running', () => {
  render(<Banner {...props({}, { preflight: preflight([{ code: 'no-primary-metric', ok: true }]), preflightPending: true })} />)
  expect(screen.getByRole('status').textContent).toBe('Checking readiness…')
  expect(button('Start').disabled).toBe(true)
})


test('unchecked version pages warn while Start stays enabled', () => {
  render(<Banner {...props({}, { preflight: preflight([{ code: 'page-targets-unchecked', ok: true, warning: true }]) })} />)
  expect(screen.getByText("Version pages aren't checked; make sure each one is published.")).toBeTruthy()
  expect(button('Start').disabled).toBe(false)
})

test.each(['draft', 'running', 'decided'] as const)('localized make-content warning remains visible when %s without blocking Start', async status => {
  const p = props({ status }, { preflight: preflight([{ code: 'make-content-unsupported', ok: true, warning: true, detail: 'Landing page' }]) })
  render(<Banner {...p} />)
  expect(screen.getByText("Landing page has more than one language, so Make it the content isn't available for it; you'll copy the winning version by hand.")).toBeTruthy()
  if (status === 'draft') expect((screen.getByRole('button', { name: 'Start' }) as HTMLButtonElement).disabled).toBe(false)
})

test('Escape during a busy transition does not prevent dismissal after its refusal', async () => {
  let resolve!: (value: Response) => void
  vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise<Response>(done => { resolve = done })))
  render(<Banner {...props({ status: 'running' })} />)
  fireEvent.click(button('Stop'))
  fireEvent.click(dialogButton('Stop'))
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  expect(screen.getByRole('dialog')).toBeTruthy()
  await act(async () => { resolve(response({ errors: [{ message: 'Refused.' }] }, 409)) })
  expect(await screen.findByRole('alert')).toBeTruthy()
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
})

test('make-content Dismiss/Undo and Finish use the surface API and existing archive reload', async () => {
  const p = props({ status: 'decided', decision: { winnerArm: 'variantA' } })
  const entry = { collection: 'pages', id: 2, ok: false, error: 'locked' }
  const dismissed = { ...entry, dismissedAt: '2026-11-03T12:00:00Z' }
  let resolveDismiss!: (value: Response) => void
  const fetcher = vi.fn().mockResolvedValueOnce(response({ doc: {}, revision: 2, docs: [entry] }))
    .mockReturnValueOnce(new Promise<Response>(resolve => { resolveDismiss = resolve }))
    .mockResolvedValueOnce(response({ doc: { decision: { contentReport: { docs: [entry] } } } }))
    .mockResolvedValueOnce(response({ doc: { decision: { contentReport: { docs: [dismissed] } } } }))
    .mockResolvedValueOnce(success())
  vi.stubGlobal('fetch', fetcher)
  render(<Banner {...p} />)
  fireEvent.click(button('Make it the content'))
  fireEvent.click(dialogButton('Make it the content'))
  const dismiss = await screen.findByRole('button', { name: 'Dismiss pages/2' })
  act(() => { dismiss.click(); dismiss.click() })
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(dialogButton('Done').disabled).toBe(true)
  resolveDismiss(response({ doc: { decision: { contentReport: { docs: [dismissed] } } } }))
  fireEvent.click(await screen.findByRole('button', { name: 'Undo dismiss pages/2' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Dismiss pages/2' }))
  const finish = await screen.findByRole('button', { name: 'Finish archiving' })
  act(() => { finish.click(); finish.click() })
  await waitFor(() => expect(p.test.reload).toHaveBeenCalledOnce())
  expect(fetcher.mock.calls.map(call => call[0])).toEqual([
    '/custom-api/xp/experiments/xp1/make-content',
    '/custom-api/xp/experiments/xp1/content-report/dismiss',
    '/custom-api/xp/experiments/xp1/content-report/restore',
    '/custom-api/xp/experiments/xp1/content-report/dismiss',
    '/custom-api/xp/experiments/xp1/archive',
  ])
  expect(JSON.parse(fetcher.mock.calls[4]?.[1].body)).toEqual({ mode: 'after-content' })
})

test('surface clears a stale retry error as soon as Dismiss starts', async () => {
  const p = props({ status: 'decided', decision: { winnerArm: 'variantA' } })
  const entry = { collection: 'pages', id: 2, ok: false, error: 'locked' }
  let dismiss!: (value: Response) => void
  const fetcher = vi.fn().mockResolvedValueOnce(response({ doc: {}, revision: 2, docs: [entry] }))
    .mockResolvedValueOnce(response({ errors: [{ code: 'commit-unverified' }] }, 500))
    .mockReturnValueOnce(new Promise<Response>(resolve => { dismiss = resolve }))
  vi.stubGlobal('fetch', fetcher)
  render(<Banner {...p} />)
  fireEvent.click(button('Make it the content'))
  fireEvent.click(dialogButton('Make it the content'))
  fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))
  await screen.findByRole('alert')
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss pages/2' }))
  expect(screen.queryByRole('alert')).toBeNull()
  await act(async () => { dismiss(response({ doc: { decision: { contentReport: { docs: [{ ...entry, dismissedAt: '2026-11-03T12:00:00Z' }] } } } })) })
})

test.each([false, true])('surface uses the returned archived status to hide Finish (after Retry=%s)', async retry => {
  const p = props({ status: 'decided', decision: { winnerArm: 'variantA' } })
  const entry = { collection: 'pages', id: 1, ok: false }
  const fetcher = vi.fn()
  if (retry) fetcher.mockResolvedValueOnce(response({ doc: { status: 'decided' }, docs: [entry] }))
  fetcher.mockResolvedValueOnce(response({ doc: { status: 'archived' }, docs: [{ ...entry, ok: true }] }))
  vi.stubGlobal('fetch', fetcher)
  render(<Banner {...p} />)
  fireEvent.click(button('Make it the content'))
  fireEvent.click(dialogButton('Make it the content'))
  if (retry) fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))
  await screen.findByText('pages/1: Updated')
  expect(screen.queryByRole('button', { name: 'Finish archiving' })).toBeNull()
  expect(dialogButton('Done')).toBeTruthy()
})

test('Add a goal lists all 150 unattached metrics across two pages', async () => {
  const goals = Array.from({ length: 150 }, (_, index) => ({ id: index + 10, name: `Goal ${index}` }))
  const fetch = vi.fn(async (url: string) => {
    const page = Number(new URL(url, 'https://example.test').searchParams.get('page'))
    return response({ docs: goals.slice((page - 1) * 100, page * 100), hasNextPage: page < 2 })
  })
  vi.stubGlobal('fetch', fetch)
  render(<Banner {...props({ status: 'running' })} />)
  fireEvent.click(button('Add a goal'))
  await screen.findByRole('option', { name: 'Goal 149' })
  expect(within(screen.getByLabelText('Metric')).getAllByRole('option')).toHaveLength(151)
  expect(fetch).toHaveBeenCalledTimes(2)
})

test('Banner renders click fairness warnings, unchecked placements and outside-goal notes', () => {
  const checked = preflight([
    { code: 'goal-in-some-versions', ok: true, warning: true, detail: [{ metricId: 4, name: 'Join' }] },
    { code: 'placement-unchecked', ok: true, warning: true, detail: { path: '/landing' } },
  ])
  checked.goalNotes = [{ metricId: 5, message: "This goal isn't inside the part being tested, so every version shows it the same way." }]
  render(<Banner {...props({}, { preflight: checked })} />)
  expect(screen.getByText("Join appears in some versions but not all, so the comparison wouldn't be fair. Add it to every version, or choose another goal.")).toBeTruthy()
  expect(screen.getByText("/landing couldn't be checked, so the test can't confirm every version shows the same goals. Check that you can open it.")).toBeTruthy()
  expect(screen.getByText(checked.goalNotes[0]!.message)).toBeTruthy()
}, 5_000) // Measured 6 ms locally; cap exceeds 3×.

test('add-goal dialog shows all three response warnings until Done with real document reloads', async () => {
  const p = props({ status: 'running' })
  const readDocument = vi.fn(() => response(p.test.doc))
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/xp-experiments/')) return readDocument()
    if (url.endsWith('/preflight')) return response(preflight())
    if (init?.method === 'POST') return response({ doc: {}, revision: 2, warnings: [
      { code: 'goal-in-some-versions', detail: { metricId: 4, name: 'Join' } }, { code: 'goal-added-mid-test', detail: { metricId: 4 } },
      { code: 'placement-unchecked', detail: { collection: 'pages', id: 9, path: '/unreadable' } },
    ] })
    return response({ docs: [{ id: 4, name: 'Join' }] })
  }))
  function Host() {
    const test = useTestDocument('xp1', p.surface)
    return <Banner test={test} surface={p.surface} />
  }
  render(<Host />)
  fireEvent.click(await screen.findByRole('button', { name: 'Add a goal' }))
  await screen.findByRole('option', { name: 'Join' })
  fireEvent.change(screen.getByLabelText('Metric'), { target: { value: '4' } })
  fireEvent.click(dialogButton('Add a goal'))
  expect(await screen.findByText("Clicks before this goal was added aren't counted (the same for every version).")).toBeTruthy()
  expect(within(screen.getByRole('dialog')).getByText("Join appears in some versions but not all, so the comparison wouldn't be fair. Add it to every version, or choose another goal.")).toBeTruthy()
  expect(within(screen.getByRole('dialog')).getByText("/unreadable couldn't be checked, so the test can't confirm every version shows the same goals. Check that you can open it.")).toBeTruthy()
  expect(readDocument).toHaveBeenCalledTimes(1)
  expect(within(screen.getByRole('dialog')).queryByRole('button', { name: 'Add a goal' })).toBeNull()
  fireEvent.click(dialogButton('Done'))
  expect(screen.queryByRole('dialog')).toBeNull()
  await waitFor(() => expect(readDocument).toHaveBeenCalledTimes(2))
}, 5_000) // Measured 105 ms locally with real reloads; cap exceeds 3×.

test('placement warnings name and link page and block placements from preflight without lookups', () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
  const p = props({}, { preflight: { ...preflight([
    { code: 'placement-unchecked', ok: true, warning: true, detail: { collection: 'pages', path: '/landing' } },
    { code: 'placement-unchecked', ok: true, warning: true, detail: { collection: 'posts', id: 9 } },
    { code: 'placement-unchecked', ok: true, warning: true, detail: {} },
  ]), pagePlacements: [{ collection: 'pages', arm: 'control', path: '/landing', title: 'Landing title', id: 1, published: true, editorUrl: '/edit/landing' }], placements: [{ collection: 'posts', id: 9, title: 'Article title', ok: true }] } })
  render(<Banner {...p} />)
  expect(screen.getByRole('link', { name: /Landing title couldn't be checked/ }).getAttribute('href')).toBe('/edit/landing')
  expect(screen.getByRole('link', { name: /Article title couldn't be checked/ }).getAttribute('href')).toBe('/admin/collections/posts/9')
  expect(screen.getByText(/This page couldn't be checked/)).toBeTruthy()
  expect(fetcher).not.toHaveBeenCalled()
})

test('add-goal warnings use preflight titles and document links without a placement lookup', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(response({ docs: [{ id: 4, name: 'New outcome' }] })).mockResolvedValueOnce(response({ doc: {}, revision: 2, warnings: [{ code: 'placement-unchecked', detail: { collection: 'pages', path: '/landing' } }] }))
  vi.stubGlobal('fetch', fetcher)
  const p = props({ status: 'running' }, { preflight: { ...preflight([]), pagePlacements: [{ collection: 'pages', arm: 'control', path: '/landing', title: 'Landing title', id: 1, published: true, editorUrl: '/edit/landing' }] } })
  render(<Banner {...p} />)
  fireEvent.click(button('Add a goal'))
  await screen.findByRole('option', { name: 'New outcome' })
  fireEvent.change(screen.getByLabelText('Metric'), { target: { value: '4' } })
  fireEvent.click(dialogButton('Add a goal'))
  expect((await screen.findByRole('link', { name: /Landing title couldn't be checked/ })).getAttribute('href')).toBe('/edit/landing')
  expect(fetcher).toHaveBeenCalledTimes(2)
})

test('an unknown failing readiness code links Review setup to the first section', () => {
  const p = props({}, { preflight: preflight([{ code: 'future-code', ok: false }] as unknown as ReturnType<typeof preflight>['checks']) })
  render(<Banner {...p} />)
  expect(screen.getByRole('link', { name: 'Next: Review setup' }).getAttribute('href')).toBe('#section-what')
  expect((screen.getByRole('button', { name: 'Start' }) as HTMLButtonElement).disabled).toBe(true)
})
