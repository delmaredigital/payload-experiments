import { expect, test } from 'vitest'
import { goalSlug, goalUsage } from '../../../src/admin/surface/goals/goals.model.js'

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
