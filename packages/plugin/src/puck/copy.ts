import { ARM_LABELS } from '../labels/arms.js'

export const slotLabels = {
  control: ARM_LABELS.control, variantA: ARM_LABELS.variantA,
  variantB: ARM_LABELS.variantB, variantC: ARM_LABELS.variantC,
} as const

export const pickerCopy = {
  label: 'Test',
  none: 'No test',
  loading: 'Loading tests…',
  error: "Couldn't load tests.",
  forbidden: "You can't see tests. Ask an admin.",
  statuses: {
    draft: 'Draft',
    running: 'Running',
    stopped: 'Stopped',
    decided: 'Decided',
    archived: 'Archived',
  },
} as const
