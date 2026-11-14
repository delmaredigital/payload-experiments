// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { ReadinessBar } from '../../../../src/testSurface/surface/test/ReadinessBar.js'
import { ReadinessContent } from '../../../../src/testSurface/surface/readiness/Banner.js'
import { QuickTestActions } from '../../../../src/puck/editor/QuickTestActions.js'
import { PlacementNotice } from '../../../../src/puck/editor/PlacementNotice.js'
import { StatusChip } from '../../../../src/ui/StatusChip.js'
import { BlockerList } from '../../../../src/testSurface/surface/readiness/BlockerList.js'
import { blockingSteps, pageReadinessContext } from '../../../../src/testSurface/surface/readiness/readiness.model.js'
import { classifyReadinessRead } from '../../../../src/testSurface/readinessRead.js'
import { editorPreflight, sidebarReadinessBlockers, editorPlacementMessage } from '../../../../src/testSurface/surface/editorPlacement.js'
import type { Status } from '../../../../src/types/contracts.js'
import type { PreflightResult } from '../../../../src/types/endpoints.js'
import { ResultsHeader } from '../../../../src/admin/surface/results/ResultsHeader.js'
import { PageWizard } from '../../../../src/admin/surface/newTest/PageWizard.js'
import * as documents from '../../../../src/testSurface/surface/useTestDocument.js'
import { doc, props, preflight } from './fixtures.js'

vi.mock('next/navigation.js', () => ({ useRouter: () => ({ push: vi.fn() }) }))

const refused = 'The previous transition was refused.'
const missing = 'This test no longer exists.'
const missingPage = 'A page used by this test no longer exists. Choose another page.'
const signedOut = 'Your session has expired. Sign in again.'
const denied = "You don't have permission to check where this test is used."
const failed = "Couldn't check readiness. Try again."
const discoveryFailed = "Couldn't check where this test is used. Try again."
const otherPage = "The block you're testing is only on a draft of Checkout. Publish the page before you start."
const page = { collection: 'pages', id: 'here' }
const statuses: Status[] = ['draft', 'running', 'stopped', 'decided', 'archived']
const pages = ['unsaved', 'saved draft', 'published', 'another page only'] as const
const surfaces = ['chrome', 'sidebar', 'drawer', 'admin'] as const
const histories = ['none', 'blocker', 'ready', 'failed', 'blocker then answer', 'ready then answer', 'failed then answer'] as const
const outcomes = [
  { name: 'answered', status: 200, message: undefined, retry: false, detail: undefined },
  { name: 'placements-failed', status: 200, message: discoveryFailed, retry: true, detail: 'placements-failed' },
  { name: '404', status: 404, message: missing, retry: false, detail: undefined },
  { name: 'not-found detail', status: 200, message: missingPage, retry: false, detail: 'not-found' },
  { name: '401', status: 401, message: signedOut, retry: false, detail: undefined },
  { name: '403', status: 403, message: denied, retry: false, detail: undefined },
  { name: 'forbidden detail', status: 200, message: denied, retry: false, detail: 'forbidden' },
  { name: 'network', status: 0, message: failed, retry: true, detail: undefined },
  { name: 'timeout', status: 0, message: failed, retry: true, detail: undefined },
  { name: '400', status: 400, message: "This request couldn't be checked. Reload the page.", retry: false, detail: undefined },
  { name: '501', status: 501, message: "This isn't available yet.", retry: false, detail: undefined },
  { name: '409', status: 409, message: failed, retry: true, detail: undefined },
  { name: '429', status: 429, message: failed, retry: true, detail: undefined },
  { name: '503', status: 503, message: failed, retry: true, detail: undefined },
  { name: 'unusable 200', status: 200, message: failed, retry: true, detail: undefined },
] as const

const flagOutcomes = [
  { name: 'flag placements-failed', status: 200, message: discoveryFailed, retry: true, detail: 'placements-failed' },
  { name: 'flag forbidden', status: 200, message: denied, retry: false, detail: 'forbidden' },
  { name: 'flag not-found', status: 200, message: missingPage, retry: false, detail: 'not-found' },
] as const

type Row = { surface: typeof surfaces[number]; status: Status; pageState: typeof pages[number]; outcome: typeof outcomes[number]; pending: boolean; history: typeof histories[number] }
const rows: Row[] = []
let omitted = 0
for (const surface of surfaces) for (const status of statuses) for (const pageState of pages) for (const outcome of outcomes) for (const pending of [false, true]) for (const history of histories) {
  // Chrome has no transition runner; sidebar offers draft Start and running Stop.
  // Archived tests have no transition; decided transitions live in drawer/admin.
  // Redundant rows are omitted to bound the product: a blocker is an
  // answered check; ready requires a published page; failed has no usable answer.
  // "then answer" means any later settled read, including 401/403/404/5xx.
  // Other omissions cover surfaces with no action and equivalent page states.
  const usable = outcome.status === 200 && outcome.name !== 'unusable 200'
  const redundantOrUnavailable = history !== 'none' && (surface === 'chrome' || status === 'archived' || surface === 'sidebar' && !['draft', 'running'].includes(status))
    || history === 'blocker' && (!usable || outcome.name === 'answered' && pageState === 'published')
    || history === 'ready' && pageState !== 'published'
    || history === 'failed' && usable

  if (redundantOrUnavailable) omitted++
  else rows.push({ surface, status, pageState, outcome, pending, history })
}

