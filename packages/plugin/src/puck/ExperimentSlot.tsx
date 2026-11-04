import type { ComponentConfig } from '@puckeditor/core'
import type { ExperimentSlotProps } from '../types/puck.js'
import { ViewportExposure } from '../client/ViewportExposure.js'
import { experimentSlotDefaultProps, experimentSlotFields, experimentSlotLabel } from './slotConfig.js'
import { createExperimentSlotField } from './experimentSlotField.js'
import { resolvePuckRoutes, type PuckRoutes } from './routes.js'
import { slotToRender } from './slot.model.js'

export function createExperimentSlot({ routes: inputRoutes }: { routes?: PuckRoutes } = {}): ComponentConfig<ExperimentSlotProps> {
  const routes = resolvePuckRoutes(inputRoutes)
  return {
    label: experimentSlotLabel,
    fields: { ...experimentSlotFields, experiment: createExperimentSlotField({ routes }) },
    defaultProps: experimentSlotDefaultProps,
    render: props => {
      const Slot = props[slotToRender(props)]
      return <ViewportExposure expose={props.xpExpose}><Slot /></ViewportExposure>
    },
  }
}

export const ExperimentSlot = createExperimentSlot()
