import type { DocumentViewServerProps } from 'payload'
import { formatAdminURL } from 'payload/shared'
import { redirect } from 'next/navigation.js'

type Props = Pick<DocumentViewServerProps, 'initPageResult' | 'params' | 'routeSegments'>
export async function GoalEditRedirect({ initPageResult, params, routeSegments }: Props) {
  const resolved = await params
  const segments = routeSegments ?? (Array.isArray(resolved?.segments) ? resolved.segments : [])
  const collectionIndex = segments.indexOf('xp-metrics')
  const tail = collectionIndex >= 0 ? segments.slice(collectionIndex + 1) : segments
  const id = tail[0] ?? resolved?.id ?? initPageResult.docID
  const path: `/${string}` = id === undefined || id === 'create' ? '/experiments/goals/new'
    : `/experiments/goals/${encodeURIComponent(String(id))}`
  return redirect(formatAdminURL({ adminRoute: initPageResult.req.payload.config.routes.admin, path }))
}
