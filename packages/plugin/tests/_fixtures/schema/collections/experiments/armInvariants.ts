// Schema-only copy of CORE-02a ba8d1c703430d8908f13a3669a31f8e3bfb8a9b5; only external import paths adjusted.
import type { Arm, ExperimentKind } from '../../../../../src/types/contracts.js'
import type { ArmIssueCode } from '../../../../../src/types/endpoints.js'
import { XpNotImplemented } from '../../../../../src/errors.js'

export interface ArmIssue { code: ArmIssueCode; armIndex?: number; armKey?: string; message: string }
export function checkArms(_arms: Arm[], _kind: ExperimentKind): ArmIssue[] {
  throw new XpNotImplemented('CORE-03')
}
export function addHoldout(_arms: Arm[]): Arm[] {
  throw new XpNotImplemented('CORE-03')
}
