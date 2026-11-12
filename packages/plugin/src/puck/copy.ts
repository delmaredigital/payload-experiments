import { ARM_LABELS } from '../labels/arms.js'

export const categoryTitle = 'A/B tests'

export const slotLabels = {
  control: ARM_LABELS.control, variantA: ARM_LABELS.variantA,
  variantB: ARM_LABELS.variantB, variantC: ARM_LABELS.variantC,
} as const

export const pickerCopy = {
  label: 'Test',
  none: 'No test',
  search: 'Search tests',
  loading: 'Loading tests…',
  error: "Couldn't load tests.",
  forbidden: "You don't have access to this test. You can still edit its content.",
  statuses: {
    draft: 'Draft',
    running: 'Running',
    stopped: 'Stopped',
    decided: 'Decided',
    archived: 'Archived',
  },
} as const
