import { expect, test } from 'vitest'
import { goalSlug, goalUsage, goalUsageRows, visibleGoalUsage } from '../../../src/admin/surface/goals/goals.model.js'
import { TEST_PAGE } from '../../../src/admin/copy/testPage.js'

test('usage counts tests once across all roles, preserving API id types', () => {
  const counts = goalUsage([
    { id: 1, name: 'First', metrics: { primary: 7, guardrails: [7, 'uuid'], secondary: [{ id: 7 }] } },
    { id: 2, name: 'Second', metrics: { secondary: [7, '7'] } },
    { id: 'third', name: 'Third', metrics: { guardrails: ['uuid'] } },
    { id: 3, name: 'Unused' },
  ])
  expect([...counts]).toEqual([[7, 2], ['uuid', 2], ['7', 1]])
})
test('short names are derived from names', () => {
  expect(goalSlug('  Gifts & Registrations!  ')).toBe('gifts-registrations')
  expect(goalSlug('Café completed')).toBe('cafe-completed')
})

test('usage rows keep all roles, dedupe readable tests and retain statuses', () => {
  const rows = goalUsageRows([
    { id: 'test/one', name: 'A clearer button', status: 'running', metrics: { primary: { id: 7 }, secondary: [7, 7], guardrails: [7] } },
    { id: 'test/one', name: 'A clearer button', status: 'running', metrics: { primary: 7 } },
    { id: 3, name: 'Other', status: 'stopped', metrics: { primary: '7' } },
  ], 7)
  expect(rows).toEqual([
    { id: 'test/one', name: 'A clearer button', status: 'Running', roles: ['Goal', 'Must not get worse', 'Also keep an eye on'] },
  ])
  expect(goalUsageRows([], 7)).toEqual([])
})
test('usage roles use plain labels while the test form marks optional fields', () => {
  const [row] = goalUsageRows([{ id: 1, name: 'First', metrics: { guardrails: [7], secondary: [7] } }], 7)
  expect(row!.roles).toEqual([TEST_PAGE.guardrailsShort, TEST_PAGE.secondaryShort])
  expect(TEST_PAGE.guardrailsShort).toBe('Must not get worse')
  expect(TEST_PAGE.secondaryShort).toBe('Also keep an eye on')
  expect(TEST_PAGE.guardrails).toBe(`${TEST_PAGE.guardrailsShort} (optional)`)
  expect(TEST_PAGE.secondary).toBe(`${TEST_PAGE.secondaryShort} (optional)`)
})
test('usage list shows five until expanded', () => {
  const rows = Array.from({ length: 7 }, (_, id) => id)
  expect(visibleGoalUsage(rows, false)).toEqual([0, 1, 2, 3, 4])
  expect(visibleGoalUsage(rows, true)).toEqual(rows)
  expect(visibleGoalUsage([1], false)).toEqual([1])
})
