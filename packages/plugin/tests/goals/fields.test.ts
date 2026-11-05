import { expect, test, vi } from 'vitest'
import { xpGoalField } from '../../src/fields/xpGoal.js'
import { xpGoalPuckField } from '../../src/puck/xpGoalField.js'
import { clickKeys } from '../../src/goals/cache.js'
import { fakePayload } from '../_fakes/payload.js'
import { fakeReq } from '../_fakes/req.js'
import { sampleOptions, validate } from '../collections/fixtures.js'
vi.mock('../../src/goals/cache.js', () => ({ clickKeys: vi.fn(async () => new Set(['join'])) }))

test('field config keeps L3 semantics and adds only the picker component', async () => {
  const field = xpGoalField()
  expect(field).toMatchObject({ name: 'xpGoal', type: 'text' })
  expect(field.admin?.components).toEqual({ Field: '@delmaredigital/payload-experiments/admin/client#XpGoalField' })
  const { components, ...admin } = field.admin!
  expect({ ...field, admin, validate: undefined }).toEqual({ name: 'xpGoal', label: 'Click goal', type: 'text', admin: { description: 'Choose the short name of the click goal to count here.' }, validate: undefined })
  expect(xpGoalPuckField()).toEqual({ type: 'text', label: 'Click goal' })
  const options = sampleOptions(), req = fakeReq({ payload: fakePayload({ config: { custom: { xp: options } } }) })
  expect(await validate(field.validate, 'join', { req })).toBe(true)
  expect(await validate(field.validate, 'missing', { req })).toBe('No click goal has this name yet. Create it with "+ New click goal".')
  expect(await validate(field.validate, '', { req })).toBe(true)
  expect(await validate(field.validate, 'BAD', { req })).toBe('Use a click goal short name.')
  vi.mocked(clickKeys).mockClear()
  options.access.manage = () => false
  expect(await validate(field.validate, 'missing', { req })).toBe(true)
  expect(clickKeys).not.toHaveBeenCalled()
})
