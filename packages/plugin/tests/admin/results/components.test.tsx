// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { ArmTable } from '../../../src/admin/results/ArmTable.js'
import { CappedCell } from '../../../src/admin/results/CappedCell.js'
import { DataQualityPanel } from '../../../src/admin/results/DataQualityPanel.js'
import { VerdictCard } from '../../../src/admin/results/VerdictCard.js'
import { armRows, cappedCell, collectingLine, dataQuality, guardrailChips, powerLine, rolloutLine, verdictCard } from '../../../src/admin/results/results.model.js'
import { RESULTS_COPY } from '../../../src/admin/copy/results.js'
import { fixture, fixtures, phaseFor, revenueSnapshot } from './fixtures.js'

afterEach(cleanup)

test.each(Object.keys(fixtures))('%s verdict card renders the exact server headline and model lines', name => {
  const snapshot = fixture(name)
  const model = verdictCard({ snapshot, isDecidedTestRound: false, winnerLabel: 'Shorter form' })
  render(<VerdictCard model={model} guardrails={guardrailChips(snapshot)} power={powerLine(snapshot.power)} collecting={collectingLine(snapshot)} sinceShipping={rolloutLine(snapshot, phaseFor(snapshot), { winnerArm: 'variantA' })} />)
  expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(snapshot.verdict.headline)
  expect(screen.getByText(snapshot.verdict.detail)).toBeTruthy()
  if (snapshot.verdict.guardrailLine) expect(screen.getByText(snapshot.verdict.guardrailLine)).toBeTruthy()
  expect(screen.getByText(powerLine(snapshot.power))).toBeTruthy()
  for (const chip of guardrailChips(snapshot)) expect(screen.getByText(`${chip.name}: ${chip.status}`)).toBeTruthy()
})
test.each(['T3', 'T5', 'T6', 'T8', 'T9'])('decided %s card renders finding without action', name => {
  const snapshot = fixture(name)
  const { container } = render(<VerdictCard model={verdictCard({ snapshot: fixture('R3'), decisionSnapshot: snapshot, isDecidedTestRound: true, winnerLabel: 'Shorter form' })} />)
  expect(screen.getByRole('heading').textContent).toBe('Decided: Shorter form')
  expect(screen.getByText(snapshot.verdict.finding)).toBeTruthy()
  if (snapshot.verdict.action) expect(container.textContent).not.toContain(snapshot.verdict.action)
})
test('no guardrails means no invented guardrail line', () => {
  const snapshot = fixture('T4')
  snapshot.guardrails = []
  delete snapshot.verdict.guardrailLine
  const { container } = render(<VerdictCard model={verdictCard({ snapshot, isDecidedTestRound: false, winnerLabel: '' })} />)
  expect(container.querySelector('.xp-guardrails')).toBeNull()
  expect(container.textContent).not.toContain('No harm detected')
})
test.each(['T7', 'T7-adjusted', 'T7-bayesian', 'R3'])('%s table is captioned with column and row header scopes and model values', name => {
  const snapshot = fixture(name)
  const phase = phaseFor(snapshot)
  const rows = armRows({ snapshot, phase, metricId: 'registrations' })
  const { container } = render(<ArmTable rows={rows} caption="Registrations" method={snapshot.method} metricKind="binomial" showAdjusted={snapshot.alpha !== snapshot.alphaAdjusted} />)
  const table = screen.getByRole('table', { name: 'Registrations' })
  for (const header of within(table).getAllByRole('columnheader')) expect(header.getAttribute('scope')).toBe('col')
  for (const header of within(table).getAllByRole('rowheader')) expect(header.getAttribute('scope')).toBe('row')
  expect(within(table).getAllByRole('rowheader').map(header => header.textContent)).toEqual(phase.arms.map(arm => arm.label))
  for (const row of rows) {
    const tr = screen.getByRole('rowheader', { name: row.label }).parentElement!
    expect(tr.textContent).toContain(row.n)
    expect(tr.textContent).toContain(row.value)
    if (row.comparison) for (const [key, value] of Object.entries(row.comparison)) if (key !== 'method') expect(tr.textContent).toContain(value)
  }
  const holdout = screen.getByRole('rowheader', { name: 'Unchanged form' }).parentElement!
  expect(holdout.children).toHaveLength(4) // name, people, outcome, spanning baseline cell
  expect(holdout.textContent).toContain(RESULTS_COPY.holdout)
  expect(holdout.querySelector('.xp-chip')).toBeNull()
  if (snapshot.method === 'bayesian') {
    expect(screen.getByRole('columnheader', { name: 'Chance to win' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Risk' })).toBeTruthy()
    expect(screen.queryByRole('columnheader', { name: 'Lift' })).toBeNull()
    expect(screen.queryByRole('columnheader', { name: 'p-value' })).toBeNull()
  }
  expect(container.textContent?.includes('Adjusted confidence interval')).toBe(snapshot.alpha !== snapshot.alphaAdjusted)
})
test('capped cell renders every model line including zero; table uses it for revenue', () => {
  const snapshot = revenueSnapshot()
  const metric = snapshot.metrics[0]!
  const model = cappedCell({ metric, arm: metric.perArm[0], caps: snapshot.params.caps })
  const { unmount } = render(<CappedCell model={model} />)
  expect(screen.getByText('$12.50')).toBeTruthy()
  expect(screen.getByText('Total $12,345.00 (not capped)')).toBeTruthy()
  expect(screen.getByText('0 capped at $100.00')).toBeTruthy()
  unmount()
  render(<ArmTable rows={armRows({ snapshot, phase: phaseFor(snapshot), metricId: 'gifts' })} caption="Gifts" method="sequential" metricKind="revenue" />)
  expect(screen.getAllByText('0 capped at $100.00')).toHaveLength(snapshot.metrics[0]!.perArm.length)
})
test('no-history cell renders the verbatim notice before the first snapshot', () => {
  render(<CappedCell model={cappedCell({ metric: { metricId: 'gifts', kind: 'revenue', capNotice: 'no-history' } })} />)
  expect(screen.getByText(RESULTS_COPY.noCap)).toBeTruthy()
})
test('quality panel renders each model item, its details, shares, and next step', () => {
  const snapshot = fixture('T2')
  snapshot.exposures.armMismatch = 5
  const items = dataQuality(snapshot, { phase: phaseFor(snapshot), inLayer: true, layerSlices: 10, allocation: 50 })
  render(<DataQualityPanel items={items} />)
  expect(screen.getByRole('region', { name: 'Data quality' })).toBeTruthy()
  for (const item of items) {
    expect(screen.getByText(item.message)).toBeTruthy()
    expect(screen.getByText(item.nextStep)).toBeTruthy()
    if (item.detail) expect(screen.getByText(item.detail)).toBeTruthy()
    for (const share of item.shares ?? []) expect(screen.getByText(share)).toBeTruthy()
  }
})
test('empty quality panel renders nothing', () => {
  const { container } = render(<DataQualityPanel items={[]} />)
  expect(container.textContent).toBe('')
})
