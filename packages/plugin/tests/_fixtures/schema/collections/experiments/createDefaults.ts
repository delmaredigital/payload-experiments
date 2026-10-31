// Schema-only copy of CORE-02a ba8d1c703430d8908f13a3669a31f8e3bfb8a9b5; only external import paths adjusted.
import type { CollectionBeforeValidateHook } from 'payload'

export const createDefaults: CollectionBeforeValidateHook = ({ data, operation }) => {
  if (operation === 'create' && data && (!data.arms || (Array.isArray(data.arms) && data.arms.length === 0))) {
    data.arms = [
      { key: 'control', label: 'Original', weight: 50, kind: 'control', slot: 'control' },
      { key: 'variantA', label: 'Variant A', weight: 50, kind: 'variant', slot: 'variantA' },
    ]
  }
  return data
}
