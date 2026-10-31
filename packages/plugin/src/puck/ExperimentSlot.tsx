import type { ComponentConfig } from '@puckeditor/core'
import type { ExperimentSlotProps } from '../types/puck.js'
import { ViewportExposure } from '../client/ViewportExposure.js'
import { createExperimentSlotField } from './experimentSlotField.js'
import { slotToRender } from './slot.model.js'
import { pickerCopy } from './copy.js'

export const ExperimentSlot: ComponentConfig<ExperimentSlotProps> = {
  label: pickerCopy.label,
  fields: {
    experiment: createExperimentSlotField(),
    control: { type: 'slot' },
    variantA: { type: 'slot' },
    variantB: { type: 'slot' },
    variantC: { type: 'slot' },
  },
  defaultProps: { experiment: null, control: [], variantA: [], variantB: [], variantC: [] },
  render: props => {
    const Slot = props[slotToRender(props)]
    return <ViewportExposure expose={props.xpExpose}><Slot /></ViewportExposure>
  },
}