const producerReleases: Array<() => void> = []
afterEach(() => { cleanup(); producerReleases.splice(0).forEach(release => release()); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function answerFor(pageState: Row['pageState']): PreflightResult {
  const here = { ...page, title: 'Landing', ok: true, detail: pageState === 'published' ? 'Published' : 'Draft' }
  const checkout = { collection: 'pages', id: 'other', title: 'Checkout', ok: true, detail: 'Draft' }
  const placements = pageState === 'unsaved' ? [] : pageState === 'another page only' ? [checkout] : [here]
  return { ...preflight(pageState === 'published' ? [] : pageState === 'unsaved' ? [{ code: 'no-placements', ok: false }]
    : [{ code: 'placement-unpublished', ok: false, detail: placements }]), placements }
}

// Each row drives the actual shared chrome/sidebar notice, sidebar action, and
// drawer/admin readiness renderer. Puck portal wiring is covered by sidebar and
// placementNotice integration tests; it adds no readiness policy here.
test.each(rows)('$surface / $status / $outcome.name / $pageState / pending=$pending / $history', async row => {
  const p = props({ status: row.status })
  p.surface.editorPage = page
  let release!: () => void
  p.test.refreshPreflight = vi.fn(() => new Promise<void>(resolve => { release = resolve }))
  let responseStatus = 200
  let responseBody: unknown = answerFor('published')
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/preflight') ? Response.json(responseBody, { status: responseStatus }) : Response.json({ errors: [{ code: 'future-refusal', message: refused }] }, { status: 422 })))
  const releaseProducer = acquirePlacements('/matrix', doc.id, () => {})
  producerReleases.push(releaseProducer)
  await act(async () => {})
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  async function apply(status: number, body: unknown, pending = false) {
    // checkStart reports invalid-status outside setup; it has no blocker sentence.
    if (!['draft', 'stopped'].includes(row.status) && body && typeof body === 'object' && 'checks' in body) {
      const answer = body as PreflightResult
      body = { ...answer, checks: [...answer.checks, { code: 'invalid-status', ok: false }] }
    }
    responseStatus = status || 503
    responseBody = body ?? {}
    await act(async () => { await refreshPlacements('/matrix', doc.id) })
    const read = cachedReadinessRead('/matrix', doc.id)!
    const local = read.answer && !read.message ? editorPlacementMessage(read.answer.placements, page, row.status) : undefined
    const setup = row.status === 'draft' || row.status === 'stopped'
    p.surface.editorPlacementMessage = row.surface === 'admin' ? undefined : local
    p.test.preflightRead = read
    p.test.preflight = setup && row.surface === 'drawer' ? editorPreflight(read.answer ?? null, p.surface) : read.answer ?? null
    p.test.preflightError = read.answer ? null : read.message ?? null
    p.test.preflightPending = pending
  }
  function content() {
    if (row.surface === 'drawer' || row.surface === 'admin') return <ReadinessBar {...p} onHeightChange={() => {}} />
    const blockers = sidebarReadinessBlockers(p.test, p.surface)
    return <><StatusChip status={row.status} /><PlacementNotice read={p.test.preflightRead} message={p.surface.editorPlacementMessage} running={row.status === 'running'} onRetry={() => {}} />
      {row.surface === 'sidebar' ? <><BlockerList steps={['draft', 'stopped'].includes(row.status) ? blockers : []} /><QuickTestActions {...p} /></> : null}</>
  }
  await apply(200, answerFor('published'))
  const view = render(content())
  const scope = () => within(view.container)
  if (row.history !== 'none') {
    const label = row.status === 'stopped' ? 'Start a new round' : row.status === 'running' ? 'Stop' : row.status === 'decided' ? 'Make it the content' : 'Start'
    fireEvent.click(scope().getByRole('button', { name: label }))
    if (row.status !== 'draft') fireEvent.click(scope().getAllByRole('button', { name: label })[1]!)
    await act(async () => {})
    expect(scope().getByText(refused).getAttribute('role')).toBe('alert')
    const first = row.history.split(' ')[0]
    if (first === 'failed') await apply(503, undefined)
    else await apply(200, first === 'blocker' ? preflight([{ code: 'no-primary-metric', ok: false }]) : answerFor('published'))
    view.rerender(content())
    await act(async () => { release() })
    expect(scope().queryByText(refused) !== null).toBe(!['draft', 'stopped'].includes(row.status) || first !== 'blocker')
  }
  const body = row.outcome.name === 'unusable 200' ? {} : row.outcome.detail
    ? preflight([{ code: 'no-placements', ok: false, detail: row.outcome.detail }]) : answerFor(row.pageState)
  // Immediate states are the post-refusal read itself; later-answer histories
  // deliberately publish a new answer identity after the post-refusal read.
  if (row.history === 'ready' || row.history === 'failed' || row.history === 'blocker') {
    // The first read above establishes lifetime. For ready/failed this next
    // failed read is not an answer; for blocker dismissal is already permanent.
    if (row.history !== 'ready' || row.outcome.name !== 'answered') await apply(row.outcome.status, body, row.pending)
  } else await apply(row.outcome.status, body, row.pending)
  view.rerender(content())
  await act(async () => {})
  p.test.preflightPending = row.pending
  view.rerender(content())
  const text = view.container.textContent!
  const setup = row.status === 'draft' || row.status === 'stopped'
  const local = row.pageState === 'published' || row.outcome.name !== 'answered' || row.surface === 'admin' || !setup && row.status !== 'running' ? undefined
    : row.status === 'running' ? row.pageState === 'saved draft' ? "This test is running, but visitors won't see it here until this page is published." : "This test is running, but visitors won't see it here until this page is saved and published."
      : row.pageState === 'saved draft' ? 'Publish this page to start the test.' : 'Save this page to put the test on it.'
  if (row.outcome.message) expect(text).toContain(row.outcome.message)
  else if (setup && row.surface !== 'chrome') {
    const expected = row.pageState === 'published' ? row.surface === 'sidebar' && row.status === 'stopped' ? 'Stopped' : 'Ready to start.' : row.surface === 'admin'
      ? row.pageState === 'unsaved' ? 'Not on a page yet. Open a page, add an Experiment block and choose this test.' : row.pageState === 'another page only' ? otherPage : "The block you're testing is only on a draft of Landing. Publish the page before you start."
      : local!
    expect(text).toContain(expected)
  } else if (local && (row.surface === 'sidebar' || row.surface === 'chrome')) expect(text).toContain(local)
  if (row.surface === 'chrome' || row.surface === 'sidebar') expect(text).toContain({ draft: 'Draft', running: 'Running', stopped: 'Stopped', decided: 'Decided', archived: 'Archived' }[row.status])
  else if (!setup) expect(text).toContain({ running: 'Running', decided: 'Decided: Original.', archived: 'Archived.' }[row.status as 'running' | 'decided' | 'archived'])
  const retry = scope().queryByRole('button', { name: /^(Retry|Try again)$/ })
  expect(retry !== null).toBe(row.outcome.retry)
  const start = scope().queryAllByRole('button', { name: row.status === 'stopped' ? 'Start a new round' : 'Start' }).at(-1) as HTMLButtonElement | undefined
  const ready = row.outcome.name === 'answered' && row.pageState === 'published'
  const offered = row.surface === 'chrome' ? false : row.surface === 'sidebar' ? row.status === 'draft' && ready : setup
  expect(!!start).toBe(offered)
  if (start) expect(start.disabled).toBe(!ready || row.pending)
  const alertExpected = row.history === 'ready' && row.outcome.name === 'answered' || row.history !== 'none' && (!setup || row.history !== 'blocker' && row.history !== 'blocker then answer' && !(row.outcome.status === 200 && row.outcome.name !== 'unusable 200'))
  expect(scope().queryByText(refused) !== null).toBe(alertExpected)
  // The producer supplies the delay. A surface subscribes only while a notice
  // is displayed; actual timer/subscription behaviour is exercised below.
  const expectedDelay = row.outcome.retry ? row.history.startsWith('failed') ? 8_000 : 4_000 : row.outcome.name === 'answered' ? 4_000 : null
  expect(p.test.preflightRead?.pollDelay).toBe(expectedDelay)
  releaseProducer()
})

test('matrix accounts for available and explicitly redundant combinations', () => {
  expect(rows.length + omitted).toBe(4 * 5 * outcomes.length * 4 * 2 * 7)
  expect(rows.length).toBe(7_480)
  expect(omitted).toBe(9_320)
})

// Observe the real shared timer too: the presentation product above must not
// substitute calculated delays for scheduled requests.
import { acquirePlacements, refreshPlacements, cachedReadinessRead, watchPlacementNotice } from '../../../../src/puck/editor/placementsCache.js'

test.each([...outcomes, ...flagOutcomes])('actual visible polling / $name / 4,8,16,30 seconds and hidden stop', async outcome => {
  vi.useFakeTimers()
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  const body = outcome.name === 'unusable 200' ? {} : outcome.detail
    ? preflight([{ code: outcome.name.startsWith('flag ') ? 'flag-placement-missing' : 'no-placements', ok: false, detail: outcome.detail }]) : answerFor('saved draft')
  const fetcher = vi.fn(async () => {
    if (outcome.name === 'network' || outcome.name === 'timeout') throw new DOMException('Aborted', 'AbortError')
    return Response.json(body, { status: outcome.status })
  })
  vi.stubGlobal('fetch', fetcher)
  const id = `schedule-${outcome.name}`
  const release = acquirePlacements('/api', id, () => {})
  await act(async () => {})
  expect(cachedReadinessRead('/api', id)?.message).toBe(outcome.message)
  const stop = watchPlacementNotice('/api', id, document)
  let count = fetcher.mock.calls.length
  if (outcome.retry || outcome.name === 'answered') for (const delay of outcome.retry ? [4_000, 8_000, 16_000, 30_000, 30_000] : [4_000, 4_000]) {
    await act(async () => { await vi.advanceTimersByTimeAsync(delay - 1) })
    expect(fetcher).toHaveBeenCalledTimes(count)
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(fetcher).toHaveBeenCalledTimes(++count)
  }
  else {
    await act(async () => { await vi.advanceTimersByTimeAsync(90_000) })
    expect(fetcher).toHaveBeenCalledTimes(count)
  }
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  document.dispatchEvent(new Event('visibilitychange'))
  await act(async () => { await vi.advanceTimersByTimeAsync(90_000) })
  expect(fetcher).toHaveBeenCalledTimes(count)
  stop(); release()
  expect(vi.getTimerCount()).toBe(0)
  vi.useRealTimers()
})

test.each(['sidebar', 'drawer', 'admin'] as const)('unpublished refusal → explained blocker → publish → ready never revives an alert (%s)', async surface => {
  const p = props()
  let finish!: () => void
  p.test.refreshPreflight = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
  const sentence = "The block you're testing is only on a draft of Landing. Publish the page before you start."
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ errors: [{ code: 'placement-unpublished', detail: [{ title: 'Landing' }] }] }, { status: 422 })))
  const content = () => surface === 'sidebar' ? <><BlockerList steps={blockingSteps(p.test.preflight, p.test.doc!)} /><QuickTestActions {...p} /></> : <ReadinessContent {...p} />
  const view = render(content())
  fireEvent.click(within(view.container).getByRole('button', { name: 'Start' }))
  await act(async () => {})
  expect(within(view.container).getByRole('alert').textContent).toBe(sentence)
  p.test.preflight = preflight([{ code: 'placement-unpublished', ok: false, detail: [{ title: 'Landing' }] }])
  view.rerender(content())
  await act(async () => { finish() })
  expect(within(view.container).queryByRole('alert')).toBeNull()
  expect(view.container.textContent).toContain(sentence)
  p.test.preflight = preflight() // A new answer after publishing.
  view.rerender(content())
  expect(within(view.container).queryByRole('alert')).toBeNull()
  expect(view.container.textContent).toContain('Ready to start.')
  expect((within(view.container).getByRole('button', { name: 'Start' }) as HTMLButtonElement).disabled).toBe(false)
})

