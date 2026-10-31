import type { CollectionBeforeValidateHook } from 'payload'

export const createDefaults: CollectionBeforeValidateHook = ({ data, operation }) => {
  if (operation === 'create' && data && (!data.arms || (Array.isArray(data.arms) && data.arms.length === 0))) {
    data.arms = [
      { key: 'control', label: 'Original', weight: 50, kind: 'control', ...(data.kind === 'block' ? { slot: 'control' } : {}) },
      { key: 'variantA', label: 'Variant A', weight: 50, kind: 'variant', ...(data.kind === 'block' ? { slot: 'variantA' } : {}) },
    ]
  }
  return data
}
