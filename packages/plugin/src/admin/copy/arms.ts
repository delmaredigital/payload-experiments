export { ARM_LABELS as GROUP_LABELS } from '../../labels/arms.js'
export { ISSUE_COPY, issueMessage } from '../../arms/copy.js'

export const ARMS_COPY = {
  holdout: 'The holdout sees the Original and is measured but not compared during the test. After you decide, it keeps seeing the Original so the winner can be compared with it.',
  pageRequired: 'Enter a page path for this group.',
  pageInvalid: 'Use a page path starting with /, without a host, query or fragment.',
  paramRequired: 'Enter a value for {label}.', paramNumber: 'Enter a number for {label}.',
  paramMin: '{label} must be at least {min}.', paramMax: '{label} must be at most {max}.',
  paramOption: 'Choose an available option for {label}.', paramCheckbox: 'Choose yes or no for {label}.',
} as const
