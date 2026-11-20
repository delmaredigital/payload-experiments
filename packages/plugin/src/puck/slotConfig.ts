import type { ComponentConfig } from '@puckeditor/core'
import { EXPERIMENT_SLOT_TYPE, type ExperimentSlotProps } from '../types/puck.js'
import { createExperimentSlotField } from './experimentSlotField.js'
import { slotLabels } from './copy.js'

export const experimentSlotLabel = 'Experiment block'

export const experimentSlotFields: NonNullable<ComponentConfig<ExperimentSlotProps>['fields']> = {
  experiment: createExperimentSlotField(),
  // Puck 0.24's defaultSlots prepends each slot, reversing declaration order in the outline.
  variantC: { type: 'slot', label: slotLabels.variantC, disallow: [EXPERIMENT_SLOT_TYPE] },
  variantB: { type: 'slot', label: slotLabels.variantB, disallow: [EXPERIMENT_SLOT_TYPE] },
  variantA: { type: 'slot', label: slotLabels.variantA, disallow: [EXPERIMENT_SLOT_TYPE] },
  control: { type: 'slot', label: slotLabels.control, disallow: [EXPERIMENT_SLOT_TYPE] },
}

export const experimentSlotDefaultProps: NonNullable<ComponentConfig<ExperimentSlotProps>['defaultProps']> = {
  experiment: null, control: [], variantA: [], variantB: [], variantC: [],
}
