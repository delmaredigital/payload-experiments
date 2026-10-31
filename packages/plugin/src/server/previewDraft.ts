import type { Payload, PayloadRequest } from 'payload'
import type { PreviewToken } from '../runtime/previewToken.js'
import type { Assignments } from '../types/assignments.js'
import type { ExposurePolicy } from '../types/contracts.js'

/** Draft previews use the authenticated manager's normal collection access. */
export async function previewDraft(payload: Payload, user: { id: string | number } | null, token: PreviewToken, assignments: Assignments, headers: Headers): Promise<void> {
  if (!user) return
  try {
    const doc = await payload.findByID({
      collection: 'xp-experiments', id: token.e, depth: 0, overrideAccess: false,
      user, req: { user: user as PayloadRequest['user'], headers },
    })
    if ((doc.status !== 'draft' && doc.status !== 'stopped') || doc.phase !== token.p || typeof doc.slug !== 'string' || !Array.isArray(doc.arms)) return
    const arm = doc.arms.find((a: { key?: string }) => a.key === token.a)
    if (!arm || !['render', 'viewport', 'pageview', 'manual'].includes(doc.exposurePolicy)) return
    assignments.preview = true
    assignments.bySlug[doc.slug] = {
      slug: doc.slug, experimentId: doc.id, arm: token.a, phase: token.p,
      exposable: false, policy: doc.exposurePolicy as ExposurePolicy, source: 'preview',
    }
    if (typeof doc.flagPoint === 'string') {
      const content = arm.kind === 'holdout' ? doc.arms.find((a: { kind?: string }) => a.kind === 'control') : arm
      assignments.flagPoints[doc.flagPoint] = {
        arm: token.a, params: { ...content?.params }, source: 'experiment', experiment: doc.slug,
        experimentId: doc.id, phase: token.p, policy: doc.exposurePolicy as ExposurePolicy, exposable: false,
      }
    }
  } catch {
    console.error('[payload-experiments] draft preview unavailable')
  }
}
