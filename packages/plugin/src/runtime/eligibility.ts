import { layerSlice } from '@delmaredigital/experiments-stats'
import type { Attributes } from '../types/contracts.js'
import type { ManifestExperiment } from '../types/manifest.js'
import { evaluateTargeting, type AttributeKeys } from './targeting.js'

export interface AssignmentUnit { visitorId?: string; userId?: string; sessionUnknown?: boolean }
export type Eligibility = { kind: 'deferred' } | { kind: 'ineligible' } | { kind: 'eligible'; unitId: string; inLayer: boolean; coverage: number }

export function eligibility(experiment: ManifestExperiment, unit: AssignmentUnit, attributes: Attributes, opts: { sessionUnknown?: boolean; attributeKeys?: AttributeKeys } = {}): Eligibility {
  const unitId = experiment.unitType === 'visitor' ? unit.visitorId : unit.userId
  if (!unitId) return { kind: experiment.unitType === 'user' ? 'deferred' : 'ineligible' }
  if ((opts.sessionUnknown ?? unit.sessionUnknown) && experiment.targeting.some(rule => rule.attribute === 'loggedIn' || rule.attribute === 'staff')) return { kind: 'deferred' }
  if (!evaluateTargeting(experiment.targeting, attributes, opts.attributeKeys)) return { kind: 'ineligible' }
  return {
    kind: 'eligible', unitId,
    inLayer: !experiment.layer || experiment.layer.slices.includes(layerSlice(experiment.layer.slug, unitId)),
    coverage: experiment.layer ? 1 : experiment.coverage,
  }
}
