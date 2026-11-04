import type { ArmIssueCode } from '../types/endpoints.js'

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
export function issueMessage(issue: { code: string; message: string }, total: number): string {
  const copy = Object.hasOwn(ISSUE_COPY, issue.code) ? ISSUE_COPY[issue.code as ArmIssueCode] : issue.message
  return copy.replace('{total}', String(total))
}
