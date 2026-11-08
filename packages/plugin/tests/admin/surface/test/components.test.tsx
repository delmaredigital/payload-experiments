// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { SectionProps, SurfaceProps, TestDocApi } from '../../../../src/admin/surface/contracts.js'
import type { TestDocument } from '../../../../src/admin/surface/testDocument.model.js'
import { defaultArms } from '../../../../src/admin/arms/arms.model.js'
import { TestPage } from '../../../../src/admin/surface/test/TestPage.js'
import { Hypothesis, TestName, SelectEdit, CheckboxList } from '../../../../src/admin/surface/test/fields.js'
import { VersionsSection } from '../../../../src/admin/surface/test/VersionsSection.js'
import { LengthSection } from '../../../../src/admin/surface/test/LengthSection.js'
import { jumpToSection } from '../../../../src/admin/surface/test/jumpToSection.js'
import { AdvancedSection } from '../../../../src/admin/surface/test/AdvancedSection.js'
import { TargetingSection } from '../../../../src/admin/surface/test/TargetingSection.js'
import { GoalSection } from '../../../../src/admin/surface/test/GoalSection.js'
import { pageParts } from '../../../../src/admin/surface/test/pageParts.js'
import { pageBlockParts } from '../../../../src/admin/surface/pageBlock/parts.js'
import { EDITABLE_BY_STATUS } from '../../../../src/collections/experiments/editability.js'
import { lockedReason } from '../../../../src/admin/lockedNotice.model.js'

vi.mock('@payloadcms/ui', async () => (await import('../../_helpers/payloadUiMock.js')).payloadUiMock())
const hook = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/admin/surface/useTestDocument.js', () => ({ useTestDocument: hook }))
vi.mock('../../../../src/admin/surface/readiness/parts.js', () => ({ readinessParts: {
  Banner: () => null, SaveStatus: () => null,
  sectionDone: () => ({ what: false, versions: false, win: false, who: true, length: false, advanced: true }),
} }))
vi.mock('../../../../src/admin/surface/setting/parts.js', () => ({ settingParts: { Binding: () => null, VersionContent: () => null } }))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks() })
const doc = (partial: Partial<TestDocument> = {}): TestDocument => ({ id: 1, name: 'Welcome test', slug: 'welcome', status: 'draft', kind: 'block', unitType: 'visitor', arms: defaultArms('block'), allocation: 100, exposurePolicy: 'render', analysis: { plannedDurationDays: 28, minExposuresPerArm: 200 }, ...partial })
const surface: SurfaceProps = { adminRoute: '/cms', apiRoute: '/cms-api', canManage: true, canReadResults: true, isAdmin: true, flagPoints: [], attributeKeys: { country: { type: 'string', values: ['US', 'CA'] }, path: { type: 'string' }, age: { type: 'number' }, member: { type: 'boolean' } }, metricSources: [{ id: 'signup', label: 'Signups', kind: 'binomial', keyedBy: 'visitor', clientWritable: true }] }
function props(partial: Partial<TestDocument> = {}): SectionProps {
  return { surface, test: { doc: doc(partial), preflight: { checks: [], placements: [], baseline: null, trafficPerDay: null, estimate: null }, preflightError: null, preflightPending: false,
    hasUnsaved: false, stale: false, loadState: 'ready', saving: 'saved', errors: {}, chosenPages: {}, choosePage: vi.fn(async () => {}), stage: vi.fn(), commit: vi.fn(async () => {}), reload: vi.fn(async () => {}), refreshPreflight: vi.fn(async () => {}) } }
}
function blurChange(label: string, value: string) {
  const input = screen.getByLabelText(label)
  fireEvent.change(input, { target: { value } }); fireEvent.blur(input)
}
const metricsFetch = () => vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ docs: [{ id: 1, name: 'Registered', source: 'signup' }, { id: 2, name: 'Completed', source: 'signup' }], hasNextPage: false }) })))

test.each([7, 'goal-uuid'])('returning with goal %s saves its API id exactly once and removes only the goal param', async id => {
  window.history.replaceState(null, '', '/cms/experiments/test?goal=' + id + '&locale=en#section-win')
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ docs: [{ id, name: 'New goal', source: 'signup' }] }) })))
  const p = props({ metrics: { primary: null, guardrails: [2], secondary: [3] } })
  const view = render(<GoalSection {...p} />)
  await waitFor(() => expect(p.test.stage).toHaveBeenCalledWith({ metrics: { primary: id, guardrails: [2], secondary: [3] } }))
  view.rerender(<GoalSection {...p} />)
  expect(p.test.stage).toHaveBeenCalledOnce()
  expect(p.test.commit).toHaveBeenCalledOnce()
  expect(window.location.search).toBe('?locale=en')
  expect(window.location.hash).toBe('#section-win')
  window.history.replaceState(null, '', '/')
})
test.each(['running', 'decided', 'archived'] as const)('returned goals do not edit a %s test and clear the param', async status => {
  window.history.replaceState(null, '', '/cms/experiments/test?goal=2')
  metricsFetch()
  const p = props({ status, metrics: { primary: 1 } })
  render(<GoalSection {...p} />)
  await waitFor(() => expect(window.location.search).toBe(''))
  expect(p.test.stage).not.toHaveBeenCalled()
  expect(p.test.commit).not.toHaveBeenCalled()
  expect(screen.getByText('Manage goals').getAttribute('href')).toBe('/cms/collections/xp-metrics')
  window.history.replaceState(null, '', '/')
})

