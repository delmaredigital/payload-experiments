import type { ComponentConfig } from '@puckeditor/core'
import type { ExperimentSlotProps } from '../types/puck.js'
import { createExperimentSlotField } from './experimentSlotField.js'
import { pickerCopy } from './copy.js'

export const experimentSlotLabel = pickerCopy.label

export const experimentSlotFields: NonNullable<ComponentConfig<ExperimentSlotProps>['fields']> = {
  experiment: createExperimentSlotField(),
  control: { type: 'slot' },
  variantA: { type: 'slot' },
  variantB: { type: 'slot' },
  variantC: { type: 'slot' },
}

export const experimentSlotDefaultProps: NonNullable<ComponentConfig<ExperimentSlotProps>['defaultProps']> = {
  experiment: null, control: [], variantA: [], variantB: [], variantC: [],
}
