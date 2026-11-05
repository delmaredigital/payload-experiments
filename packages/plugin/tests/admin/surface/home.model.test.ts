import { expect, test } from 'vitest'
import { groupTests, healthDot, homeCard } from '../../../src/admin/surface/home.model.js'
import type { HomeTest } from '../../../src/admin/surface/home.model.js'
import type { SummaryResponse } from '../../../src/types/endpoints.js'

const testDoc = (id: string, status: HomeTest['status'] = 'draft'): HomeTest => ({ id, name: id, kind: 'flag', unitType: 'visitor', status, analysis: { plannedDurationDays: 28 } })
const summary = (code: NonNullable<SummaryResponse[string]['verdict']>['code'], days = 5) => ({ exposures: 1200, days, verdict: { code, headline: 'A headline' } })
test('groups in the decided order, preserving activity order and treating missing ready as draft', () => {
  const docs = [testDoc('red', 'running'), testDoc('green', 'running'), testDoc('ready'), testDoc('stopped-ready', 'stopped'), testDoc('draft'), testDoc('stopped', 'stopped'), testDoc('decided', 'decided'), testDoc('archived', 'archived')]
  const groups = groupTests(docs, { red: summary('data-problem'), ready: { ...summary('collecting'), ready: true }, 'stopped-ready': { ...summary('collecting'), ready: true } })
  expect(groups.map(group => group.label)).toEqual(['Needs attention', 'Running', 'Ready to start', 'Draft', 'Decided', 'Archived'])
  expect(groups.map(group => group.tests.map(doc => doc.id))).toEqual([['red'], ['green'], ['ready', 'stopped-ready'], ['draft', 'stopped'], ['decided'], ['archived']])
})
test.each([
  ['data-problem', 1, 'red'], ['guardrail-failing', 1, 'red'], ['unavailable', 1, 'amber'],
  ['collecting', 29, 'amber'], ['collecting', 28, 'green'], ['winner', 99, 'green'],
] as const)('health from %s at %i days is %s', (code, days, color) => {
  expect(healthDot(testDoc('run', 'running'), summary(code, days))).toBe(color)
})
test('no verdict and no planned duration do not invent a data warning', () => {
  expect(healthDot(testDoc('run'), undefined)).toBeUndefined()
  expect(healthDot(testDoc('run'), { exposures: 0, days: 0, verdict: null })).toBeUndefined()
  expect(healthDot({ ...testDoc('run'), analysis: null }, summary('collecting', 99))).toBe('green')
})
test('card copy, kind labels and actions are user-facing', () => {
  const running = homeCard(testDoc('x/y', 'running'), summary('collecting'), '/control')
  expect(running).toMatchObject({ kind: 'Setting', line: 'Running 5 days of 28 · 1,200 people so far', href: '/control/experiments/x%2Fy/results', action: 'View results' })
  expect(homeCard(testDoc('ready'), { ...summary('collecting'), ready: true }, '/admin').line).toBe('Ready to start')
  expect(homeCard(testDoc('draft'), undefined, '/admin')).toMatchObject({ line: 'Next: Review setup', action: 'Continue setup' })
  expect(homeCard(testDoc('stopped', 'stopped'), undefined, '/admin')).toMatchObject({ action: 'View results', href: '/admin/experiments/stopped/results' })
  expect(homeCard({ ...testDoc('decided', 'decided'), decidedAt: '2026-11-02T12:00:00Z', decision: { winnerArm: 'variantA' } }, undefined, '/admin').line).toBe('Decided 2 Nov 2026: Variant A')
  expect(homeCard(testDoc('archive', 'archived'), undefined, '/admin')).toMatchObject({ action: 'View results', href: '/admin/experiments/archive/results' })
  for (const [kind, label] of [['block', 'Page block'], ['flag', 'Setting'], ['code', 'Setting'], ['page', 'Whole page']] as const) {
    expect(homeCard({ ...testDoc('x'), kind }, undefined, '/admin').kind).toBe(label)
  }
})
test('search filters names case-insensitively across groups', () => {
  const groups = groupTests([testDoc('Hello'), testDoc('world', 'running')], {}, ' hELLo ')
  expect(groups.flatMap(group => group.tests.map(doc => doc.id))).toEqual(['Hello'])
})

