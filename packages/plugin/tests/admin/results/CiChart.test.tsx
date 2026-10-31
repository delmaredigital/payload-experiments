// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { CiChart } from '../../../src/admin/results/CiChart.js'
import { fixture, phaseFor } from './fixtures.js'

afterEach(cleanup)
const phase = phaseFor(fixture('T7'))
const series = ['variantA', 'variantB', 'holdout'].flatMap(arm => ['2026-10-29', '2026-10-30'].map(computedAt => ({
  arm, computedAt, metricId: 'registrations', lift: 0.1, ci: [null, 0.5] as [null, number],
})))
test('accessible summary and one labelled series per variant, with open bands reaching the domain edge', () => {
  const { container } = render(<CiChart series={series} metricId="registrations" metricName="Registrations" phase={phase} />)
  expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Registrations: lift and confidence intervals for Shorter form, One page form, Oct 29, 2026 to Oct 30, 2026.')
  expect(container.querySelectorAll('[data-series]')).toHaveLength(2)
  expect(container.querySelector('[data-series="holdout"]')).toBeNull()
  for (const group of container.querySelectorAll('[data-series]')) {
    expect(group.querySelector('title')?.textContent).toBeTruthy()
    expect(group.querySelector('[data-bound="lo"]')?.getAttribute('d')).toBe(' ')
    expect(group.querySelector('polygon')?.getAttribute('points')).toContain(',230')
  }
})
test('content-change dates reach the accessible summary without exposing editor or document ids', () => {
  const { container } = render(<CiChart series={series} metricId="registrations" metricName="Registrations" phase={phase}
    contentChanges={['2026-10-29T12:00:00Z', '2026-10-30T00:00:00Z', '2026-10-31T00:00:00Z'].map(at => ({ at, doc: { collection: 'pages', id: 'opaque-doc' }, by: 'opaque-editor-id' }))} />)
  expect(screen.getByRole('img').getAttribute('aria-label')).toContain('Content changed on Oct 29, 2026 and Oct 30, 2026.')
  expect(screen.getByRole('img').getAttribute('aria-label')).not.toContain('Oct 31')
  expect(screen.getByText('Content changed Oct 29, 2026 by an editor')).toBeTruthy()
  expect(container.innerHTML).not.toContain('opaque-editor-id')
  expect(container.innerHTML).not.toContain('opaque-doc')
})
test('series use neutral theme colours and legends use text colour with matching swatches', () => {
  const { container } = render(<CiChart series={series} metricId="registrations" metricName="Registrations" phase={phase} />)
  const groups = container.querySelectorAll('[data-series]')
  const legend = screen.getAllByRole('listitem')
  groups.forEach((group, index) => {
    const color = group.getAttribute('stroke')!
    expect(color).toMatch(/^var\(--theme-elevation-\d+\)$/)
    expect(legend[index]!.style.color).toBe('var(--theme-text)')
    const swatch = legend[index]!.querySelector('span')!
    expect(swatch.style.backgroundColor).toBe(color)
    expect(swatch.getAttribute('aria-hidden')).toBe('true')
  })
  expect(container.innerHTML).not.toMatch(/--theme-(success|warning|error)/)
})
test('empty history renders the given message', () => {
  render(<CiChart series={series.slice(0, 1)} metricId="registrations" metricName="Registrations" phase={phase} />)
  expect(screen.getByText('Not enough history yet.')).toBeTruthy()
  expect(screen.queryByRole('img')).toBeNull()
})
