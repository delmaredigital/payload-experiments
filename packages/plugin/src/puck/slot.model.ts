import type { ArmSlot, ExperimentSlotProps } from '../types/puck.js'

export function slotToRender(props: Pick<ExperimentSlotProps, 'xpSlot'>): ArmSlot {
  switch (props.xpSlot) {
    case 'control':
    case 'variantA':
    case 'variantB':
    case 'variantC':
      return props.xpSlot
    default:
      return 'control'
  }
}