test('page load states are clear and the ready view has stacked anchored sections', async () => {
  metricsFetch()
  const p = props()
  hook.mockReturnValue({ ...p.test, doc: null, loadState: 'loading' })
  const view = render(<TestPage id={1} surface={surface} />)
  expect(screen.getByText('Loading test…')).toBeTruthy()
  const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' })
  expect(within(breadcrumb).getByRole('link', { name: 'Tests' }).getAttribute('href')).toBe('/cms/collections/xp-experiments')
  expect(within(breadcrumb).getByText('Test').getAttribute('aria-current')).toBe('page')
  for (const [loadState, message] of [['forbidden', "You don't have access to this test."], ['missing', 'This test no longer exists.'], ['error', "Couldn't load this test."]] as const) {
    hook.mockReturnValue({ ...p.test, doc: null, loadState })
    view.rerender(<TestPage id={1} surface={surface} />)
    expect(screen.getByText(message)).toBeTruthy()
  }
  fireEvent.click(screen.getByText('Try again')); expect(p.test.reload).toHaveBeenCalledOnce()
  hook.mockReturnValue(p.test); view.rerender(<TestPage id={1} surface={surface} />)
  expect(hook).toHaveBeenLastCalledWith(1, { apiRoute: '/cms-api', refetchPreflightOnFocus: true })
  for (const id of ['what', 'versions', 'win', 'who', 'length', 'advanced']) expect(view.container.querySelector(`#section-${id}`)).toBeTruthy()
  expect(screen.queryByRole('tab')).toBeNull()
  const what = view.container.querySelector('#section-what')!
  expect(within(what as HTMLElement).getByLabelText('Test name')).toBe(view.container.querySelector('.xp-test-content input'))
  expect(view.container.querySelector('.xp-test-header')).toBeNull()
  await waitFor(() => expect(screen.getAllByText('Registered · yes/no').length).toBeGreaterThan(0))
})
test('header and hypothesis save on blur or Enter, never on typing', () => {
  const p = props()
  render(<><TestName {...p} /><Hypothesis {...p} /></>)
  const name = screen.getByLabelText('Test name')
  name.focus(); fireEvent.change(name, { target: { value: 'New title' } })
  expect(p.test.stage).not.toHaveBeenCalled()
  fireEvent.keyDown(name, { key: 'Enter' })
  expect(p.test.stage).toHaveBeenLastCalledWith({ name: 'New title' })
  const hypothesis = screen.getByLabelText('Why are you testing this? (optional)')
  fireEvent.change(hypothesis, { target: { value: 'We believe' } })
  expect(p.test.commit).toHaveBeenCalledOnce()
  fireEvent.blur(hypothesis)
  expect(p.test.stage).toHaveBeenLastCalledWith({ hypothesis: 'We believe' })
})
test('versions keep keys fixed, preview shares locally, and commit current whole rows', () => {
  const p = props()
  const view = render(<VersionsSection {...p} parts={pageBlockParts} />)
  const weight = screen.getByLabelText('Original: Share (%)')
  fireEvent.change(weight, { target: { value: '40' } })
  expect(screen.getByRole('img').getAttribute('aria-label')).toContain('Original 40%')
  expect(p.test.stage).not.toHaveBeenCalled()
  // A server refusal changed another value before this blur. Rebuild from that current doc.
  p.test.doc = { ...p.test.doc!, arms: p.test.doc!.arms.map(a => ({ ...a, label: a.key === 'variantA' ? 'Server label' : a.label })) }
  view.rerender(<VersionsSection {...p} parts={pageBlockParts} />)
  fireEvent.blur(weight)
  expect(p.test.stage).toHaveBeenLastCalledWith({ arms: [{ ...p.test.doc.arms[0], weight: 40 }, { ...p.test.doc.arms[1], weight: 60 }] })
  expect(screen.queryByLabelText(/key/i)).toBeNull()
  p.test.doc = { ...p.test.doc, arms: p.test.doc.arms.map((arm, i) => ({ ...arm, weight: i ? 60 : 40 })) }
  view.rerender(<VersionsSection {...p} parts={pageBlockParts} />)
  fireEvent.click(screen.getByText('Split evenly'))
  expect(p.test.stage).toHaveBeenLastCalledWith({ arms: p.test.doc.arms.map(arm => ({ ...arm, weight: 50 })) })
  fireEvent.click(screen.getByText('Add a version'))
  const arms = vi.mocked(p.test.stage).mock.lastCall?.[0].arms
  expect(arms?.[2]).toMatchObject({ key: 'variantB', slot: 'variantB' })
})
test('allocation saves on release and keyboard release, not change', () => {
  const p = props()
  render(<VersionsSection {...p} parts={pageBlockParts} />)
  const slider = screen.getByRole('slider')
  fireEvent.change(slider, { target: { value: '60' } })
  expect(p.test.stage).not.toHaveBeenCalled()
  fireEvent.pointerUp(slider)
  expect(p.test.stage).toHaveBeenLastCalledWith({ allocation: 60 })
  fireEvent.blur(slider)
  expect(p.test.stage).toHaveBeenCalledTimes(1)
  fireEvent.change(slider, { target: { value: '61' } }); fireEvent.keyUp(slider, { key: 'ArrowRight' })
  expect(p.test.stage).toHaveBeenLastCalledWith({ allocation: 61 })
})
test('running sections show read-only values and the exact lock reason', async () => {
  metricsFetch()
  const p = props({ status: 'running' })
  render(<><VersionsSection {...p} parts={pageBlockParts} /><LengthSection {...p} /><AdvancedSection {...p} /><TargetingSection {...p} /><GoalSection {...p} /><TestName {...p} /></>)
  expect(screen.queryByRole('slider')).toBeNull()
  expect((screen.getByLabelText('Original: Share (%)') as HTMLInputElement).disabled).toBe(true)
  expect(screen.queryByLabelText('Planned length (days)')).toBeNull()
  expect(screen.queryByLabelText('Goal')).toBeNull()
  expect((screen.getByRole('button', { name: 'Add a version' }) as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByRole('button', { name: 'Remove version' }) as HTMLButtonElement).disabled).toBe(true)
  const versionsSection = document.querySelector<HTMLElement>('#section-versions')!
  const notice = within(versionsSection).getByText(lockedReason('running', 'arms', EDITABLE_BY_STATUS)!)
  expect(notice.tagName).toBe('P')
  expect(notice.className).toBe('xp-ui-help')
  expect(p.test.stage).not.toHaveBeenCalled()
  await waitFor(() => expect(screen.getByText('Goal')).toBeTruthy())
})
test('archived name is read-only and the analysis method is hidden for non-admins', () => {
  const p = props({ status: 'archived' }); p.surface = { ...surface, isAdmin: false }
  render(<><TestName {...p} /><AdvancedSection {...p} /></>)
  expect(screen.queryByLabelText('Test name')).toBeNull()
  expect(screen.getByText('Welcome test')).toBeTruthy()
  expect(screen.queryByText('Analysis method')).toBeNull()
  expect(screen.getByText('CUPED')).toBeTruthy()
  expect(p.test.stage).not.toHaveBeenCalled()
})
test('whole-page versions edit addresses without overwriting the current other rows; holdout has no address', () => {
  const p = props({ kind: 'page', exposurePolicy: 'pageview', arms: [...defaultArms('page'), { key: 'holdout', kind: 'holdout', label: 'Holdout', weight: 0 }] })
  const view = render(<><pageParts.Binding {...p} /><pageParts.VersionContent {...p} armIndex={1} /><pageParts.VersionContent {...p} armIndex={2} /></>)
  expect(screen.getByText('Each version is a whole page at its own address.')).toBeTruthy()
  const input = screen.getByLabelText('Variant A: Page address')
  fireEvent.change(input, { target: { value: '/new' } })
  expect(p.test.stage).not.toHaveBeenCalled()
  p.test.doc = { ...p.test.doc!, arms: p.test.doc!.arms.map(a => ({ ...a, weight: a.key === 'control' ? 60 : a.key === 'variantA' ? 40 : 0 })) }
  view.rerender(<><pageParts.Binding {...p} /><pageParts.VersionContent {...p} armIndex={1} /><pageParts.VersionContent {...p} armIndex={2} /></>)
  fireEvent.blur(input)
  expect(p.test.stage).toHaveBeenCalledWith({ arms: p.test.doc.arms.map((a, i) => i === 1 ? { ...a, pageTarget: '/new' } : a) })
  expect(screen.queryByLabelText('Holdout: Page address')).toBeNull()
})
test('block placement links and slot readiness distinguish each page and group', () => {
  const p = props()
  p.test.preflight!.placements = [{ collection: 'pages', id: 1, title: 'Landing', editorUrl: '/edit/page', detail: 'Published', ok: true, slots: { control: 1, variantA: 0, variantB: 0, variantC: 0 } }]
  render(<><pageBlockParts.Binding {...p} /><pageBlockParts.VersionContent {...p} armIndex={0} /><pageBlockParts.VersionContent {...p} armIndex={1} /></>)
  expect(screen.getByText('On: Landing (Published)')).toBeTruthy()
  expect(screen.getByText('Open the page').getAttribute('href')).toBe('/edit/page')
  expect(screen.getByText('Content ready')).toBeTruthy(); expect(screen.getByText('Empty')).toBeTruthy()
})
test('suggestion Apply and reach blur preserve current analysis and write both suggestion fields', () => {
  const p = props({ exposurePolicy: 'viewport' })
  p.test.preflight!.estimate = { weeks: 3, plannedDurationDays: 21, sequentialTuningParameter: 500, feasible: true }
  const view = render(<LengthSection {...p} />)
  expect((screen.getByLabelText('About how many people will see this per day? (required)') as HTMLInputElement).required).toBe(true)
  const reach = screen.getByLabelText('About how many people will see this per day? (required)')
  fireEvent.change(reach, { target: { value: '100' } })
  expect(p.test.stage).not.toHaveBeenCalled()
  p.test.doc = { ...p.test.doc!, analysis: { ...p.test.doc!.analysis, cuped: 'off' } }
  view.rerender(<LengthSection {...p} />); fireEvent.blur(reach)
  expect(p.test.stage).toHaveBeenLastCalledWith({ analysis: { ...p.test.doc.analysis, reachPerDay: 100 } })
  fireEvent.click(screen.getByText('Apply'))
  expect(p.test.stage).toHaveBeenLastCalledWith({ analysis: { ...p.test.doc.analysis, plannedDurationDays: 21, sequentialTuningParameter: 500 } })
  p.test.doc.analysis!.plannedDurationDays = 21; view.rerender(<LengthSection {...p} />)
  expect(screen.queryByText('Apply')).toBeNull()
})
test('Advanced select and number commits preserve current analysis and immutable values stay text', () => {
  const p = props()
  const view = render(<AdvancedSection {...p} />)
  fireEvent.change(screen.getByLabelText('CUPED'), { target: { value: 'off' } })
  expect(p.test.stage).toHaveBeenLastCalledWith({ analysis: { ...p.test.doc!.analysis, cuped: 'off' } })
  p.test.doc = { ...p.test.doc!, analysis: { ...p.test.doc!.analysis, cuped: 'off', reachPerDay: 90 } }
  view.rerender(<AdvancedSection {...p} />)
  blurChange('Minimum people per version', '300')
  expect(p.test.stage).toHaveBeenLastCalledWith({ analysis: { ...p.test.doc.analysis, minExposuresPerArm: 300 } })
  expect((screen.getByLabelText('Sequential tuning parameter') as HTMLInputElement).placeholder).toBe('Automatic (5,000)')
  expect((screen.getByLabelText('Attribution window (hours)') as HTMLInputElement).placeholder).toBe("Use each goal's window")
  expect(screen.queryByLabelText('Slug')).toBeNull()
  expect(screen.getByText('welcome')).toBeTruthy()
})
test('audience controls use typed values, word comparisons and current whole rules', () => {
  const p = props({ targeting: [{ attribute: 'age', op: 'gte', value: 18 }] })
  const view = render(<TargetingSection {...p} />)
  expect((screen.getByLabelText('Value') as HTMLInputElement).type).toBe('number')
  expect(screen.getByText('is at least')).toBeTruthy()
  fireEvent.change(screen.getByLabelText('Value'), { target: { value: '21' } })
  expect(p.test.stage).not.toHaveBeenCalled()
  p.test.doc = { ...p.test.doc!, targeting: [...p.test.doc!.targeting!, { attribute: 'member', op: 'eq', value: true }] }
  view.rerender(<TargetingSection {...p} />)
  fireEvent.blur(screen.getAllByLabelText('Value')[0]!)
  expect(p.test.stage).toHaveBeenLastCalledWith({ targeting: [{ attribute: 'age', op: 'gte', value: 21 }, p.test.doc.targeting![1]] })
})
test('empty list audience rule shows the model hint', () => {
  const p = props({ targeting: [{ attribute: 'country', op: 'in', value: [] }] })
  render(<TargetingSection {...p} />)
  expect(within(screen.getByRole('group', { name: 'Value' })).getAllByRole('checkbox')).toHaveLength(2)
  expect(screen.queryByRole('textbox', { name: 'Value' })).toBeNull()
  expect(screen.getByText("Add at least one value — an empty list can't be saved.")).toBeTruthy()
})
test('goals load via the host API and preserve the current metrics group on selection', async () => {
  metricsFetch()
  const p = props({ metrics: { primary: 1, guardrails: [], secondary: [] } })
  p.test.preflight!.baseline = { metricId: 1, value: .032, days: 28 }
  const view = render(<GoalSection {...p} />)
  await waitFor(() => expect(screen.getAllByText('Registered · yes/no').length).toBeGreaterThan(0))
  expect(fetch).toHaveBeenCalledWith('/cms-api/xp-metrics?depth=0&limit=100&page=1', expect.objectContaining({ credentials: 'include' }))
  expect(screen.getByText('Registered: Over the last 28 days: 3.2%')).toBeTruthy()
  expect(within(screen.getByRole('group', { name: 'Must not get worse (optional)' })).queryByLabelText('Registered · yes/no')).toBeNull()
  p.test.doc = { ...p.test.doc!, metrics: { primary: 1, guardrails: [], secondary: [2] } }
  view.rerender(<GoalSection {...p} />)
  fireEvent.change(screen.getByLabelText('Goal'), { target: { value: '' } })
  expect(p.test.stage).toHaveBeenLastCalledWith({ metrics: { primary: null, guardrails: [], secondary: [2] } })
  expect(screen.getByText('Manage goals').getAttribute('href')).toBe('/cms/collections/xp-metrics?return=1')
})
test('save refusals render inline', () => {
  const p = props()
  p.test.errors = { 'arms.1.label': 'Choose another label.', allocation: 'Refused share.' }
  render(<VersionsSection {...p} parts={pageBlockParts} />)
  expect(screen.getByText('Choose another label.')).toBeTruthy()
  expect(screen.getByText('Refused share.')).toBeTruthy()
})

