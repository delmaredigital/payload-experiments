// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { URL as NodeURL } from 'node:url'
import { afterEach, expect, test } from 'vitest'
import { VerdictHero } from '../../../src/admin/results/VerdictHero.js'
import { DataTable } from '../../../src/admin/results/DataTable.js'
import { StatTile } from '../../../src/admin/results/StatTile.js'
import { armRows, verdictCard } from '../../../src/admin/results/results.model.js'
import { fixture, phaseFor, revenueSnapshot } from './fixtures.js'
afterEach(cleanup)

test.each(['T4', 'T7', 'T5', 'T2'])('%s hero preserves the exact verdict headline and detail', name => {
  const snapshot = fixture(name)
  render(<VerdictHero model={verdictCard({ snapshot, isDecidedTestRound: false, winnerLabel: '' })} meta={<span>Round 1</span>} />)
  expect(screen.getByRole('heading', { name: snapshot.verdict.headline })).toBeTruthy()
  expect(screen.getByText(snapshot.verdict.detail)).toBeTruthy()
  expect(screen.getByText('Round 1').closest('.xp-verdict-meta')).toBeTruthy()
})

test.each([null, 'variantA'])('table shows Rate and Conversions with explicit leader %s', leader => {
  const snapshot = fixture('T7-bayesian'), phase = phaseFor(snapshot)
  const rows = armRows({ snapshot, phase, metricId: 'registrations' })
  const { container } = render(<DataTable rows={rows} caption="Registrations" method={snapshot.method} metricKind="binomial" primary leader={leader} />)
  expect(screen.getAllByRole('columnheader').map(el => el.textContent)).toEqual(['Group', 'People', 'Conversions', 'Rate', 'Lift', 'Confidence interval', 'Chance to win'])
  expect(container.textContent).not.toContain('Mean')
  expect(container.querySelectorAll('.is-lead')).toHaveLength(leader ? 1 : 0)
  for (const row of rows) {
    const cells = within(screen.getByRole('rowheader', { name: row.key === 'holdout' ? `${row.label} ${row.baseline}` : row.label }).parentElement!).getAllByRole('cell')
    expect(cells.map(el => el.textContent)).toEqual([row.n, row.value, row.rate, row.baseline ? '—' : row.lift ?? '—', row.baseline ? '—' : row.comparison?.ci ?? '—', row.baseline ? '—' : row.chanceToWin ?? '—'])
    expect(cells.every(el => el.classList.contains('num'))).toBe(true)
  }
})
test('amount table says Average and preserves capping; secondary tables omit conversions and chance', () => {
  const snapshot = revenueSnapshot(), phase = phaseFor(snapshot)
  const { container } = render(<DataTable rows={armRows({ snapshot, phase, metricId: 'gifts' })} caption="Gifts" method={snapshot.method} metricKind="revenue" />)
  expect(screen.getAllByRole('columnheader').map(el => el.textContent)).toEqual(['Group', 'People', 'Average', 'Lift', 'Confidence interval'])
  expect(container.textContent).not.toContain('Mean')
  expect(screen.getAllByText('0 capped at $100.00')).toHaveLength(snapshot.metrics[0]!.perArm.length)
})
test('StatTile separates the large stored value and label', () => {
  const { container } = render(<StatTile label="Days" value="9 of 28" />)
  expect(container.querySelector('.xp-stat-tile-label')?.textContent).toBe('Days')
  expect(container.querySelector('.xp-stat-tile-value')?.textContent).toBe('9 of 28')
})

test('table scroll region is named, keyboard focusable and cues only the remaining scroll directions', () => {
  const snapshot = fixture('T7-bayesian'), phase = phaseFor(snapshot)
  const { unmount } = render(<DataTable rows={armRows({ snapshot, phase, metricId: 'registrations' })} caption="Registrations" method="bayesian" metricKind="binomial" primary />)
  const region = screen.getByRole('region', { name: 'Registrations' })
  expect(region.tabIndex).toBe(0)
  expect(within(region).getByRole('table', { name: 'Registrations' })).toBeTruthy()
  const frame = region.parentElement!
  Object.defineProperties(region, { clientWidth: { configurable: true, value: 390 }, scrollWidth: { value: 1000 } })
  fireEvent(window, new Event('resize'))
  expect(frame.classList.contains('has-right')).toBe(true)
  expect(frame.classList.contains('has-left')).toBe(false)
  fireEvent.scroll(region, { target: { scrollLeft: 200 } })
  expect(frame.classList.contains('has-right')).toBe(true)
  expect(frame.classList.contains('has-left')).toBe(true)
  fireEvent.scroll(region, { target: { scrollLeft: 610 } })
  expect(frame.classList.contains('has-right')).toBe(false)
  expect(frame.classList.contains('has-left')).toBe(true)
  Object.defineProperty(region, 'clientWidth', { value: 1000 })
  fireEvent.scroll(region, { target: { scrollLeft: 0 } })
  fireEvent(window, new Event('resize'))
  expect(frame.classList.contains('has-right')).toBe(false)
  expect(frame.classList.contains('has-left')).toBe(false)
  unmount()
})

test('table CSS scrolls horizontally, pins Group and draws token-based edge cues above the cells', () => {
  const css = readFileSync(new NodeURL('../../../src/admin/results/results.css', import.meta.url), 'utf8')
  const rule = (selector: string) => css.slice(css.indexOf('\n' + selector)).split('}')[0]!
  expect(rule('.xp-data-table-wrap {')).toMatch(/overflow-x:\s*auto/)
  const pinned = rule('.xp-data-table tr > :first-child {')
  expect(pinned).toMatch(/position:\s*sticky/)
  expect(pinned).toMatch(/left:\s*0/)
  expect(pinned).toContain('background: var(--xp-surface)')
  expect(rule('.xp-data-table-frame::before, .xp-data-table-frame::after {')).toContain('pointer-events: none')
  expect(rule('.xp-data-table-frame::before {')).toContain('linear-gradient(to right, var(--xp-border-strong), transparent)')
  expect(rule('.xp-data-table-frame::after {')).toContain('linear-gradient(to left, var(--xp-border-strong), transparent)')
  expect(rule('.xp-data-table-frame.has-left::before, .xp-data-table-frame.has-right::after {')).toContain('opacity: 1')
})