test('two draft pages keep Checkout named under this page’s publishing notice; lists cap at three', () => {
  const p = props()
  p.surface.editorPlacementMessage = 'Publish this page to start the test.'
  const placements = [{ ...page, title: 'Landing' }, { collection: 'pages', id: 'other', title: 'Checkout' }]
  const answer = preflight([{ code: 'placement-unpublished', ok: false, detail: placements }])
  p.surface.editorPage = page
  const steps = sidebarReadinessBlockers({ ...p.test, preflight: answer }, p.surface)
  const view = render(<><PlacementNotice message={p.surface.editorPlacementMessage} running={false} onRetry={() => {}} /><BlockerList steps={steps} /></>)
  expect(view.container.textContent).toContain('Publish this page to start the test.')
  expect(view.container.textContent).toContain(otherPage)
  view.rerender(<BlockerList steps={[...steps, { sentence: 'Choose a goal.' }, { sentence: 'Choose how long to run it.' }, { sentence: 'Enter how many people reach this per day.' }, { sentence: 'Choose the setting to test.' }]} />)
  expect(within(view.container).getAllByRole('listitem').map(item => item.textContent)).toEqual([`⊗ ${otherPage}`, '⊗ Choose a goal.', '⊗ Choose how long to run it.', 'and 2 more'])
})

