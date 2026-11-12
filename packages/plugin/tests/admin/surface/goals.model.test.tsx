import { expect, test } from 'vitest'
import { goalSlug, goalUsage, goalUsageRows, visibleGoalUsage } from '../../../src/admin/surface/goals/goals.model.js'

test('usage counts tests once across all roles, preserving API id types', () => {
  const counts = goalUsage([
    { id: 1, metrics: { primary: 7, guardrails: [7, 'uuid'], secondary: [{ id: 7 }] } },
    { id: 2, metrics: { secondary: [7, '7'] } },
    { id: 'third', metrics: { guardrails: ['uuid'] } },
    { id: 3 },
  ])
  expect([...counts]).toEqual([[7, 2], ['uuid', 2], ['7', 1]])
})
test('short names are derived from names', () => {
  expect(goalSlug('  Gifts & Registrations!  ')).toBe('gifts-registrations')
  expect(goalSlug('Café completed')).toBe('cafe-completed')
})

test('usage rows keep all roles, dedupe tests and retain statuses and unreadable references', () => {
  const rows = goalUsageRows([
    { id: 'test/one', name: 'A clearer button', status: 'running', metrics: { primary: { id: 7 }, secondary: [7, 7], guardrails: [7] } },
    { id: 'test/one', name: 'A clearer button', status: 'running', metrics: { primary: 7 } },
    { id: 2, status: 'draft', metrics: { guardrails: [7] } },
    { id: 3, name: 'Other', status: 'stopped', metrics: { primary: '7' } },
  ], 7)
  expect(rows).toEqual([
    { id: 'test/one', name: 'A clearer button', canOpen: true, status: 'Running', roles: ['Goal', 'Must not get worse', 'Also keep an eye on'] },
    { id: 2, name: "A test you can't open", canOpen: false, status: 'Draft', roles: ['Must not get worse'] },
  ])
  expect(goalUsageRows([], 7)).toEqual([])
})
test('usage list shows five until expanded', () => {
  const rows = Array.from({ length: 7 }, (_, id) => id)
  expect(visibleGoalUsage(rows, false)).toEqual([0, 1, 2, 3, 4])
  expect(visibleGoalUsage(rows, true)).toEqual(rows)
  expect(visibleGoalUsage([1], false)).toEqual([1])
})
