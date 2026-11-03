import { ARM_LABELS } from '../labels/arms.js'

export const slotLabels = {
  control: ARM_LABELS.control, variantA: ARM_LABELS.variantA,
  variantB: ARM_LABELS.variantB, variantC: ARM_LABELS.variantC,
} as const

export const pickerCopy = {
  label: 'Experiment',
  none: 'No experiment',
  loading: 'Loading experiments…',
  error: "Couldn't load experiments.",
  forbidden: "You can't see experiments. Ask an admin.",
  statuses: {
    draft: 'Draft',
    running: 'Running',
    stopped: 'Stopped',
    decided: 'Decided',
    archived: 'Archived',
  },
} as const