// Flag tests have no Puck placement/sidebar/drawer: only admin applies. A page
// state is inapplicable, so it is explicitly absent from this supplemental axis.
test.each(statuses.flatMap(status => flagOutcomes.flatMap(outcome => [false, true].map(pending => ({ status, outcome, pending })))))('admin flag / $status / $outcome.name / pending=$pending', ({ status, outcome, pending }) => {
  const p = props({ status, kind: 'flag', flagPoint: 'headline' })
  const answer = preflight([{ code: 'flag-placement-missing', ok: false, detail: outcome.detail }])
  p.test.preflight = answer
  p.test.preflightRead = classifyReadinessRead(200, answer)
  p.test.preflightPending = pending
  const view = render(<ReadinessContent {...p} />)
  const scope = within(view.container)
  expect(view.container.textContent).toContain(outcome.message)
  expect(!!scope.queryByRole('button', { name: 'Try again' })).toBe(outcome.retry)
  const start = scope.queryByRole('button', { name: status === 'stopped' ? 'Start a new round' : 'Start' }) as HTMLButtonElement | null
  expect(!!start).toBe(status === 'draft' || status === 'stopped')
  if (start) expect(start.disabled).toBe(true)
  expect(scope.queryByText(refused)).toBeNull()
  expect(p.test.preflightRead.pollDelay).toBe(outcome.retry ? 4_000 : null)
})

