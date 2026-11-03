import { expect, test } from 'vitest'
import { formatDate } from '../../../src/admin/format/date.js'

test.each(['2026-10-25T12:00:00Z', Date.UTC(2026, 9, 25, 12), new Date('2026-10-25T12:00:00Z')])('dates use the same day-month-year format: %s', value => {
  expect(formatDate(value)).toBe('25 Oct 2026')
})
test('dates use UTC across a local calendar boundary', () => {
  expect(formatDate('2026-10-25T23:30:00-04:00')).toBe('26 Oct 2026')
})
test.each(['bad', '', null, undefined, NaN, Infinity, {}, new Date(NaN)])('invalid date returns an em dash: %s', value => {
  expect(formatDate(value)).toBe('—')
})
