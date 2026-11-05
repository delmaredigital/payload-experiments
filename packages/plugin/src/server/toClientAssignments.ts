import { normalisePath } from '../runtime/normalisePath.js'
import type { Assignments, ClientAssignments } from '../types/assignments.js'
import { manifestOf, suppressExposure } from './context.js'

export function toClientAssignments(assignments: Assignments, opts: { pathname: string; apiRoute?: string; flagPoints?: string[]; experiments?: string[] }): ClientAssignments {
  const blocked = suppressExposure(assignments)
  const manifest = manifestOf(assignments)
  const experiments = Object.fromEntries((opts.experiments ?? []).filter(slug => Object.hasOwn(assignments.bySlug, slug)).map(slug => {
    const a = assignments.bySlug[slug]!
    const experiment = manifest?.experiments.find(e => e.slug === slug)
    const arm = experiment?.arms.find(arm => arm.key === a.arm && arm.kind !== 'holdout') ?? experiment?.arms.find(arm => arm.kind === 'control')
    return [slug, { arm: a.arm, experimentId: a.experimentId, phase: a.phase, params: { ...arm?.params }, policy: a.policy, exposable: a.exposable && !blocked }]
  }))
  const flagPoints = Object.fromEntries((opts.flagPoints ?? []).filter(id => Object.hasOwn(assignments.flagPoints, id)).map(id => {
    const point = assignments.flagPoints[id]!
    return [id, { ...point, params: { ...point.params }, exposable: point.exposable && !blocked }]
  }))
  const result: ClientAssignments = { v: 1, revision: assignments.revision, apiRoute: opts.apiRoute ?? '/api', experiments, flagPoints, pageviews: [], clickGoalsArmed: !blocked && Object.values(assignments.bySlug).some(a => a.exposable) }
  if (!blocked) for (const e of manifest?.experiments ?? []) {
    const a = assignments.bySlug[e.slug]
    if (e.kind !== 'page' || !a?.exposable) continue
    const served = e.arms.find(arm => arm.key === a.arm && arm.kind !== 'holdout') ?? e.arms.find(arm => arm.kind === 'control')
    if (served?.pageTarget !== undefined && normalisePath(served.pageTarget) === normalisePath(opts.pathname)) result.pageviews.push({ slug: e.slug, arm: a.arm, phase: a.phase })
  }
  return result
}