test('a later answer beneath a new pending read clears a refusal permanently, even if the new read fails', async () => {
  const p = props()
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ errors: [{ code: 'future-refusal', message: refused }] }, { status: 422 })))
  const view = render(<ReadinessContent {...p} />)
  fireEvent.click(within(view.container).getByRole('button', { name: 'Start' }))
  await act(async () => {}) // The immediate reread is ready, so the alert stays.
  expect(within(view.container).getByText(refused)).toBeTruthy()
  p.test.preflight = preflight()
  p.test.preflightRead = classifyReadinessRead(200, p.test.preflight)
  p.test.preflightPending = true // Answer B arrived; request C already began.
  view.rerender(<ReadinessContent {...p} />)
  expect(within(view.container).queryByText(refused)).toBeNull()
  p.test.preflight = null
  p.test.preflightRead = classifyReadinessRead(503)
  p.test.preflightError = failed
  p.test.preflightPending = false
  view.rerender(<ReadinessContent {...p} />)
  expect(within(view.container).queryByText(refused)).toBeNull()
  expect(view.container.textContent).toContain(failed)
})

import { useTestDocument } from '../../../../src/testSurface/surface/useTestDocument.js'
test.each([400, 401, 403, 404, 409, 429, 501, 503, 'network', 'unusable'] as const)('initial admin test read / %s / actual retry schedule and recovery', async outcome => {
  vi.useFakeTimers()
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  let failing = true
  const fetcher = vi.fn(async (url: string) => {
    if (url.endsWith('/preflight')) return Response.json(preflight())
    if (!failing) return Response.json(doc)
    if (outcome === 'network') throw new Error('offline')
    return Response.json({}, { status: typeof outcome === 'number' ? outcome : 200 })
  })
  vi.stubGlobal('fetch', fetcher)
  const hook = renderHook(() => useTestDocument(doc.id, { apiRoute: '/api' }))
  await act(async () => {})
  const retry = outcome === 409 || outcome === 429 || outcome === 503 || typeof outcome === 'string'
  expect(hook.result.current.preflightRead?.message).toBe(outcome === 400 ? "This request couldn't be checked. Reload the page." : outcome === 501 ? "This isn't available yet." : outcome === 401 ? signedOut : outcome === 403 ? "You don't have access to this test." : outcome === 404 ? missing : "Couldn't load this test.")
  expect(hook.result.current.preflightRead?.retry).toBe(retry)
  let count = fetcher.mock.calls.length
  if (retry) {
    for (const delay of [4_000, 8_000, 16_000, 30_000]) {
      await act(async () => { await vi.advanceTimersByTimeAsync(delay - 1) })
      expect(fetcher).toHaveBeenCalledTimes(count)
      await act(async () => { await vi.advanceTimersByTimeAsync(1) })
      expect(fetcher).toHaveBeenCalledTimes(++count)
    }
    failing = false
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(hook.result.current.loadState).toBe('ready')
    expect(hook.result.current.preflightError).toBeNull()
    count = fetcher.mock.calls.length
  }
  await act(async () => { await vi.advanceTimersByTimeAsync(90_000) })
  expect(fetcher).toHaveBeenCalledTimes(count)
  hook.unmount()
  expect(vi.getTimerCount()).toBe(0)
})

test('an answer before a refusal cannot dismiss its alert when the mandatory reread fails', async () => {
  const p = props()
  let refuse!: (response: Response) => void
  let reread!: () => void
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { refuse = resolve })))
  p.test.refreshPreflight = vi.fn(() => new Promise<void>(resolve => { reread = resolve }))
  const view = render(<ReadinessContent {...p} />)
  fireEvent.click(within(view.container).getByRole('button', { name: 'Start' }))
  p.test.preflight = preflight([{ code: 'no-primary-metric', ok: false }]) // Answer B, before refusal.
  view.rerender(<ReadinessContent {...p} />)
  await act(async () => { refuse(Response.json({ errors: [{ code: 'future-refusal', message: refused }] }, { status: 422 })) })
  expect(within(view.container).getByText(refused)).toBeTruthy()
  p.test.preflight = null
  p.test.preflightRead = classifyReadinessRead(503)
  p.test.preflightError = failed
  view.rerender(<ReadinessContent {...p} />)
  await act(async () => { reread() })
  expect(within(view.container).getByText(refused)).toBeTruthy()
  expect(view.container.textContent).toContain(failed)
})

