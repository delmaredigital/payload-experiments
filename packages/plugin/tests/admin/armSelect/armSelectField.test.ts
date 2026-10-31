import { expect, test } from 'vitest'
import { createArmSelectField } from '../../../src/fields/armSelect.js'
import { XP_ARM_SELECT } from '../../../src/admin/paths.js'

test('factory defaults and hidden storage fields', () => {
  expect(createArmSelectField({ flagPoint: 'donation' })).toEqual({
    name: 'experimentArm', type: 'group', label: 'Experiment group',
    admin: { components: { Field: XP_ARM_SELECT }, custom: { flagPoint: 'donation' } },
    fields: [
      { name: 'experiment', type: 'relationship', relationTo: 'xp-experiments', admin: { hidden: true } },
      { name: 'arm', type: 'text', required: undefined, admin: { hidden: true } },
    ],
  })
})
test('preserves the host name, label and required setting on the group choice', () => {
  const field = createArmSelectField({ name: 'group', flagPoint: 'ask', label: 'Version', required: true })
  expect(field).toMatchObject({ name: 'group', label: 'Version', fields: [
    { name: 'experiment', admin: { hidden: true } }, { name: 'arm', required: true, admin: { hidden: true } },
  ] })
})