test.each([1, 'uuid-goal'])('goal choices preserve original ids (%s), and reselecting is a no-op', async id => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ docs: [{ id, name: 'Selected goal', source: 'signup' }] }) })))
  const p = props({ metrics: { primary: null, guardrails: [], secondary: [] } })
  const view = render(<GoalSection {...p} />)
  await waitFor(() => expect(screen.getAllByText('Selected goal · yes/no').length).toBeGreaterThan(0))
  fireEvent.change(screen.getByLabelText('Goal'), { target: { value: String(id) } })
  expect(p.test.stage).toHaveBeenLastCalledWith({ metrics: { primary: id, guardrails: [], secondary: [] } })
  p.test.doc!.metrics!.primary = id
  view.rerender(<GoalSection {...p} />)
  fireEvent.change(screen.getByLabelText('Goal'), { target: { value: String(id) } })
  expect(p.test.stage).toHaveBeenCalledTimes(1)
  expect(p.test.commit).toHaveBeenCalledTimes(1)
})
test.each([2, 'uuid-guardrail'])('checkboxes preserve metric ids (%s) and add to the current whole group', async id => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ docs: [
    { id: 1, name: 'Primary', source: 'signup' }, { id, name: 'First', source: 'signup' },
    { id: 3, name: 'Second', source: 'signup' }, { id: 4, name: 'Watch', source: 'signup' },
  ] }) })))
  const p = props({ metrics: { primary: 1, guardrails: [], secondary: [] } })
  const view = render(<GoalSection {...p} />)
  await waitFor(() => expect(screen.getAllByText('First · yes/no').length).toBeGreaterThan(0))
  const guardrails = () => within(screen.getByRole('group', { name: 'Must not get worse (optional)' }))
  fireEvent.click(guardrails().getByLabelText('First · yes/no'))
  expect(p.test.stage).toHaveBeenLastCalledWith({ metrics: { primary: 1, guardrails: [id], secondary: [] } })
  p.test.doc!.metrics = { primary: 1, guardrails: [id], secondary: [] }
  view.rerender(<GoalSection {...p} />)
  // Read the current group even if another edit arrived since rendering.
  p.test.doc!.metrics.secondary = [4]
  fireEvent.click(guardrails().getByLabelText('Second · yes/no'))
  expect(p.test.stage).toHaveBeenLastCalledWith({ metrics: { primary: 1, guardrails: [id, 3], secondary: [4] } })
  p.test.doc!.metrics = { primary: 1, guardrails: [], secondary: [] }
  view.rerender(<GoalSection {...p} />)
  fireEvent.click(within(screen.getByRole('group', { name: 'Also keep an eye on (optional)' })).getByLabelText('First · yes/no'))
  expect(p.test.stage).toHaveBeenLastCalledWith({ metrics: { primary: 1, guardrails: [], secondary: [id] } })
})
test.each(['in', 'nin'] as const)('fixed-list %s targeting checkboxes keep current rules and save arrays', op => {
  const p = props({ targeting: [{ attribute: 'country', op, value: [] }] })
  const view = render(<TargetingSection {...p} />)
  fireEvent.click(screen.getByRole('checkbox', { name: 'US' }))
  expect(p.test.stage).toHaveBeenLastCalledWith({ targeting: [{ attribute: 'country', op, value: ['US'] }] })
  p.test.doc!.targeting![0]!.value = ['US']
  view.rerender(<TargetingSection {...p} />)
  p.test.doc!.targeting!.push({ attribute: 'age', op: 'gte', value: 18 })
  fireEvent.click(screen.getByRole('checkbox', { name: 'CA' }))
  expect(p.test.stage).toHaveBeenLastCalledWith({ targeting: [{ attribute: 'country', op, value: ['US', 'CA'] }, { attribute: 'age', op: 'gte', value: 18 }] })
  p.test.doc!.targeting![0]!.value = 'US, CA'
  view.rerender(<TargetingSection {...p} />)
  expect((screen.getByRole('checkbox', { name: 'CA' }) as HTMLInputElement).checked).toBe(true)
  fireEvent.click(screen.getByRole('checkbox', { name: 'CA' }))
  expect(p.test.stage).toHaveBeenLastCalledWith({ targeting: [{ attribute: 'country', op, value: ['US'] }, { attribute: 'age', op: 'gte', value: 18 }] })
  p.test.doc!.status = 'running'
  view.rerender(<TargetingSection {...p} />)
  expect(screen.queryByRole('checkbox')).toBeNull()
  expect(screen.getByText('US, CA')).toBeTruthy()
})
test('free-text in targeting renders chips, keeps current rules and saves arrays', () => {
  const p = props({ kind: 'flag', targeting: [{ attribute: 'path', op: 'in', value: [] }] })
  const view = render(<TargetingSection {...p} />)
  fireEvent.change(screen.getByRole('textbox', { name: 'Value' }), { target: { value: 'US' } })
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Value' }), { key: 'Enter' })
  expect(p.test.stage).toHaveBeenLastCalledWith({ targeting: [{ attribute: 'path', op: 'in', value: ['US'] }] })
  p.test.doc!.targeting![0]!.value = ['US']
  view.rerender(<TargetingSection {...p} />)
  p.test.doc!.targeting!.push({ attribute: 'age', op: 'gte', value: 18 })
  fireEvent.change(screen.getByRole('textbox', { name: 'Value' }), { target: { value: 'CA' } })
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Value' }), { key: 'Enter' })
  expect(p.test.stage).toHaveBeenLastCalledWith({ targeting: [{ attribute: 'path', op: 'in', value: ['US', 'CA'] }, { attribute: 'age', op: 'gte', value: 18 }] })
})
test('read-only goals show None selected or a neutral label while goals are unavailable, never raw ids', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Unavailable') }))
  const p = props({ status: 'running', metrics: { primary: null, guardrails: [] } })
  const view = render(<GoalSection {...p} />)
  expect(screen.getAllByText('None selected')).toHaveLength(3)
  p.test.doc!.metrics = { primary: 12345, guardrails: ['missing-uuid'] }
  view.rerender(<GoalSection {...p} />)
  expect(screen.getAllByText('Goal details unavailable')).toHaveLength(2)
  expect(screen.queryByText('A goal that no longer exists')).toBeNull()
  expect(screen.queryByText('12345')).toBeNull()
  expect(screen.queryByText('missing-uuid')).toBeNull()
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
})
test('reach controls the no-estimate hint and required label', () => {
  const p = props()
  const view = render(<LengthSection {...p} />)
  expect(screen.getByText('Enter a daily number above to get a suggestion. 4 weeks is a safe default.')).toBeTruthy()
  expect(screen.getByLabelText('About how many people will see this per day?').hasAttribute('required')).toBe(false)
  p.test.doc!.analysis!.reachPerDay = 100
  view.rerender(<LengthSection {...p} />)
  expect(screen.queryByText(/Enter a daily number above/)).toBeNull()
  expect(screen.getByText('Choose a goal to get a suggestion.')).toBeTruthy()
  for (const exposurePolicy of ['manual', 'viewport'] as const) {
    p.test.doc!.exposurePolicy = exposurePolicy
    view.rerender(<LengthSection {...p} />)
    expect((screen.getByLabelText('About how many people will see this per day? (required)') as HTMLInputElement).required).toBe(true)
  }
})
test.each(['', '0', '-1'])('required numeric edits %j revert without saving', value => {
  const p = props()
  render(<><LengthSection {...p} /><AdvancedSection {...p} /></>)
  blurChange('Planned length (days)', value)
  blurChange('Minimum people per version', value)
  expect((screen.getByLabelText('Planned length (days)') as HTMLInputElement).value).toBe('28')
  expect((screen.getByLabelText('Minimum people per version') as HTMLInputElement).value).toBe('200')
  expect(p.test.stage).not.toHaveBeenCalled()
  expect(p.test.commit).not.toHaveBeenCalled()
})
test.each(['150', '-1', '33.5', ''])('invalid share %j reverts without saving and explains invalid numbers', value => {
  const p = props()
  render(<VersionsSection {...p} parts={pageBlockParts} />)
  blurChange('Original: Share (%)', value)
  expect((screen.getByLabelText('Original: Share (%)') as HTMLInputElement).value).toBe('50')
  expect(screen.getByRole('img').getAttribute('aria-label')).toContain('Original 50%')
  expect(p.test.stage).not.toHaveBeenCalled()
  expect(p.test.commit).not.toHaveBeenCalled()
  if (value) expect(screen.getByText('Use a whole number from 0 to 100.')).toBeTruthy()
})
test('admins see the method control on editable tests and non-admins do not', () => {
  const p = props()
  const view = render(<AdvancedSection {...p} />)
  expect(screen.getByLabelText('Analysis method')).toBeInstanceOf(HTMLSelectElement)
  p.surface = { ...surface, isAdmin: false }
  view.rerender(<AdvancedSection {...p} />)
  expect(screen.queryByLabelText('Analysis method')).toBeNull()
  expect(screen.queryByText('Analysis method')).toBeNull()
})
test('drafts have no Results link and unplaced blocks explain how to add them', () => {
  const p = props()
  render(<><TestName {...p} /><pageBlockParts.Binding {...p} /></>)
  expect(screen.queryByRole('link', { name: 'Results' })).toBeNull()
  expect(screen.getByText('Not on a page yet. Open a page, add an Experiment block and choose this test.')).toBeTruthy()
})
test.each([
  ['block', ['When rendered', 'When visible']], ['page', ['On a page visit']],
  ['flag', ['When the host records it']], ['code', ['When the host records it']],
] as const)('Advanced renders exactly the allowed exposure options for %s', (kind, labels) => {
  const p = props({ kind, exposurePolicy: kind === 'block' ? 'render' : kind === 'page' ? 'pageview' : 'manual' })
  render(<AdvancedSection {...p} />)
  fireEvent.click(screen.getByText('Advanced settings · for developers'))
  expect(within(screen.getByLabelText('Exposure policy')).getAllByRole('option').map(option => option.textContent)).toEqual(labels)
})
test('a goal missing from a successful load reads as no longer existing', async () => {
  metricsFetch()
  render(<GoalSection {...props({ status: 'running', metrics: { primary: 99, guardrails: [] } })} />)
  await waitFor(() => expect(screen.getByText('A goal that no longer exists')).toBeTruthy())
  expect(screen.queryByText('Goal details unavailable')).toBeNull()
})