// Results can also Start a draft or stopped test. This supplemental surface has
// no local block/page state; the full editor product is covered above.
test.each(statuses.flatMap(status => outcomes.flatMap(outcome => [false, true].map(pending => ({ status, outcome, pending })))))('admin results / $status / $outcome.name / pending=$pending', ({ status, outcome, pending }) => {
  const p = props({ status })
  const body = outcome.name === 'unusable 200' ? {} : outcome.detail ? preflight([{ code: 'no-placements', ok: false, detail: outcome.detail }]) : preflight()
  const read = classifyReadinessRead(outcome.status, body)
  p.test.preflightRead = read
  p.test.preflight = read.answer ?? null
  p.test.preflightError = read.answer ? null : read.message ?? null
  p.test.preflightPending = pending
  const view = render(<ResultsHeader {...p} actions={null} released={null}>Results</ResultsHeader>)
  const scope = within(view.container)
  expect(view.container.textContent).toContain({ draft: 'Draft', running: 'Running', stopped: 'Stopped', decided: 'Decided', archived: 'Archived' }[status])
  if (outcome.message) expect(view.container.textContent).toContain(outcome.message)
  expect(!!scope.queryByRole('button', { name: 'Try again' })).toBe(outcome.retry)
  const start = scope.queryByRole('button', { name: status === 'stopped' ? 'Start a new round' : 'Start' }) as HTMLButtonElement | null
  expect(!!start).toBe(status === 'draft' || status === 'stopped')
  if (start) expect(start.disabled).toBe(outcome.name !== 'answered' || pending)
  expect(scope.queryByText(refused)).toBeNull()
  expect(read.pollDelay).toBe(outcome.retry ? 4_000 : null)
})

// The creation wizard is draft-only and whole-page-only: block placements and
// flag-placement details cannot occur there. Its five read classes still apply.
const wizardOutcomes = outcomes.filter(outcome => outcome.detail === undefined)
test.each(wizardOutcomes.flatMap(outcome => [false, true].map(pending => ({ outcome, pending }))))('admin wizard review / $outcome.name / pending=$pending', async ({ outcome, pending }) => {
  const p = props({ kind: 'page' })
  const read = classifyReadinessRead(outcome.status, outcome.name === 'unusable 200' ? {} : preflight())
  p.test.preflightRead = read
  p.test.preflight = read.answer ?? null
  p.test.preflightError = read.answer ? null : read.message ?? null
  p.test.preflightPending = pending
  vi.spyOn(documents, 'useTestDocument').mockReturnValue(p.test)
  const view = render(<PageWizard id={doc.id} surface={p.surface} />)
  const scope = within(view.container)
  fireEvent.click(scope.getByRole('button', { name: 'Next' }))
  fireEvent.click(scope.getByRole('button', { name: 'Next' }))
  await act(async () => {})
  if (outcome.message) expect(view.container.textContent).toContain(outcome.message)
  else expect(view.container.textContent).toContain('Ready to start.')
  expect(!!scope.queryByRole('button', { name: 'Try again' })).toBe(outcome.retry)
  const start = scope.queryByRole('button', { name: 'Start' }) as HTMLButtonElement | null
  expect(!!start).toBe(outcome.name === 'answered')
  if (start) expect(start.disabled).toBe(pending)
  expect(scope.queryByText(refused)).toBeNull()
  expect(read.pollDelay).toBe(outcome.retry ? 4_000 : null)
})

test.each(wizardOutcomes.filter(outcome => outcome.name !== 'answered'))('admin wizard initial / $name', outcome => {
  const p = props({ kind: 'page' })
  p.test.preflightRead = classifyReadinessRead(outcome.status, undefined, 1, { kind: 'document' })
  p.test.loadState = p.test.preflightRead.loadState
  p.test.doc = null
  vi.spyOn(documents, 'useTestDocument').mockReturnValue(p.test)
  const view = render(<PageWizard id={doc.id} surface={p.surface} />)
  expect(view.container.textContent).toContain(p.test.preflightRead.message!)
  expect(!!within(view.container).queryByRole('button', { name: 'Try again' })).toBe(outcome.retry)
  expect(within(view.container).queryByRole('button', { name: 'Start' })).toBeNull()
})

// These are fetch-to-render tests of the four real producers, rather than a
// second copy of their classification or placement transformations.
import { TestSurface } from '../../../../src/testSurface/surface/test/TestSurface.js'
import { readEditorPreflight } from '../../../../src/puck/editor/placementsCache.js'
import { Puck, type Config } from '@puckeditor/core'
import { ExperimentSlotEditor } from '../../../../src/puck/editor/ExperimentSlotEditor.js'
import { useTransition } from '../../../../src/testSurface/surface/readiness/useTransition.js'
import type { TestDocApi } from '../../../../src/testSurface/surface/contracts.js'

