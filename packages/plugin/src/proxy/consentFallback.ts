import { fillFlagPoints, type AssignmentResult } from '../runtime/assign.js'
import { evaluateTargeting } from '../runtime/targeting.js'
import type { Attributes } from '../types/contracts.js'
import type { Manifest } from '../types/manifest.js'
import { controlAssignments } from './control.js'

/** Serve deterministic site content without assigning, hashing or retaining a unit id. */
export function consentFallback(manifest: Manifest, attributes: Attributes, context: Pick<AssignmentResult,
  'staff' | 'bot' | 'preview' | 'sessionUnknown' | 'method'>): AssignmentResult {
  const result = controlAssignments(manifest, { ...context, visitorId: undefined, userId: undefined })
  const identityFreeAttributes = { ...attributes }
  delete identityFreeAttributes.userId
  delete identityFreeAttributes.visitorId
  if (context.sessionUnknown) {
    delete identityFreeAttributes.loggedIn
    delete identityFreeAttributes.staff
  }
  for (const experiment of manifest.experiments) {
    if (experiment.status !== 'decided' || experiment.phaseKind === 'rollout') continue
    const winner = experiment.arms.find(arm => arm.key === experiment.winnerArm)
    if (!winner || !evaluateTargeting(experiment.targeting, identityFreeAttributes)) continue
    result.bySlug[experiment.slug]!.arm = winner.key
  }
  fillFlagPoints(result, manifest)
  return result
}
