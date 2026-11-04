// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { DataTable as ArmTable } from '../../../src/admin/results/DataTable.js'
import { CappedCell } from '../../../src/admin/results/CappedCell.js'
import { DataQualityPanel } from '../../../src/admin/results/DataQualityPanel.js'
import { VerdictHero as VerdictCard } from '../../../src/admin/results/VerdictHero.js'
import { armRows, cappedCell, collectingLine, dataQuality, guardrailChips, powerLine, rolloutLine, verdictCard } from '../../../src/admin/results/results.model.js'
import { RESULTS_COPY } from '../../../src/admin/copy/results.js'
import { fixture, fixtures, phaseFor, revenueSnapshot } from './fixtures.js'

afterEach(cleanup)

test.each(['T4', 'T4-stopped'])('%s verdict card omits the old duplicate counts', name => {
  const snapshot = fixture(name)
  const collecting = collectingLine({ snapshot, phaseKind: 'test', status: name === 'T4' ? 'running' : 'stopped' })
  const { container } = render(<VerdictCard model={verdictCard({ snapshot, isDecidedTestRound: false, winnerLabel: '' })} collecting={collecting} />)
  expect(screen.getByText(snapshot.verdict.detail)).toBeTruthy()
  expect(container.querySelector('.xp-collecting')).toBeNull()
  expect(container.textContent).not.toContain('360 of 1,000 people, 37 of 150 conversions')
})