test.each(['in', 'nin'] as const)('legacy %s lists load as chips and save arrays; running lists stay disabled', op => {
  const p = props({ kind: 'flag', targeting: [{ attribute: 'path', op, value: 'US, CA' }] })
  const view = render(<TargetingSection {...p} />)
  expect(screen.getByRole('button', { name: 'Remove US' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Remove CA' }))
  expect(p.test.stage).toHaveBeenLastCalledWith({ targeting: [{ attribute: 'path', op, value: ['US'] }] })
  p.test.doc!.status = 'running'
  view.rerender(<TargetingSection {...p} />)
  expect((screen.getByRole('textbox', { name: 'Value' }) as HTMLInputElement).disabled).toBe(true)
  expect((screen.getByRole('button', { name: 'Remove US' }) as HTMLButtonElement).disabled).toBe(true)
})

test('switching a legacy list operator and editing another row normalize whole-group writes', () => {
  const p = props({ targeting: [{ attribute: 'country', op: 'in', value: 'US, CA' }, { attribute: 'age', op: 'gte', value: 18 }] })
  render(<TargetingSection {...p} />)
  fireEvent.change(screen.getAllByLabelText('Comparison')[0]!, { target: { value: 'nin' } })
  expect(p.test.stage).toHaveBeenLastCalledWith({ targeting: [{ attribute: 'country', op: 'nin', value: ['US', 'CA'] }, { attribute: 'age', op: 'gte', value: 18 }] })
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Value' }), { target: { value: '21' } })
  fireEvent.blur(screen.getByRole('spinbutton', { name: 'Value' }))
  expect(p.test.stage).toHaveBeenLastCalledWith({ targeting: [{ attribute: 'country', op: 'in', value: ['US', 'CA'] }, { attribute: 'age', op: 'gte', value: 21 }] })
})
test('deleting a list rule cannot transfer its unfinished chip draft to the next rule', () => {
  const p = props({ kind: 'flag', targeting: [{ attribute: 'path', op: 'in', value: ['US'] }, { attribute: 'path', op: 'in', value: ['CA'] }] })
  vi.mocked(p.test.stage).mockImplementation(patch => { p.test.doc = { ...p.test.doc!, ...patch } })
  const view = render(<TargetingSection {...p} />)
  fireEvent.change(screen.getAllByRole('textbox', { name: 'Value' })[0]!, { target: { value: 'draft' } })
  fireEvent.click(screen.getAllByRole('button', { name: 'Remove rule' })[0]!)
  view.rerender(<TargetingSection {...p} />)
  const remaining = screen.getByRole('textbox', { name: 'Value' }) as HTMLInputElement
  expect(remaining.value).toBe('')
  fireEvent.keyDown(remaining, { key: 'Enter' })
  expect(p.test.stage).toHaveBeenCalledTimes(1)
  expect(p.test.doc!.targeting).toEqual([{ attribute: 'path', op: 'in', value: ['CA'] }])
})

test('real Shell owns the setup title, name breadcrumb, chips and Results link with Start only at the bottom', async () => {
  metricsFetch()
  const p = props({ id: 'test/1', status: 'running' })
  hook.mockReturnValue(p.test)
  const view = render(<TestPage id={p.test.doc!.id} surface={surface} />)
  const shell = view.container.querySelector<HTMLElement>('.xp-tests-shell-header')!
  expect(within(shell).getByRole('heading', { name: 'Welcome test', level: 1 })).toBeTruthy()
  expect(within(within(shell).getByRole('navigation', { name: 'Breadcrumb' })).getByText('Welcome test').getAttribute('aria-current')).toBe('page')
  expect(within(shell).getByText('Page block')).toBeTruthy()
  expect(within(shell).getByText('Running')).toBeTruthy()
  expect(within(shell).getByRole('link', { name: 'Results' }).getAttribute('href')).toBe('/cms/experiments/test%2F1/results')
  expect(within(shell).queryByRole('button', { name: /^Start/ })).toBeNull()
  expect(screen.getByRole('region', { name: 'Readiness' }).contains(screen.getByRole('button', { name: 'Stop' }))).toBe(true)
  expect(view.container.querySelectorAll('.xp-ui-section')).toHaveLength(5)
  expect(view.container.querySelectorAll('.xp-ui-section-number')).toHaveLength(5)
  expect(view.container.querySelector('.xp-test-page--setup')?.getAttribute('style')).toContain('padding-bottom: 0px')
  await waitFor(() => expect(screen.getByText('Goal')).toBeTruthy())
})

test('name validation errors appear with the first field inside What you are testing', async () => {
  metricsFetch()
  const p = props()
  p.test.errors = { name: 'Give this test a name.' }
  hook.mockReturnValue(p.test)
  const view = render(<TestPage id={1} surface={surface} />)
  const what = view.container.querySelector<HTMLElement>('#section-what')!
  expect(within(what).getByRole('alert').textContent).toBe('Give this test a name.')
  expect(within(what).getByLabelText('Test name')).toBe(what.querySelector('input'))
  expect(screen.getAllByLabelText('Test name')).toHaveLength(1)
  await waitFor(() => expect(screen.getAllByText('Registered · yes/no').length).toBeGreaterThan(0))
})


test('versions use one visible header, accessible inputs, exact split widths and a muted holdout', () => {
  const p = props({ arms: [
    { key: 'control', kind: 'control', label: 'Original', weight: 40, slot: 'control' },
    { key: 'variantA', kind: 'variant', label: 'Short ask', weight: 20, slot: 'variantA' },
    { key: 'variantB', kind: 'variant', label: 'Long ask', weight: 15, slot: 'variantB' },
    { key: 'variantC', kind: 'variant', label: 'New ask', weight: 15, slot: 'variantC' },
    { key: 'holdout', kind: 'holdout', label: 'Holdout', weight: 10 },
  ] })
  const view = render(<VersionsSection {...p} parts={pageBlockParts} />)
  expect(view.container.querySelectorAll('.xp-version-grid-head')).toHaveLength(1)
  expect(view.container.querySelectorAll('.xp-version-row')).toHaveLength(5)
  const original = view.container.querySelector('.xp-version-row')!
  expect(original.children).toHaveLength(4)
  expect(original.children[3]!.classList.contains('xp-version-remove')).toBe(true)
  expect(original.children[3]!.childElementCount).toBe(0)
  expect(screen.getByRole('textbox', { name: 'Original: Version label' })).toBeTruthy()
  const segments = Array.from(screen.getByRole('img').children) as HTMLElement[]
  expect(segments.map(node => node.style.width)).toEqual(['40%', '20%', '15%', '15%', '10%'])
  expect(segments.map(node => node.style.background)).toEqual(['var(--xp-series-muted)', 'var(--xp-series-a)', 'var(--xp-series-b)', 'var(--xp-series-c)', 'var(--xp-series-muted)'])
  expect(screen.getByText('Short ask 20%')).toBeTruthy()
  fireEvent.change(screen.getByLabelText('Original: Share (%)'), { target: { value: '20' } })
  expect(segments[0]!.style.width).toBe('20%')
  expect(screen.getAllByRole('button', { name: 'Remove version' })).toHaveLength(4)
  expect(screen.getAllByRole('button').every(button => button.closest('.xp-ui-button-group'))).toBe(true)
})

test('block binding groups repeated placements per page using the maximum count in one document version', () => {
  const p = props()
  const placement = { collection: 'pages', id: 1, title: 'Landing', editorUrl: '/edit/1', detail: 'Published', ok: true }
  p.test.preflight!.placements = [placement, placement, { ...placement, detail: 'Draft' },
    { ...placement, id: 2, title: 'Thank you', editorUrl: '/edit/2', detail: 'Draft' }]
  const view = render(<pageBlockParts.Binding {...p} />)
  expect(screen.getByText('On: Landing (Published) (placed 2 times)')).toBeTruthy()
  expect(screen.getByText('On: Thank you (Draft)')).toBeTruthy()
  expect(screen.getAllByRole('link', { name: 'Open the page' })).toHaveLength(2)
  expect(view.container.querySelectorAll('.xp-page-binding > p')).toHaveLength(3)
})

test('Advanced opens when a threshold error arrives and leaves the field error visible', () => {
  const p = props()
  const view = render(<AdvancedSection {...p} />)
  const details = view.container.querySelector('details')!
  expect(details.open).toBe(false)
  p.test.errors = { 'analysis.minExposuresPerArm': 'Enter a minimum of one person per version.' }
  view.rerender(<AdvancedSection {...p} />)
  expect(details.open).toBe(true)
  expect(within(details).getByRole('alert').textContent).toBe('Enter a minimum of one person per version.')
})

test('Advanced mounts open when an analysis error is already present', () => {
  const p = props()
  p.test.errors = { 'analysis.minExposuresPerArm': 'Enter a minimum of one person per version.' }
  const view = render(<AdvancedSection {...p} />)
  expect(view.container.querySelector('details')!.open).toBe(true)
})

test('Advanced stays closed after a synced close while the same error remains', () => {
  const p = props()
  p.test.errors = { 'analysis.minExposuresPerArm': 'Enter a minimum of one person per version.' }
  const view = render(<AdvancedSection {...p} />)
  const details = view.container.querySelector('details')!
  expect(details.open).toBe(true)
  details.open = false
  fireEvent(details, new Event('toggle'))
  expect(details.open).toBe(false)
  view.rerender(<AdvancedSection {...p} />)
  expect(details.open).toBe(false)
})

test('jumpToSection reopens Advanced after a synced close and it stays open on rerender', () => {
  const p = props()
  p.test.errors = { 'analysis.minExposuresPerArm': 'Enter a minimum of one person per version.' }
  const view = render(<AdvancedSection {...p} />)
  const details = view.container.querySelector('details')!
  expect(details.open).toBe(true)
  details.open = false
  fireEvent(details, new Event('toggle'))
  expect(details.open).toBe(false)
  jumpToSection('advanced')
  fireEvent(details, new Event('toggle'))
  expect(details.open).toBe(true)
  view.rerender(<AdvancedSection {...p} />)
  expect(details.open).toBe(true)
})

test('Advanced reopens for a returning error after its closed state was synced', () => {
  const p = props()
  p.test.errors = { 'analysis.minExposuresPerArm': 'Enter a minimum of one person per version.' }
  const view = render(<AdvancedSection {...p} />)
  const details = view.container.querySelector('details')!
  expect(details.open).toBe(true)
  details.open = false
  fireEvent(details, new Event('toggle'))
  expect(details.open).toBe(false)
  p.test.errors = {}
  view.rerender(<AdvancedSection {...p} />)
  expect(details.open).toBe(false)
  p.test.errors = { 'analysis.minExposuresPerArm': 'Enter a minimum of one person per version.' }
  view.rerender(<AdvancedSection {...p} />)
  expect(details.open).toBe(true)
})

test('a deleted primary goal displays Choose a goal with a matching old baseline present', async () => {
  metricsFetch()
  const p = props({ metrics: { primary: 99 } })
  p.test.preflight!.baseline = { metricId: 99, value: .03, days: 28 }
  render(<GoalSection {...p} />)
  await waitFor(() => expect(screen.getAllByText('Registered · yes/no').length).toBeGreaterThan(0))
  expect((screen.getByRole('combobox', { name: 'Goal' }) as HTMLSelectElement).selectedOptions[0]!.textContent).toBe('Choose a goal')
  expect(p.test.stage).not.toHaveBeenCalled()
})

test('whole-page versions show Page ready or Add a page address for their current target', () => {
  const p = props({ kind: 'page', arms: defaultArms('page').map((arm, i) => ({ ...arm, pageTarget: i ? '' : '/welcome' })) })
  render(<VersionsSection {...p} parts={pageParts} />)
  expect(screen.getByText('Page ready')).toBeTruthy()
  expect(screen.getByText('Add a page address')).toBeTruthy()
})


test('holdout explanation appears only when there is a holdout arm', () => {
  const p = props()
  const view = render(<VersionsSection {...p} parts={pageBlockParts} />)
  expect(screen.queryByText(/The holdout sees the Original and is measured/)).toBeNull()
  p.test.doc!.arms = [...p.test.doc!.arms, { key: 'holdout', kind: 'holdout', label: 'Holdout', weight: 0 }]
  view.rerender(<VersionsSection {...p} parts={pageBlockParts} />)
  expect(screen.getByText(/The holdout sees the Original and is measured/)).toBeTruthy()
})

test.each([2, 8])('there is no goal search with %s goals', async count => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ docs: Array.from({ length: count }, (_, i) => ({ id: i + 1, name: `Goal ${i + 1}`, source: 'signup' })) }) })))
  render(<GoalSection {...props()} />)
  await waitFor(() => expect(screen.getAllByText('Goal 1 · yes/no')).toHaveLength(3))
  expect(screen.queryByRole('searchbox')).toBeNull()
  expect(screen.queryByRole('textbox', { name: 'Search goals' })).toBeNull()
})

