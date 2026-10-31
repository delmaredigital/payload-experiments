import type { Field } from 'payload'
import { XP_ARM_SELECT } from '../admin/paths.js'

export function createArmSelectField({ name = 'experimentArm', flagPoint, label, required }: {
  name?: string; flagPoint: string; label?: string; required?: boolean
}): Field {
  return {
    name, type: 'group', label: label ?? 'Experiment group',
    admin: { components: { Field: XP_ARM_SELECT }, custom: { flagPoint } },
    fields: [
      { name: 'experiment', type: 'relationship', relationTo: 'xp-experiments', admin: { hidden: true } },
      { name: 'arm', type: 'text', required, admin: { hidden: true } },
    ],
  }
}
