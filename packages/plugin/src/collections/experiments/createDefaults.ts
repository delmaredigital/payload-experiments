import type { CollectionBeforeValidateHook } from 'payload'
import { defaultArms } from './armInvariants.js'

export const createDefaults: CollectionBeforeValidateHook = ({ data, operation }) => {
  if (operation === 'create' && data && (!data.arms || (Array.isArray(data.arms) && data.arms.length === 0))) {
    data.arms = defaultArms(data.kind)
  }
  if (operation === 'create' && data && data.analysis?.plannedDurationDays == null) {
    data.analysis = { ...data.analysis, plannedDurationDays: 28 }
  }
  return data
}
