import { expect, test } from 'vitest'
import { clickGoalBody, clickGoalCreateError, clickGoalSlug, definedClickGoals, goalSlug, hasSlugError, clickGoalOptions } from '../../src/goals/picker/clickGoalPicker.model.js'
import { CLICK_GOAL_COPY as C } from '../../src/goals/picker/copy.js'

test('shared prefill preserves the shipped slug rule and bounds click keys', () => {
  expect(goalSlug(' Caffè & gifts ')).toBe('caffe-gifts')
  expect(clickGoalSlug('x'.repeat(63) + ' abc')).toBe('x'.repeat(63))
  expect(clickGoalSlug('x'.repeat(80))).toHaveLength(64)
  expect(clickGoalSlug('🤍')).toBe('')
})
test('only click sources from a contains query become picker goals', () => {
  const goals = [{ id: 1, name: 'Join', slug: 'join', source: 'click:join' }, { id: 2, name: 'Other', slug: 'other', source: 'events:click:other' }]
  expect(definedClickGoals(goals)).toEqual([goals[0]])
})
test('options start with none and retain missing and malformed values without changing them', () => {
  const goals = [{ id: 1, name: 'Join', slug: 'join', source: 'click:join' }]
  expect(clickGoalOptions('ready', goals, '').options[0]).toEqual({ value: '', label: C.none })
  expect(clickGoalOptions('ready', goals, 'join').missing).toBe(false)
  for (const value of ['missing', 'BAD ?']) {
    expect(clickGoalOptions('ready', goals, value)).toEqual({ missing: true, options: [
      { value: '', label: C.none }, ...goals.map(goal => ({ value: goal.slug, label: goal.name })), { value, label: `${value} (missing)` },
    ] })
    expect(clickGoalOptions('loading', [], value)).toEqual({ missing: false, options: [{ value: '', label: C.none }, { value, label: value }] })
  }
})
test('create body fixes click direction and capping', () => {
  expect(clickGoalBody(' Join ', 'join')).toEqual({ name: 'Join', slug: 'join', source: 'click:join', direction: 'increase', attributionWindowHours: 168, minSampleSize: 150, capping: { type: null, value: null } })
})
test('client grammar comes first, then any server slug error is duplicate; all other text is authored', () => {
  const nested = { errors: [{ data: { errors: [{ path: 'slug', message: 'Value must be unique' }] } }] }
  expect(hasSlugError(nested)).toBe(true)
  expect(clickGoalCreateError('BAD', nested)).toEqual({ slug: C.slugRule })
  expect(clickGoalCreateError('join', nested)).toEqual({ slug: C.duplicateSlug })
  expect(clickGoalCreateError('join', { errors: [{ message: 'database internals' }] })).toEqual({ general: C.saveError })
})
