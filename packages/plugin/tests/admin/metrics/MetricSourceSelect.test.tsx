// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { MetricSourceSelect } from '../../../src/admin/MetricSourceSelect.js'
import { METRICS_COPY } from '../../../src/admin/copy/metrics.js'
import { payloadUiMock, resetPayloadUiMock, setField, setFormFields } from '../_helpers/payloadUiMock.js'

vi.mock('@payloadcms/ui', async () => (await import('../_helpers/payloadUiMock.js')).payloadUiMock())
afterEach(() => { cleanup(); resetPayloadUiMock() })
const field = { name: 'source', type: 'text' as const, admin: { custom: { sources: [
  { id: 'events:signup', label: 'Sign ups', kind: 'binomial', keyedBy: 'visitor' },
  { id: 'gifts', label: 'Gifts', kind: 'revenue', keyedBy: 'user' },
] } } }
test('select stores source ids, keeps source order and shows the revenue hint only when selected', () => {
  const setValue = vi.fn()
  setField({ value: 'events:signup', setValue })
  setFormFields({ unitType: { value: 'user' } })
  render(<MetricSourceSelect path="source" field={field} />)
  expect(screen.queryByText(METRICS_COPY.revenueHint)).toBeNull()
  expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['', 'Sign ups · yes/no', 'Gifts · amount'])
  fireEvent.change(screen.getByLabelText('Outcome source'), { target: { value: 'gifts' } })
  expect(setValue).toHaveBeenCalledWith('gifts')
  act(() => setField({ value: 'gifts', setValue }))
  expect(screen.getByText(METRICS_COPY.revenueHint)).toBeTruthy()
  expect(screen.queryByText(/mismatch|incompatible/i)).toBeNull()
})
test('honours read-only', () => {
  const setValue = vi.fn()
  setField({ value: 'gifts', setValue })
  render(<MetricSourceSelect path="source" field={field} readOnly />)
  expect((screen.getByRole('combobox') as HTMLSelectElement).disabled).toBe(true)
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'events:signup' } })
  expect(setValue).not.toHaveBeenCalled()
})
