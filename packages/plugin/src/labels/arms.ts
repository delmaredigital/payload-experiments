import type { ArmKey } from '../types/contracts.js'

export const ARM_LABELS = {
  control: 'Original', variantA: 'Variant A', variantB: 'Variant B', variantC: 'Variant C', holdout: 'Holdout',
} as const satisfies Record<ArmKey, string>
