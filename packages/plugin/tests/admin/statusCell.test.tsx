// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { payloadUiMock } from './_helpers/payloadUiMock.js'
import { StatusCell } from '../../src/admin/StatusCell.js'

vi.mock('@payloadcms/ui', () => payloadUiMock())
afterEach(cleanup)
test('renders the pill from cell data and uses row data for its tooltip', () => {
  render(<StatusCell cellData="decided" rowData={{ arms: [{ key: 'holdout' }], decision: { winnerArm: 'variantA' } }}
    collectionSlug="xp-experiments" field={{ name: 'status', type: 'text' }} />)
  const pill = screen.getByText('Decided')
  expect(pill.className).toContain('xp-status-pill--info')
  expect(screen.getByTitle('Decided — everyone sees the winner, except the holdout').contains(pill)).toBe(true)
})
test('running pill', () => {
  render(<StatusCell cellData="running" rowData={{}} collectionSlug="xp-experiments" field={{ name: 'status', type: 'text' }} />)
  expect(screen.getByTitle('Running').textContent).toBe('Running')
  expect(screen.getByText('Running').className).toContain('xp-status-pill--success')
})

test('a released holdout uses the plain decided tooltip from row data', () => {
  render(<StatusCell cellData="decided" rowData={{ arms: [{ key: 'holdout' }], decision: { winnerArm: 'variantA', holdoutReleasedAt: '2026-10-30T21:22:00Z' } }}
    collectionSlug="xp-experiments" field={{ name: 'status', type: 'text' }} />)
  expect(screen.getByTitle('Decided — everyone sees the winner').textContent).toBe('Decided')
})