test('large goal lists search independently inside each list and retain checked options', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ docs: Array.from({ length: 10 }, (_, i) => ({ id: i + 1, name: `Goal ${i + 1}`, source: 'signup' })) }) })))
  const p = props({ metrics: { primary: 1, guardrails: [2], secondary: [3] } })
  render(<GoalSection {...p} />)
  await waitFor(() => expect(screen.getAllByRole('searchbox')).toHaveLength(2))
  const guardrails = within(screen.getByRole('group', { name: 'Must not get worse (optional)' }))
  const secondary = within(screen.getByRole('group', { name: 'Also keep an eye on (optional)' }))
  fireEvent.change(guardrails.getByRole('searchbox'), { target: { value: 'GOAL 9' } })
  expect(guardrails.getByRole('checkbox', { name: 'Goal 2 · yes/no' })).toBeTruthy()
  expect(guardrails.getByRole('checkbox', { name: 'Goal 9 · yes/no' })).toBeTruthy()
  expect(guardrails.queryByRole('checkbox', { name: 'Goal 4 · yes/no' })).toBeNull()
  expect(secondary.getByRole('checkbox', { name: 'Goal 4 · yes/no' })).toBeTruthy()
  fireEvent.change(secondary.getByRole('searchbox'), { target: { value: 'Goal 8' } })
  expect(secondary.getByRole('checkbox', { name: 'Goal 3 · yes/no' })).toBeTruthy()
  expect(secondary.getByRole('checkbox', { name: 'Goal 8 · yes/no' })).toBeTruthy()
  expect(secondary.queryByRole('checkbox', { name: 'Goal 4 · yes/no' })).toBeNull()
  fireEvent.click(guardrails.getByRole('checkbox', { name: 'Goal 9 · yes/no' }))
  expect(p.test.stage).toHaveBeenLastCalledWith({ metrics: { primary: 1, guardrails: [2, 9], secondary: [3] } })
  expect(within(screen.getByRole('combobox', { name: 'Goal' })).getByRole('option', { name: 'Goal 4 · yes/no' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Manage goals' }).closest('.xp-ui-field-label')?.querySelector('label')?.textContent).toBe('Goal')
})
test('page block tests never offer the Path attribute; setting tests still do', () => {
  const block = props({ targeting: [{ attribute: 'age', op: 'gte', value: 18 }] })
  const view = render(<TargetingSection {...block} />)
  expect(within(screen.getByLabelText('Attribute')).queryByRole('option', { name: 'Path' })).toBeNull()
  view.unmount()
  const flag = props({ kind: 'flag', targeting: [{ attribute: 'age', op: 'gte', value: 18 }] })
  render(<TargetingSection {...flag} />)
  expect(within(screen.getByLabelText('Attribute')).getByRole('option', { name: 'Path' })).toBeTruthy()
})
test('an existing path rule on a page block test is read-only with a removal note', () => {
  const p = props({ targeting: [{ attribute: 'path', op: 'in', value: ['/a'] }, { attribute: 'age', op: 'gte', value: 18 }] })
  render(<TargetingSection {...p} />)
  expect(screen.getByText('This rule no longer applies to page block tests; remove it.')).toBeTruthy()
  expect(screen.getAllByLabelText('Attribute')).toHaveLength(1)
  fireEvent.click(screen.getAllByRole('button', { name: 'Remove rule' })[0]!)
  expect(p.test.stage).toHaveBeenLastCalledWith({ targeting: [{ attribute: 'age', op: 'gte', value: 18 }] })
})

test('whole-page holdouts stay under Advanced and have no picker row', () => {
  const p = props({ kind: 'page', arms: [...defaultArms('page'), { key: 'holdout', kind: 'holdout', label: 'Holdout', weight: 10 }] })
  const view = render(<VersionsSection {...p} parts={pageParts} />)
  expect(screen.queryByRole('button', { name: 'Add a holdout' })).toBeNull()
  expect(screen.queryByLabelText('Holdout: Version label')).toBeNull()
  view.unmount()
  render(<AdvancedSection {...p} />)
  expect(screen.getByLabelText('Holdout: Version label')).toBeTruthy()
  expect(screen.getByLabelText('Holdout: Share (%)')).toBeTruthy()
})

const clickMetric = { id: 3, name: 'Hero interest', source: 'click:hero-cta' }
function clickGoalsFetch(status = 200) {
  const fetcher = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/click-keys')
    ? { keys: [{ key: 'hero-cta', arms: ['control', 'variantA'], label: 'Hero' }] }
    : { docs: [{ id: 1, name: 'Registration', source: 'signup' }, clickMetric, { id: 4, name: 'Other clicks', source: 'click:footer' }] }),
  { status: url.endsWith('/click-keys') ? status : 200 }))
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}
function clickProps(primary?: number) {
  const p = props({ metrics: { primary } })
  p.surface = { ...surface, metricSources: [...surface.metricSources,
    { id: 'click:', label: 'A click on the page', kind: 'binomial', keyedBy: 'visitor', clientWritable: true }] }
  return p
}
test('click goals found on the page lead every role picker, with block labels and the linked-document note', async () => {
  clickGoalsFetch()
  render(<GoalSection {...clickProps()} />)
  await screen.findAllByText('Hero interest · Hero')
  const select = screen.getByRole('combobox', { name: 'Goal' })
  expect(within(select).getByRole('group', { name: "On this test's page" }).textContent).toBe('Hero interest · Hero')
  expect(within(select).getAllByRole('option').map(option => option.textContent)).toEqual(['Choose a goal', 'Hero interest · Hero', 'Registration · yes/no', 'Other clicks · yes/no'])
  expect(screen.getAllByRole('heading', { level: 3, name: "On this test's page" })).toHaveLength(2)
  expect(screen.getByText("Goals inside linked documents aren't shown. Goals added in code (data-xp-goal) work but aren't listed here.")).toBeTruthy()
  expect(screen.queryByText('A click shows interest, not the result you want.')).toBeNull()
  expect(screen.queryByText('+ New click goal')).toBeNull()
})
test.each([403, 500])('a failed click-key read (%s) silently keeps the flat goal list', async status => {
  clickGoalsFetch(status)
  render(<GoalSection {...clickProps(3)} />)
  await screen.findAllByText('Hero interest · yes/no')
  expect(screen.queryByRole('group', { name: "On this test's page" })).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getByText('A click shows interest, not the result you want.')).toBeTruthy()
})
test('click-key reads refetch once on a visible tab return and are manager only', async () => {
  const fetcher = clickGoalsFetch()
  const p = clickProps(3)
  const view = render(<GoalSection {...p} />)
  await screen.findByText('A click shows interest, not the result you want.')
  expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/click-keys'))).toHaveLength(1)
  fireEvent(document, new Event('visibilitychange')); fireEvent.focus(window)
  await waitFor(() => expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/click-keys'))).toHaveLength(2))
  view.unmount()
  fetcher.mockClear()
  render(<GoalSection {...p} surface={{ ...p.surface, canManage: false }} />)
  await screen.findByText('A click shows interest, not the result you want.')
  expect(fetcher.mock.calls.some(([url]) => url.endsWith('/click-keys'))).toBe(false)
})
test('no click goals means no linked-document note and no click-primary help', async () => {
  metricsFetch()
  render(<GoalSection {...props({ metrics: { primary: 1 } })} />)
  await screen.findAllByText('Registered · yes/no')
  expect(screen.queryByText(/Goals inside linked documents/)).toBeNull()
  expect(screen.queryByText('A click shows interest, not the result you want.')).toBeNull()
})
test('grouped and plain SelectEdit and CheckboxList retain their values and commit behaviour', () => {
  const commit = vi.fn(), toggle = vi.fn()
  const options = [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }]
  const groups = [{ label: 'First group', options: options.slice(0, 1) }, { options: options.slice(1) }]
  const view = render(<><SelectEdit label="Select" value="a" options={options} groups={groups} onCommit={commit} />
    <CheckboxList label="Checks" value={['a']} options={options} groups={groups} onToggle={toggle} /></>)
  expect(screen.getByRole('group', { name: 'First group' })).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'First group' })).toBeTruthy()
  expect(screen.getAllByRole('list')).toHaveLength(2)
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'b' } })
  fireEvent.click(screen.getByRole('checkbox', { name: 'Beta' }))
  expect(commit).toHaveBeenCalledWith('b'); expect(toggle).toHaveBeenCalledWith('b', true)
  view.rerender(<><SelectEdit label="Select" value="a" options={options} onCommit={commit} />
    <CheckboxList label="Checks" value={['a']} options={options} onToggle={toggle} /></>)
  expect(screen.queryByRole('heading')).toBeNull(); expect(screen.queryByRole('list')).toBeNull()
  expect((screen.getByRole('checkbox', { name: 'Alpha' }) as HTMLInputElement).checked).toBe(true)
})