vi.hoisted(() => { vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }) })
const producers = ['placementsCache', 'useTestDocument', 'TestSurface sharedDocument', 'EditorRender quickTest'] as const
const producerRows = producers.flatMap(producer => outcomes.map(outcome => ({ producer, outcome })))
test.each(producerRows)('fetch producer / $producer / $outcome.name', async ({ producer, outcome }) => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('matchMedia', (media: string) => ({ matches: false, media, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} })
  history.replaceState({}, '', '/admin/puck/pages/here')
  const id = `producer-${producer}-${outcome.name}`
  const p = props({ id })
  p.surface.apiRoute = '/producer'
  p.surface.editorPage = page
  let delivering = producer !== 'TestSurface sharedDocument'
  const body = outcome.name === 'unusable 200' ? {} : outcome.detail
    ? preflight([{ code: 'no-placements', ok: false, detail: outcome.detail }]) : answerFor('published')
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/editor-surface')) return Response.json(p.surface)
    if (url.includes('xp-experiments?')) return Response.json({ docs: [p.test.doc] })
    if (url.endsWith('/preflight')) {
      if (!delivering) return Response.json(answerFor('published'))
      if (outcome.name === 'network' || outcome.name === 'timeout') throw new DOMException('Aborted', 'AbortError')
      return Response.json(body, { status: outcome.status })
    }
    return Response.json(p.test.doc)
  }))
  let release: (() => void) | undefined
  let view: ReturnType<typeof render> | undefined
  let observed: TestDocApi | undefined
  if (producer === 'placementsCache') {
    release = acquirePlacements('/producer', id, () => {})
    await act(async () => {})
    const read = cachedReadinessRead('/producer', id)!
    view = render(<PlacementNotice read={read} running={false} onRetry={() => {}} />)
    expect(read.message).toBe(outcome.message)
  } else if (producer === 'useTestDocument') {
    const hook = renderHook(() => useTestDocument(id, { apiRoute: '/producer' }))
    await act(async () => {})
    observed = hook.result.current
    expect(observed.preflightRead?.message).toBe(outcome.message)
    view = render(<ReadinessContent test={{ ...observed, doc: observed.doc ?? p.test.doc }} surface={p.surface} />)
  } else if (producer === 'TestSurface sharedDocument') {
    release = acquirePlacements('/producer', id, () => {})
    await act(async () => {})
    view = render(<TestSurface id={id} embedded surface={p.surface}
      requestPreflight={signal => readEditorPreflight('/producer', id, signal)}
      renderFrame={({ test }) => { observed = test; return <ReadinessContent test={test.doc ? test : p.test} surface={p.surface} /> }} />)
    await act(async () => {})
    delivering = true
    await act(async () => { await refreshPlacements('/producer', id) })
    expect(observed?.preflightRead?.message).toBe(outcome.message)
  } else {
    const config: Config = { components: { ExperimentSlot: ExperimentSlotEditor } }
    view = render(<Puck config={config} data={{ root: { props: {} }, content: [{ type: 'ExperimentSlot', props: {
      id: 'producer-block', experiment: { id, slug: 'headline' }, control: [], variantA: [], variantB: [], variantC: [],
    } }] }} iframe={{ enabled: false }} ui={{ itemSelector: { index: 0, zone: 'root:default-zone' } }}>
      <Puck.Preview /><div data-testid="producer-sidebar"><Puck.Fields /></div>
    </Puck>)
    await act(async () => {})
    const sidebar = within(view.getByTestId('producer-sidebar'))
    if (outcome.message) expect(sidebar.getAllByText(outcome.message, { exact: false }).length).toBeGreaterThan(0)
    expect(!!sidebar.queryByRole('button', { name: 'Retry' })).toBe(outcome.retry)
    if (outcome.message) expect(view.container.querySelector('.xp-slot-chrome')?.textContent).toContain(outcome.message)
  }
  if (producer !== 'EditorRender quickTest') {
    if (outcome.message) expect(view!.container.textContent).toContain(outcome.message)
    expect(!!within(view!.container).queryByRole('button', { name: /^(Retry|Try again)$/ })).toBe(outcome.retry)
  }
  view!.unmount(); release?.()
  history.replaceState({}, '', '/')
})

// Transition kind is an independent axis: every non-Start action keeps its
// reason through blocker, ready, terminal and failed answers, pending or settled.
const transitionKinds = ['start', 'restart', 'stop', 'decide', 'make-content', 'allocate', 'archive', 'release-holdout', 'add-metric', 'after-content', 'discard', 'hard-coded'] as const
const transitionRows = transitionKinds.flatMap(kind => outcomes.flatMap(outcome => [false, true].map(pending => ({ kind, outcome, pending }))))
test.each(transitionRows)('refusal lifetime / $kind / later $outcome.name / pending=$pending', async ({ kind, outcome, pending }) => {
  const setup = kind === 'start' || kind === 'restart'
  const p = props({ status: setup ? kind === 'restart' ? 'stopped' : 'draft' : 'running' })
  const hook = renderHook(() => useTransition(p.test))
  await act(async () => { await hook.result.current.run(kind, async () => ({ ok: false, status: 422, message: refused, retryable: false })) })
  expect(hook.result.current.error).toBe(refused)
  p.test.preflight = preflight([{ code: 'no-primary-metric', ok: false }])
  hook.rerender()
  expect(hook.result.current.error).toBe(setup ? null : refused)
  p.test.preflight = preflight()
  hook.rerender()
  expect(hook.result.current.error).toBe(setup ? null : refused)
  const status = outcome.status
  const body = outcome.name === 'unusable 200' ? {} : outcome.detail ? preflight([{ code: 'no-placements', ok: false, detail: outcome.detail }]) : preflight()
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(body, { status: status || 503 })))
  const release = acquirePlacements('/lifetime', kind, () => {})
  await act(async () => {})
  const read = cachedReadinessRead('/lifetime', kind)!
  p.test.preflightRead = read; p.test.preflight = read.answer ?? null; p.test.preflightError = read.answer ? null : read.message ?? null
  p.test.preflightPending = pending
  hook.rerender()
  expect(hook.result.current.error).toBe(setup ? null : refused)
  p.test.doc = { ...p.test.doc!, status: 'archived' }
  hook.rerender()
  expect(hook.result.current.error).toBeNull()
  release()
})