test('missing summaries and null verdicts stay in Running without a health claim', () => {
  const docs = [testDoc('missing', 'running'), testDoc('null', 'running')]
  const summaries = { null: { exposures: 0, days: 0, verdict: null } }
  expect(groupTests(docs, summaries).map(group => group.tests.map(doc => doc.id))).toEqual([[], ['missing', 'null'], [], [], [], []])
  for (const doc of docs) expect(homeCard(doc, summaries[doc.id as 'null'], '/admin').health).toBeUndefined()
})
test.each(['draft', 'running', 'stopped', 'decided', 'archived'] as const)('root admin card URL for %s has no double slash', status => {
  expect(homeCard(testDoc('x/y', status), undefined, '/').href).toBe(`/experiments/x%2Fy${['running', 'stopped', 'decided', 'archived'].includes(status) ? '/results' : ''}`)
})

test('decided sentence uses the stored label and UTC calendar day', () => {
  expect(homeCard({ ...testDoc('winner', 'decided'), decidedAt: '2026-10-13T01:30:00+02:00',
    arms: [{ key: 'variantB', label: 'Short form', kind: 'variant', weight: 50 }], decision: { winnerArm: 'variantB' } }, undefined, '/admin').line)
    .toBe('Decided 12 Oct 2026: Short form')
})
test('running sentences stay compact past the planned end and omit verdict detail', () => {
  expect(homeCard(testDoc('late', 'running'), { ...summary('collecting', 31), exposures: 1204 }, '/admin'))
    .toMatchObject({ line: 'Running 31 days of 28 · 1,204 people so far', health: 'amber' })
  expect(homeCard(testDoc('late', 'running'), summary('collecting'), '/admin')).not.toHaveProperty('headline')
})

test.each(['draft', 'stopped'] as const)('the %s row uses the test-page readiness sentence', status => {
  const doc = { ...testDoc('setup', status), unitType: 'user' as const }
  for (const [code, sentence] of [
    ['no-primary-metric', 'Choose a goal.'],
    ['no-placements', 'Not on a page yet. Open a page, add an Experiment block and choose this test.'],
    ['no-planned-duration', 'Choose how long to run it.'],
    ['unit-source-mismatch', "This goal can't be measured for signed-in users. Choose another goal."],
  ] as const) {
    expect(homeCard(doc, { exposures: 0, days: 0, verdict: null, ready: false, next: { code } }, '/admin').line)
      .toBe(`Next: ${sentence}`)
  }
})

test('missing, unknown and non-actionable steps use the setup fallback; ready wins', () => {
  const notReady = { exposures: 0, days: 0, verdict: null, ready: false }
  const doc = testDoc('setup')
  expect(homeCard(doc, notReady, '/admin').line).toBe('Next: Review setup')
  for (const code of ['future-check', 'toString', 'invalid-status']) {
    const next = { code } as NonNullable<SummaryResponse[string]['next']>
    expect(homeCard(doc, { ...notReady, next }, '/admin').line).toBe('Next: Review setup')
  }
  expect(homeCard(doc, { ...notReady, ready: true, next: { code: 'no-primary-metric' } }, '/admin').line).toBe('Ready to start')
})

test.each([{ message: 'pg: password=hunter2' }, 'pg: password=hunter2'])('unexpected detail is never used as home copy (%j)', detail => {
  expect(homeCard(testDoc('setup'), { exposures: 0, days: 0, verdict: null, ready: false,
    next: { code: 'weights-total', detail } }, '/admin').line).toBe('Next: Fix the versions: check the group settings.')
})

test('page health moves a running test to Needs attention even without a verdict', () => {
  const doc = testDoc('page', 'running')
  const unavailable: SummaryResponse[string] = { exposures: 0, days: 0, verdict: null, health: [{ code: 'version-page-unavailable', path: '/page' }] }
  expect(healthDot(doc, unavailable)).toBe('red')
  expect(healthDot(doc, { ...unavailable, health: [{ code: 'version-page-unchecked', path: '/page' }] })).toBe('amber')
  expect(healthDot(doc, { ...summary('data-problem'), health: [{ code: 'version-page-unchecked', path: '/page' }] })).toBe('red')
  expect(groupTests([doc], { page: unavailable })[0]?.tests).toEqual([doc])
})

test('an unfinished whole-page draft has the Choose pages next step', () => {
  expect(homeCard({ ...testDoc('page'), kind: 'page' }, { exposures: 0, days: 0, verdict: null, ready: false, next: { code: 'page-no-targets' } }, '/admin'))
    .toMatchObject({ line: 'Next: Choose pages', href: '/admin/experiments/page', action: 'Continue setup' })
})
