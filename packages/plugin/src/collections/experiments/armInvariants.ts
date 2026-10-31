import type { Arm, ExperimentKind } from '../../types/contracts.js'
import type { ArmIssueCode } from '../../types/endpoints.js'
import { XpNotImplemented } from '../../errors.js'

export interface ArmIssue { code: ArmIssueCode; armIndex?: number; armKey?: string; message: string }
export function checkArms(_arms: Arm[], _kind: ExperimentKind): ArmIssue[] {
  throw new XpNotImplemented('CORE-03')
}
export function addHoldout(_arms: Arm[]): Arm[] {
  throw new XpNotImplemented('CORE-03')
}