test('mounted sidebar keeps an other-page blocker under this page’s notice', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('matchMedia', (media: string) => ({ matches: false, media, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} })
  history.replaceState({}, '', '/admin/puck/pages/here')
  const p = props({ id: 'two-drafts' })
  const placements = [{ ...page, title: 'Landing', detail: 'Draft' }, { collection: 'pages', id: 'other', title: 'Checkout', detail: 'Draft' }]
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.endsWith('/editor-surface') ? p.surface
    : url.endsWith('/preflight') ? { ...preflight([{ code: 'placement-unpublished', ok: false, detail: placements }]), placements }
      : url.includes('xp-experiments?') ? { docs: [p.test.doc] } : p.test.doc)))
  const config: Config = { components: { ExperimentSlot: ExperimentSlotEditor } }
  const view = render(<Puck config={config} data={{ root: { props: {} }, content: [{ type: 'ExperimentSlot', props: {
    id: 'two-drafts-block', experiment: { id: 'two-drafts', slug: 'headline' }, control: [], variantA: [], variantB: [], variantC: [],
  } }] }} iframe={{ enabled: false }} ui={{ itemSelector: { index: 0, zone: 'root:default-zone' } }}>
    <Puck.Preview /><div data-testid="two-drafts-sidebar"><Puck.Fields /></div>
  </Puck>)
  await act(async () => {})
  const sidebar = within(view.getByTestId('two-drafts-sidebar'))
  expect(sidebar.getByText('Publish this page to start the test.')).toBeTruthy()
  expect(sidebar.getByText(otherPage, { exact: false })).toBeTruthy()
  expect(sidebar.queryByRole('button', { name: 'Start' })).toBeNull()
  history.replaceState({}, '', '/')
})

test('this page absent with another published page still polls its save notice', async () => {
  vi.useFakeTimers()
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...preflight(), placements: [{ collection: 'pages', id: 'elsewhere', detail: 'Published' }] })))
  const release = acquirePlacements('/notice', 'elsewhere-only', () => {})
  await act(async () => {})
  const read = cachedReadinessRead('/notice', 'elsewhere-only')!
  expect(editorPlacementMessage(read.answer?.placements, page, 'draft')).toBe('Save this page to put the test on it.')
  const stop = watchPlacementNotice('/notice', 'elsewhere-only', document)
  await act(async () => { await vi.advanceTimersByTimeAsync(4_000) })
  expect(fetch).toHaveBeenCalledTimes(2)
  stop(); release()
})

import { DecideDialog } from '../../../../src/testSurface/actions/DecideDialog.js'
import T7 from '../../../_fixtures/snapshots/T7.json'
test.each(outcomes)('mounted Decide refusal survives readiness / $name', async outcome => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/results') ? Response.json({ phases: [], snapshot: T7 })
    : Response.json({ errors: [{ code: 'future-refusal', message: refused }] }, { status: 422 })))
  const p = props({ status: 'running' })
  const close = vi.fn()
  const content = () => <DecideDialog id={doc.id} arms={p.test.doc!.arms} checks={p.test.preflight?.checks} apiRoute="/api" onClose={close} />
  const view = render(content())
  await act(async () => {})
  fireEvent.click(within(view.container).getByRole('button', { name: 'Decide' }))
  await act(async () => {})
  expect(within(view.container).getByRole('alert').textContent).toBe(refused)
  p.test.preflight = preflight([{ code: 'no-primary-metric', ok: false }])
  view.rerender(content())
  expect(within(view.container).getByRole('alert').textContent).toBe(refused)
  p.test.preflight = preflight()
  view.rerender(content())
  expect(within(view.container).getByRole('alert').textContent).toBe(refused)
  // Deliver the later read through the same producer used by the results shell.
  const body = outcome.name === 'unusable 200' ? {} : outcome.detail ? preflight([{ code: 'no-placements', ok: false, detail: outcome.detail }]) : preflight()
  vi.mocked(fetch).mockImplementation(async () => Response.json(body, { status: outcome.status || 503 }))
  const release = acquirePlacements('/decide', outcome.name, () => {})
  await act(async () => {})
  p.test.preflight = cachedReadinessRead('/decide', outcome.name)?.answer ?? null
  view.rerender(content())
  expect(within(view.container).getByRole('alert').textContent).toBe(refused)
  fireEvent.click(within(view.container).getByRole('button', { name: 'Cancel' }))
  expect(close).toHaveBeenCalledOnce()
  view.unmount(); release()
})