test('an older click-key response arriving last cannot replace the latest page grouping', async () => {
  const pending: Array<(response: Response) => void> = []
  vi.stubGlobal('fetch', vi.fn((url: string) => url.endsWith('/click-keys')
    ? new Promise<Response>(resolve => { pending.push(resolve) })
    : Promise.resolve(new Response(JSON.stringify({ docs: [clickMetric] })))))
  render(<GoalSection {...clickProps()} />)
  await screen.findAllByText('Hero interest · yes/no')
  expect(pending).toHaveLength(1)
  fireEvent.focus(window)
  expect(pending).toHaveLength(2)
  await act(async () => { pending[1]!(new Response(JSON.stringify({ keys: [{ key: 'hero-cta', arms: ['control'], label: 'Latest Hero' }] }))) })
  const group = () => within(screen.getByRole('combobox', { name: 'Goal' })).getByRole('group', { name: "On this test's page" })
  expect(group().textContent).toBe('Hero interest · Latest Hero')
  await act(async () => { pending[0]!(new Response(JSON.stringify({ keys: [{ key: 'hero-cta', arms: ['control'], label: 'Old Hero' }] }))) })
  expect(group().textContent).toBe('Hero interest · Latest Hero')
  expect(screen.queryByText('Hero interest · Old Hero')).toBeNull()
})
