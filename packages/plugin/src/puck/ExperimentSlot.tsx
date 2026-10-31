import type { ComponentConfig } from '@puckeditor/core'
import type { ExperimentSlotProps } from '../types/puck.js'
import { ViewportExposure } from '../client/ViewportExposure.js'
import { experimentSlotDefaultProps, experimentSlotFields, experimentSlotLabel } from './slotConfig.js'
import { slotToRender } from './slot.model.js'

export const ExperimentSlot: ComponentConfig<ExperimentSlotProps> = {
  label: experimentSlotLabel,
  fields: experimentSlotFields,
  defaultProps: experimentSlotDefaultProps,
  render: props => {
    const Slot = props[slotToRender(props)]
    return <ViewportExposure expose={props.xpExpose}><Slot /></ViewportExposure>
  },
}
