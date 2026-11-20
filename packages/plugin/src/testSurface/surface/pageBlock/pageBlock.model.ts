import type { Arm } from '../../../types/contracts.js'
import type { PreflightResult } from '../../../types/endpoints.js'
import { TEST_PAGE as C } from '../../copy/testPage.js'
import { placementLabel } from '../../placementLabel.js'

type Placement = PreflightResult['placements'][number]
export function placementLine(placement: Placement): string {
  return `${C.onPage} ${placementLabel(placement, true)}`
}
export function slotReady(placement: Placement, arm: Arm): boolean {
  const slot = arm.kind === 'holdout' ? 'control' : arm.slot
  return Boolean(slot && (placement.slots?.[slot] ?? 0) > 0)
}