test.each(Object.keys(fixtures))('%s verdict card renders the exact server headline and model lines', name => {
  const snapshot = fixture(name)
  const model = verdictCard({ snapshot, isDecidedTestRound: false, winnerLabel: 'Shorter form' })
  const phase = phaseFor(snapshot)
  const input = { snapshot, phaseKind: snapshot.phaseKind, status: name === 'T4-stopped' ? 'stopped' as const : snapshot.phaseKind === 'rollout' ? 'decided' as const : 'running' as const }
  const power = powerLine(input)
  const collecting = collectingLine(input)
  const { container } = render(<VerdictCard model={model} guardrails={guardrailChips(snapshot)} power={power} collecting={collecting} sinceShipping={rolloutLine(snapshot, phase, [phase], { winnerArm: 'variantA' })} />)
  expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(snapshot.verdict.headline)
  expect(screen.getByText(snapshot.verdict.detail)).toBeTruthy()
  if (snapshot.verdict.guardrailLine) expect(screen.getByText(snapshot.verdict.guardrailLine)).toBeTruthy()
  expect(container.querySelector('.xp-power')?.textContent ?? null).toBe(power)
  expect(container.querySelector('.xp-collecting')?.textContent ?? null).toBe(collecting)
  for (const chip of guardrailChips(snapshot)) expect(screen.getByText(`${chip.name}: ${chip.status}`)).toBeTruthy()
})
test.each(['T3', 'T5', 'T6', 'T8', 'T9'])('decided %s card renders finding without action', name => {
  const snapshot = fixture(name)
  const { container } = render(<VerdictCard model={verdictCard({ snapshot: fixture('R3'), decisionSnapshot: snapshot, isDecidedTestRound: true, winnerLabel: 'Shorter form' })} power={RESULTS_COPY.plannedEnd} collecting="360 of 1,000 people, 37 of 150 conversions" />)
  expect(screen.getByRole('heading').textContent).toBe('Decided: Shorter form')
  expect(screen.getByText(snapshot.verdict.finding)).toBeTruthy()
  if (snapshot.verdict.action) expect(container.textContent).not.toContain(snapshot.verdict.action)
  expect(container.querySelector('.xp-power')).toBeNull()
  expect(container.querySelector('.xp-collecting')).toBeNull()
  expect(container.textContent).not.toContain(RESULTS_COPY.plannedEnd)
  expect(container.textContent).not.toContain('360 of 1,000 people')
})
test('no guardrails means no invented guardrail line', () => {
  const snapshot = fixture('T7')
  expect(snapshot.verdict.guardrailLine).toBe('No harm detected so far')
  snapshot.guardrails = []
  delete snapshot.verdict.guardrailLine
  const { container } = render(<VerdictCard model={verdictCard({ snapshot, isDecidedTestRound: false, winnerLabel: '' })} />)
  expect(container.querySelector('.xp-guardrails')).toBeNull()
  expect(container.textContent).not.toContain('No harm detected')
})
test.each(['T7', 'T7-adjusted', 'T7-bayesian', 'R3'])('%s table is captioned with column and row header scopes and model values', name => {
  const snapshot = fixture(name)
  const phase = phaseFor(snapshot)
  phase.arms.reverse()
  const rows = armRows({ snapshot, phase, metricId: 'registrations' })
  render(<ArmTable rows={rows} caption="Registrations" method={snapshot.method} metricKind="binomial" primary />)
  const table = screen.getByRole('table', { name: 'Registrations' })
  for (const header of within(table).getAllByRole('columnheader')) expect(header.getAttribute('scope')).toBe('col')
  for (const header of within(table).getAllByRole('rowheader')) expect(header.getAttribute('scope')).toBe('row')
  expect(within(table).getAllByRole('rowheader').map(header => header.textContent)).toEqual(rows.map(row => row.label + (row.key === 'holdout' ? row.baseline : '')))
  for (const row of rows) {
    const tr = screen.getByRole('rowheader', { name: row.key === 'holdout' ? `${row.label} ${row.baseline}` : row.label }).parentElement!
    const comparison = row.comparison
    const cells = [row.n, row.value, row.rate, row.baseline ? '—' : row.lift ?? '—',
      row.baseline ? '—' : comparison?.method === 'sequential' ? comparison.adjustedCI ?? comparison.ci : comparison?.ci ?? '—',
      row.baseline ? '—' : row.chanceToWin ?? '—']
    expect(within(tr).getAllByRole('cell').map(cell => cell.textContent)).toEqual(cells)
  }
  expect(screen.getByRole('columnheader', { name: 'Rate' })).toBeTruthy()
  expect(screen.getByRole('columnheader', { name: 'Lift' })).toBeTruthy()
  expect(screen.getByRole('columnheader', { name: 'Chance to win' })).toBeTruthy()
  expect(screen.queryByRole('columnheader', { name: 'Mean' })).toBeNull()
})
test('sequential confidence intervals use stored adjusted bounds when present', () => {
  const snapshot = fixture('T7-adjusted')
  const rows = armRows({ snapshot, phase: phaseFor(snapshot), metricId: 'registrations' })
  const { rerender } = render(<ArmTable rows={rows} caption="Registrations" method="sequential" metricKind="binomial" primary />)
  const ciCell = () => within(screen.getByRole('rowheader', { name: 'Shorter form' }).parentElement!).getAllByRole('cell')[4]!.textContent
  const comparison = rows.find(row => row.key === 'variantA')!.comparison!
  if (comparison.method !== 'sequential') throw new Error('Expected sequential fixture')
  expect(ciCell()).toBe(comparison.adjustedCI)
  delete comparison.adjustedCI
  rerender(<ArmTable rows={rows} caption="Registrations" method="sequential" metricKind="binomial" primary />)
  expect(ciCell()).toBe(comparison.ci)
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
test('empty quality panel is collapsed with OK summary', () => {
  const { container } = render(<DataQualityPanel items={[]} />)
  expect(container.querySelector('details')?.open).toBe(false)
  expect(screen.getByText('OK')).toBeTruthy()
})

test.each([
  ['T7', 'Measured, not compared'],
  ['R3', 'Holdout · baseline'],
])('%s table explains the holdout under its label', (name, explanation) => {
  const snapshot = fixture(name)
  render(<ArmTable rows={armRows({ snapshot, phase: phaseFor(snapshot), metricId: 'registrations' })} caption="Registrations" method={snapshot.method} metricKind="binomial" primary />)
  const holdout = screen.getByRole('rowheader', { name: `Unchanged form ${explanation}` })
  expect(within(holdout).getByText(explanation).classList.contains('muted')).toBe(true)
})
test.each([true, false])('table enforces primary-only lead emphasis (primary: %s)', primary => {
  const snapshot = fixture('T7')
  const { container } = render(<ArmTable rows={armRows({ snapshot, phase: phaseFor(snapshot), metricId: 'registrations' })} caption="Registrations" method={snapshot.method} metricKind="binomial" primary={primary} leader="variantA" />)
  expect(container.querySelectorAll('.is-lead')).toHaveLength(primary ? 1 : 0)
})
