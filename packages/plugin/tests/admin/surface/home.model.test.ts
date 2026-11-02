import { expect, test } from 'vitest'
import { groupTests, healthDot, homeCard } from '../../../src/admin/surface/home.model.js'
import type { HomeTest } from '../../../src/admin/surface/home.model.js'
import type { SummaryResponse } from '../../../src/types/endpoints.js'

const testDoc = (id: string, status: HomeTest['status'] = 'draft'): HomeTest => ({ id, name: id, kind: 'flag', status, analysis: { plannedDurationDays: 28 } })
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
  expect(healthDot(testDoc('run'), undefined)).toBe('green')
  expect(healthDot({ ...testDoc('run'), analysis: null }, summary('collecting', 99))).toBe('green')
})
test('card copy, kind labels and actions are user-facing', () => {
  const running = homeCard(testDoc('x/y', 'running'), summary('collecting'), '/control')
  expect(running).toMatchObject({ kind: 'Setting', line: 'Running 5 days of 28 · 1,200 people so far', headline: 'A headline', href: '/control/experiments/x%2Fy/results', action: 'View results' })
  expect(homeCard(testDoc('ready'), { ...summary('collecting'), ready: true }, '/admin').line).toBe('Ready to start')
  expect(homeCard(testDoc('draft'), undefined, '/admin')).toMatchObject({ line: 'Next: finish setting up', action: 'Continue setup' })
  expect(homeCard(testDoc('stopped', 'stopped'), undefined, '/admin').action).toBe('Continue setup')
  expect(homeCard({ ...testDoc('decided', 'decided'), decidedAt: '2026-11-02T12:00:00Z', decision: { winnerArm: 'variantA' } }, undefined, '/admin').line).toBe('Decided 11/2/2026: Variant A')
  expect(homeCard(testDoc('archive', 'archived'), undefined, '/admin').action).toBe('Open')
  for (const [kind, label] of [['block', 'Page block'], ['flag', 'Setting'], ['code', 'Setting'], ['page', 'Whole page']] as const) {
    expect(homeCard({ ...testDoc('x'), kind }, undefined, '/admin').kind).toBe(label)
  }
})
test('search filters names case-insensitively across groups', () => {
  const groups = groupTests([testDoc('Hello'), testDoc('world', 'running')], {}, ' hELLo ')
  expect(groups.flatMap(group => group.tests.map(doc => doc.id))).toEqual(['Hello'])
})
