import type { AssignmentResult } from '../runtime/assign.js'
import type { Manifest } from '../types/manifest.js'
import type { NextRequest } from 'next/server'

// Manifest targets are local paths. A malformed target must never become an open rewrite.
function targetURL(path: string | undefined, requestURL: NextRequest['nextUrl']): URL | undefined {
  if (!path?.startsWith('/') || path.startsWith('//') || /[\\\r\n?#]/.test(path)) return undefined
  try {
    const url = requestURL.clone()
    url.pathname = path
    if (url.origin !== requestURL.origin) return undefined
    return new URL(url.href)
  } catch { return undefined }
}

export function pageRewrite(manifest: Manifest, assignments: AssignmentResult, requestURL: NextRequest['nextUrl']): URL | undefined {
  const experiment = manifest.experiments.find(experiment => experiment.kind === 'page'
    && (experiment.status === 'running' || experiment.status === 'decided')
    && experiment.arms.some(arm => arm.pageTarget === requestURL.pathname))
  if (experiment) {
    const assignment = assignments.bySlug[experiment.slug]
    const control = experiment.arms.find(arm => arm.kind === 'control')
    const arm = experiment.arms.find(arm => arm.key === assignment?.arm)
    const target = targetURL((arm?.kind === 'holdout' ? control : arm)?.pageTarget, requestURL)
    if (target) return target
    if (control) {
      // The proxy has committed to serving control. Deferred server evaluation
      // must not later describe a different, exposable page for this request.
      assignments.deferred = assignments.deferred.filter(slug => slug !== experiment.slug)
      assignments.bySlug[experiment.slug] = {
        slug: experiment.slug, experimentId: experiment.id, arm: control.key, phase: experiment.phase,
        exposable: false, policy: experiment.exposurePolicy, source: 'fallback',
      }
    }
    return targetURL(control?.pageTarget, requestURL)
  }
  const archived = Object.hasOwn(manifest.archivedPages, requestURL.pathname)
    ? manifest.archivedPages[requestURL.pathname] : undefined
  return targetURL(archived?.winnerPath, requestURL)
}
