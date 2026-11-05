import type { DocId } from './contracts.js'
import type { ComponentConfig, Config, Plugin, Slot } from '@puckeditor/core'
export type { Slot } from '@puckeditor/core'
export type ArmSlot = 'control' | 'variantA' | 'variantB' | 'variantC'
export type ExperimentRef = { id: DocId; slug: string }
export type ExperimentSlotProps = {
  experiment: ExperimentRef | null; control: Slot; variantA: Slot; variantB: Slot; variantC: Slot
  xpArm?: string; xpSlot?: ArmSlot; xpExpose?: { slug: string; arm: string; phase: number }
}
export const EXPERIMENT_SLOT_TYPE = 'ExperimentSlot' as const

export interface ExperimentsPuckIntegration {
  name: string
  components: Record<string, ComponentConfig<ExperimentSlotProps>>
  categories: Config['categories']
  plugins?: readonly Plugin[]
}
