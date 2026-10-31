import type { ArmIssueCode } from '../../types/endpoints.js'

export const ISSUE_COPY: Record<ArmIssueCode, string> = {
  'weights-total': 'Weights must add up to 100%. They add up to {total}% now.',
  'control-count': 'Include exactly one Original.',
  'control-first': 'Put the Original first.',
  'holdout-last': 'Put the holdout last.',
  'holdout-count': 'Include only one holdout.',
  'variant-count': 'Include up to three variants.',
  'duplicate-key': 'Each group must have a different standard name.',
  'duplicate-slot': 'Each group must have a different content slot.',
  'slot-required': 'Choose the matching content slot for this group.',
  'invalid-key': 'Use the standard group names: Original, Variant A–C, Holdout.',
}
export const GROUP_LABELS = {
  control: 'Original', variantA: 'Variant A', variantB: 'Variant B', variantC: 'Variant C', holdout: 'Holdout',
} as const
export const ARMS_COPY = {
  groups: 'Groups', label: 'Group label', weight: 'Weight (%)', slot: 'Content slot',
  addVariant: 'Add a variant', addHoldout: 'Add a holdout', removeHoldout: 'Remove holdout',
  removeVariant: 'Remove variant', splitEvenly: 'Split evenly',
  holdout: 'The holdout sees the Original and is measured but not compared during the test. After you decide, it keeps seeing the Original so the winner can be compared with it.',
  pagePath: 'Page path', holdoutPage: "Sees the Original's page",
  pageRequired: 'Enter a page path for this group.',
  pageInvalid: 'Use a page path starting with /, without a host, query or fragment.',
  flagPoint: 'Flag point', controlParams: "The Original uses this flag point's current defaults. These values are checked again at Start.",
  paramRequired: 'Enter a value for {label}.', paramNumber: 'Enter a number for {label}.',
  paramMin: '{label} must be at least {min}.', paramMax: '{label} must be at most {max}.',
  paramOption: 'Choose an available option for {label}.', paramCheckbox: 'Choose yes or no for {label}.',
} as const

export function issueMessage(issue: { code: string; message: string }, total: number): string {
  const copy = Object.hasOwn(ISSUE_COPY, issue.code) ? ISSUE_COPY[issue.code as ArmIssueCode] : issue.message
  return copy.replace('{total}', String(total))
}
