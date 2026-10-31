import { fillFlagPoints, type AssignmentResult } from '../runtime/assign.js'
import type { Manifest } from '../types/manifest.js'

/** Explicit control entries prevent deferred user/session assignments from becoming exposable. */
export function controlAssignments(manifest: Manifest, context: Pick<AssignmentResult,
  'visitorId' | 'userId' | 'staff' | 'bot' | 'preview' | 'sessionUnknown' | 'method'>): AssignmentResult {
  const result: AssignmentResult = {
    ...context, revision: manifest.revision, archivedWinners: { ...manifest.archivedWinners },
    bySlug: Object.create(null), flagPoints: Object.create(null), deferred: [],
  }
  for (const experiment of manifest.experiments) {
    result.bySlug[experiment.slug] = {
      slug: experiment.slug, experimentId: experiment.id, arm: experiment.arms.find(arm => arm.kind === 'control')?.key ?? 'control',
      phase: experiment.phase, exposable: false, policy: experiment.exposurePolicy, source: 'fallback',
    }
  }
  fillFlagPoints(result, manifest)
  return result
}

/** Last resort: do not inspect a manifest that could not even produce controls. */
export function emptyAssignments(context: Pick<AssignmentResult,
  'visitorId' | 'userId' | 'staff' | 'bot' | 'preview' | 'sessionUnknown' | 'method'>): AssignmentResult {
  return {
    ...context, revision: 0, archivedWinners: {},
    bySlug: Object.create(null), flagPoints: Object.create(null), deferred: [],
  }
}
