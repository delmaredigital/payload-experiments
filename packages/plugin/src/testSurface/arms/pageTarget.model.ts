import type { Arm, ArmKind, ExperimentKind } from '../../types/contracts.js'
import { ARMS_COPY } from '../copy/arms.js'

export function showsPageTarget(kind: ExperimentKind, group: ArmKind): boolean {
  return kind === 'page' && group !== 'holdout'
}
export function pageTargetIssue(value: unknown, group: ArmKind): string | null {
  if (group === 'holdout') return null
  if (typeof value !== 'string' || !value.trim()) return ARMS_COPY.pageRequired
  // Backslashes and whitespace can be normalised into a different URL by the browser.
  if (!value.startsWith('/') || value.startsWith('//') || /[?#\\\s]/.test(value)) return ARMS_COPY.pageInvalid
  return null
}
export function setPageTarget(arm: Arm, value: string): Arm {
  if (arm.kind !== 'holdout') return { ...arm, pageTarget: value }
  const { pageTarget: _ignored, ...rest } = arm
  return rest
}
