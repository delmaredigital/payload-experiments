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
  forbiddenUnbound: "You don't have access to tests.",
  unavailable: "This test isn't available to you. You can still edit its content.",
  resultsOnly: "You can view this test's results.",
  statuses: {
    draft: 'Draft',
    running: 'Running',
    stopped: 'Stopped',
    decided: 'Decided',
    archived: 'Archived',
  },
} as const
