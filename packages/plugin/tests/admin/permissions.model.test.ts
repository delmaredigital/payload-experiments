import { expect, test } from 'vitest'
import { canManage } from '../../src/admin/permissions.model.js'

test.each([true, { permission: true }])('can manage: %j', update => {
  expect(canManage({ collections: { 'xp-experiments': { update } } })).toBe(true)
})
test.each([false, { permission: false }, {}, undefined])('cannot manage: %j', update => {
  expect(canManage({ collections: { 'xp-experiments': { update } } })).toBe(false)
})
test('missing permissions', () => {
  for (const permissions of [undefined, null, {}, { collections: {} }, { collections: { 'xp-experiments': {} } }]) {
    expect(canManage(permissions)).toBe(false)
  }
})
