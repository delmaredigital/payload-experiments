import type { Assignments, ClientAssignments } from '../types/assignments.js'
import { manifestOf, suppressExposure } from './context.js'

export function toClientAssignments(assignments: Assignments, opts: { pathname: string; apiRoute?: string; flagPoints?: string[]; experiments?: string[] }): ClientAssignments {
  const result: ClientAssignments = { v: 1, revision: assignments.revision, apiRoute: opts.apiRoute ?? '/api', experiments: Object.create(null), flagPoints: Object.create(null), pageviews: [] }
  const blocked = suppressExposure(assignments)
  const manifest = manifestOf(assignments)
  for (const slug of opts.experiments ?? []) {
    if (!Object.hasOwn(assignments.bySlug, slug)) continue
    const a = assignments.bySlug[slug]!
    const experiment = manifest?.experiments.find(e => e.slug === slug)
    const arm = experiment?.arms.find(arm => arm.key === a.arm && arm.kind !== 'holdout') ?? experiment?.arms.find(arm => arm.kind === 'control')
    result.experiments[slug] = { arm: a.arm, experimentId: a.experimentId, phase: a.phase, params: { ...arm?.params }, policy: a.policy, exposable: a.exposable && !blocked }
  }
  for (const id of opts.flagPoints ?? []) {
    if (!Object.hasOwn(assignments.flagPoints, id)) continue
    const point = assignments.flagPoints[id]!
    result.flagPoints[id] = { ...point, params: { ...point.params }, exposable: point.exposable && !blocked }
  }
  if (!blocked) for (const e of manifest?.experiments ?? []) {
    const a = assignments.bySlug[e.slug]
    if (e.kind !== 'page' || !a?.exposable) continue
    const served = e.arms.find(arm => arm.key === a.arm && arm.kind !== 'holdout') ?? e.arms.find(arm => arm.kind === 'control')
    if (served?.pageTarget === opts.pathname) result.pageviews.push({ slug: e.slug, arm: a.arm, phase: a.phase })
  }
  return result
}
