import type { ComponentConfig } from '@puckeditor/core'
import type { ExperimentSlotProps } from '../types/puck.js'
import { createExperimentSlotField } from './experimentSlotField.js'
import { pickerCopy, slotLabels } from './copy.js'

export const experimentSlotLabel = pickerCopy.label

export const experimentSlotFields: NonNullable<ComponentConfig<ExperimentSlotProps>['fields']> = {
  experiment: createExperimentSlotField(),
  // Puck 0.24's defaultSlots prepends each slot, reversing declaration order in the outline.
  variantC: { type: 'slot', label: slotLabels.variantC },
  variantB: { type: 'slot', label: slotLabels.variantB },
  variantA: { type: 'slot', label: slotLabels.variantA },
  control: { type: 'slot', label: slotLabels.control },
}

export const experimentSlotDefaultProps: NonNullable<ComponentConfig<ExperimentSlotProps>['defaultProps']> = {
  experiment: null, control: [], variantA: [], variantB: [], variantC: [],
}
